// Sim cost: a 2-fighter duel stepping at 60 Hz, and a client prediction replay.
//   npx tsx --tsconfig client/tsconfig.json tools/bench-sim.ts
import { Duel, Predictor, InputBuffer, type DuelistInput, type NetSnapshot } from '../shared/src/combat/index.js';

const duel = new Duel();
duel.add('a', { x: 0, z: 0 }, 0);
duel.add('b', { x: 0, z: 1.8 }, Math.PI);
const dirs = ['overhead', 'diag_l', 'diag_r', 'horiz_l', 'horiz_r', 'thrust', 'low'] as const;
const input = (t: number, k: number): DuelistInput => ({
    move: { x: Math.sin(t / 30 + k), z: Math.cos(t / 50 + k) * 0.5 }, facing: k ? Math.PI : 0, guard: (t + k * 40) % 90 < 30,
    ...(t % 47 === k * 13 ? { attack: { dir: dirs[(t + k) % 7], committed: false } } : {}),
    ...(t % 61 === 7 + k ? { parry: true } : {}),
});
for (let t = 0; t < 2000; t++) duel.step({ a: input(t, 0), b: input(t, 1) });
const N = 60_000;
let t0 = performance.now();
for (let t = 0; t < N; t++) {
    duel.step({ a: input(t, 0), b: input(t, 1) });
    if (duel.fighters.some(f => f.phase === 'dead')) { for (const f of duel.fighters) { f.vitality = 100; f.phase = 'ready'; } }
}
const step = (performance.now() - t0) / N;

const pred = new Predictor('a');
pred.duel.restore(duel.snapshot());
const buf = new InputBuffer(0);
const snap = (): NetSnapshot => ({ state: duel.snapshot(), events: [], round: 1, names: {}, acks: { a: Math.max(0, seq - 15) }, held: { b: buf.heldInput } });
let seq = 0;
for (let i = 0; i < 20; i++) { pred.input(input(i, 0)); seq++; }
const M = 3000;
t0 = performance.now();
for (let i = 0; i < M; i++) { pred.input(input(i, 0)); seq++; pred.reconcile(snap()); }
const reconcile = (performance.now() - t0) / M;
console.log(`duel step (2 fighters): ${(step * 1000).toFixed(1)} µs`);
console.log(`prediction: input + reconcile with ~15 unacked ticks: ${reconcile.toFixed(3)} ms (30 per second)`);
