import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeInput, InputBuffer, Predictor, MAX_INPUT_LAG, type NetSnapshot } from './net.js';
import type { DuelistInput } from './types.js';
import { Duel } from './duel.js';

test('untrusted input is clamped, enum-checked, and junk is dropped', () => {
  assert.equal(sanitizeInput(null), null);
  assert.equal(sanitizeInput({ facing: 'north' }), null);
  assert.equal(sanitizeInput({ facing: NaN }), null);
  const i = sanitizeInput({ facing: 7, move: { x: 30, z: 40 }, attack: { dir: 'teleport', committed: true }, damage: 999, guardLine: 'everywhere', stance: 'high', step: { x: 0, z: 0 } })!;
  assert.ok(Math.abs(Math.hypot(i.move.x, i.move.z) - 1) < 1e-9, 'movement cannot exceed full speed');
  assert.ok(Math.abs(i.facing) <= Math.PI, 'facing wrapped');
  assert.equal(i.attack, undefined, 'unknown attack refused');
  assert.equal((i as any).damage, undefined, 'clients cannot send outcomes');
  assert.equal(i.guardLine, undefined);
  assert.equal(i.stance, 'high');
  assert.equal(i.step, undefined, 'zero step ignored');
  assert.equal(sanitizeInput({ facing: 0, technique: 'fireball' })!.technique, undefined, 'only real techniques');
  assert.equal(sanitizeInput({ facing: 0, technique: 'kesa_giri', bind: true })!.technique, 'kesa_giri');
  assert.equal(sanitizeInput({ facing: 0, bind: 'yes' })!.bind, undefined);
});

test('flooding is rate limited and one-shot intents are neither lost nor repeated', () => {
  const b = new InputBuffer(0, 10);
  let accepted = 0;
  for (let k = 0; k < 50; k++) if (b.push({ facing: 0, attack: { dir: 'diag_l', committed: false } }, 0.5)) accepted++;
  assert.equal(accepted, 10);
  assert.ok(b.rejected >= 40);
  let attacks = 0;
  for (let t = 0; t < 30; t++) if (b.take().attack) attacks++;
  assert.equal(attacks, 10, 'each accepted intent is used exactly once');
});

test('stamped inputs are applied in order, acknowledged, and replays are refused', () => {
  const b = new InputBuffer(0);
  assert.ok(b.push({ facing: 0, seq: 1, move: { x: 0, z: 1 } }, 0));
  assert.ok(b.push({ facing: 0, seq: 2, parry: true }, 0));
  assert.equal(b.push({ facing: 0, seq: 2, attack: { dir: 'thrust', committed: true } }, 0), false, 'a repeated stamp is a replay');
  assert.equal(b.push({ facing: 0, seq: 1 }, 0), false);
  assert.equal(b.take().move.z, 1); assert.equal(b.ack, 1);
  const second = b.take();
  assert.equal(second.parry, true); assert.equal(b.ack, 2);
  assert.equal(second.move.z, 0, 'the second input carries its own held state');
  const idle = b.take();
  assert.equal(idle.parry, undefined, 'nothing arrived: held state continues, the parry is not repeated');
  assert.equal(b.ack, 2);
});

test('a backlog is trimmed to keep latency low, but no cut is dropped', () => {
  const b = new InputBuffer(0, 1000);
  for (let k = 1; k <= 20; k++) b.push({ facing: 0, seq: k, ...(k === 3 ? { attack: { dir: 'overhead', committed: false } } : {}) }, 0);
  const first = b.take();
  assert.equal(first.attack?.dir, 'overhead', 'the cut survives the trim and comes first');
  let left = 0;
  while (b.ack < 20) { b.take(); left++; }
  assert.ok(left <= MAX_INPUT_LAG, `backlog trimmed (${left} ticks left)`);
});

test('the server sim moves no faster than the rules allow, whatever a client claims', () => {
  const duel = new Duel();
  duel.add('p0', { x: 0, z: 0 }, 0);
  const b = new InputBuffer(0);
  for (let t = 0; t < 60; t++) {
    b.push({ facing: 0, move: { x: 0, z: 1e9 } }, t / 60);
    duel.step({ p0: b.take() });
  }
  const p = duel.get('p0')!;
  assert.ok(p.pos.z < 3.3, `one second of the fastest legal walk, not a teleport (${p.pos.z.toFixed(2)} m)`);
});

// A lossless link with fixed latency in each direction, a server ticking with InputBuffers, and a
// client predicting with Predictor. Returns per-sequence positions seen on both sides.
function simulateLink(script: (t: number) => DuelistInput, opts: { up: number; down: number; ticks: number; tamper?: (t: number, d: Duel) => void }) {
  const server = new Duel();
  server.add('p0', { x: 0, z: 0 }, 0, { drawn: false });
  server.add('p1', { x: 0, z: 40 }, Math.PI, { drawn: false });
  const bufs: Record<string, InputBuffer> = { p0: new InputBuffer(0), p1: new InputBuffer(Math.PI) };
  const pred = new Predictor('p0');
  pred.duel.restore(server.snapshot());
  const up: { at: number; msg: unknown }[] = [];
  const down: { at: number; snap: NetSnapshot }[] = [];
  const predicted = new Map<number, string>(), truth = new Map<number, string>();
  const key = (d: Duel) => { const f = d.get('p0')!; return `${f.pos.x.toFixed(9)},${f.pos.z.toFixed(9)},${f.phase},${f.stamina.toFixed(9)}`; };
  let maxCorrection = 0;
  for (let t = 0; t < opts.ticks; t++) {
    // Client: deliver snapshots that have arrived, then predict this tick's input.
    while (down.length && down[0].at <= t) maxCorrection = Math.max(maxCorrection, pred.reconcile(down.shift()!.snap));
    const msg = pred.input(script(t));
    predicted.set(msg.seq, key(pred.duel));
    up.push({ at: t + opts.up, msg });
    // Server: receive, step one tick, acknowledge.
    while (up.length && up[0].at <= t) bufs.p0.push(up.shift()!.msg, t / 60);
    opts.tamper?.(t, server);
    server.step({ p0: bufs.p0.take(), p1: bufs.p1.take() });
    truth.set(bufs.p0.ack, key(server));
    if (t % 2 === 0) down.push({ at: t + opts.down, snap: { state: server.snapshot(), events: [], round: 1, names: {}, acks: { p0: bufs.p0.ack, p1: 0 }, held: { p0: bufs.p0.heldInput, p1: bufs.p1.heldInput } } });
  }
  return { predicted, truth, pred, server, maxCorrection };
}

const walkAndCut = (t: number): DuelistInput => ({
  move: { x: t < 90 ? Math.sin(t / 9) * 0.6 : 0, z: t < 90 ? 1 : 0 },
  facing: Math.sin(t / 40) * 0.5,
  guard: t > 150 && t < 170,
  ...(t === 5 ? { draw: true } : {}),
  ...(t === 100 ? { attack: { dir: 'diag_l' as const, committed: false } } : {}),
  ...(t === 130 ? { step: { x: 1, z: 0 } } : {}),
});

test('prediction shows exactly what the server will decide, a round trip early', () => {
  const { predicted, truth, pred, maxCorrection } = simulateLink(walkAndCut, { up: 6, down: 6, ticks: 220 });
  let compared = 0;
  for (const [seq, k] of truth) {
    if (seq === 0) continue;
    assert.equal(predicted.get(seq), k, `seq ${seq}: predicted and authoritative fighter differ`);
    compared++;
  }
  assert.ok(compared > 200, `compared ${compared} ticks`);
  assert.equal(maxCorrection, 0, 'nothing needed correcting on a clean link');
  assert.ok(pred.unacked >= 12 && pred.unacked <= 14, `~a round trip of inputs in flight (${pred.unacked})`);
});

test('when the server disagrees, the client snaps to its truth and replays its own inputs on top', () => {
  // The server shoves our fighter aside once (stands in for anything we could not predict).
  const r = simulateLink(walkAndCut, { up: 4, down: 4, ticks: 160, tamper: (t, d) => { if (t === 40) d.get('p0')!.pos.x += 2; } });
  assert.ok(r.maxCorrection > 1.5, `the client was corrected (${r.maxCorrection.toFixed(2)} m)`);
  // After the correction, prediction agrees with the server again.
  for (const [seq, k] of r.truth) if (seq > 60) assert.equal(r.predicted.get(seq), k, `seq ${seq}`);
});
