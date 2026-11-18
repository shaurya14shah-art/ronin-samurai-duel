import { test } from 'node:test';
import assert from 'node:assert/strict';
import { A, B, face, of, run, ticks } from './testkit.js';
import { ALL_TECHNIQUES, buildAttack, cleanTraining, parryWindow } from './duelist.js';
import { TRAINING } from './constants.js';
import type { Training } from './types.js';

const trained = (t: Partial<Training>) => ({ training: { ...t, known: t.known ?? ['wind_step'] } });

/** Vitality and posture B loses to one clean diagonal from A at a fixed distance. */
function cutOnB(aTraining: Partial<Training> = {}, bTraining: Partial<Training> = {}) {
  const duel = face(1.45, trained(aTraining), trained(bTraining));
  run(duel, ticks(1), t => ({ [A]: t === 0 ? { attack: { dir: 'diag_l', committed: false } } : {} }));
  const b = duel.get(B)!;
  return { lost: 100 - b.vitality, posture: b.posture };
}

test('strength makes cuts land harder, and three ranks are worth about a tenth', () => {
  const base = cutOnB();
  const strong = cutOnB({ strength: 3 });
  assert.ok(base.lost > 0, 'the cut lands');
  const gain = strong.lost / base.lost;
  assert.ok(gain > 1.05 && gain <= 1 + 3 * TRAINING.strength + 1e-9, `gain ${gain.toFixed(3)}`);
});

test('defence takes posture off what lands; endurance recovers breath faster', () => {
  assert.ok(cutOnB({}, { defence: 3 }).posture < cutOnB().posture);
  const rest = (endurance: number) => {
    const duel = face(5, trained({ endurance }));
    duel.get(A)!.stamina = 20;
    run(duel, ticks(2));
    return duel.get(A)!.stamina;
  };
  assert.ok(rest(3) > rest(0) + 2);
});

test('footwork carries a step further', () => {
  const step = (footwork: number) => {
    const duel = face(5, trained({ footwork }));
    run(duel, ticks(0.5), t => ({ [A]: t === 0 ? { step: { x: 0, z: -1 } } : {} }));
    return -duel.get(A)!.pos.z;
  };
  assert.ok(step(3) > step(0) * 1.1, `${step(0).toFixed(2)} → ${step(3).toFixed(2)} m`);
});

test('training is clamped: no rank above 3, no unknown technique, mastery within 0–1', () => {
  const t = cleanTraining({ strength: 50, defence: -4, known: ['wind_step', 'fireball' as never], mastery: { iai: 9 } });
  assert.equal(t.strength, 3);
  assert.equal(t.defence, 0);
  assert.deepEqual(t.known, ['wind_step']);
  assert.equal(t.mastery.iai, 1);
});

test('a technique not yet learned does nothing', () => {
  const duel = face(1.6);
  const ev = run(duel, ticks(1), t => ({ [A]: t === 0 ? { technique: 'kesa_giri' } : {} }));
  assert.equal(of(ev, 'attack_start').length, 0);
  assert.equal(duel.get(A)!.stamina, 100);
});

test('kesa-giri breaks a full guard that holds against an ordinary diagonal', () => {
  const vs = (input: object) => {
    const duel = face(1.5, trained({ known: ALL_TECHNIQUES }));
    duel.get(B)!.posture = 55;
    const ev = run(duel, ticks(1.2), t => ({ [A]: t === 0 ? input : {}, [B]: { guard: true, guardLine: 'right' } }));
    return of(ev, 'guard_break').length > 0 ? 'broken' : of(ev, 'block').length ? 'held' : 'none';
  };
  assert.equal(vs({ attack: { dir: 'diag_l', committed: false } }), 'held');
  assert.equal(vs({ technique: 'kesa_giri' }), 'broken');
});

test('void step: off the line of a committed overhead and into a counter-thrust that lands', () => {
  const exchange = (technique: boolean) => {
    const duel = face(1.6, trained({ known: ALL_TECHNIQUES }), {});
    const ev = run(duel, ticks(2), t => ({
      [B]: t === 0 ? { attack: { dir: 'overhead', committed: true } } : {},
      [A]: t === ticks(0.45) ? (technique ? { technique: 'void_step' } : { step: { x: 1, z: 0 } }) : {},
    }));
    return { aHit: of(ev, 'hit').some(e => e.a === A), bHit: of(ev, 'hit').some(e => e.a === B) };
  };
  const plain = exchange(false), voided = exchange(true);
  assert.equal(voided.bHit, false, 'the overhead misses');
  assert.equal(voided.aHit, true, 'the counter-thrust lands');
  assert.equal(plain.aHit, false, 'a plain sidestep does not counter');
});

test('maki-otoshi: a bind leaves the attacker further off balance than a plain parry', () => {
  const after = (bind: boolean, at: number) => {
    const duel = face(1.5, {}, trained({ known: ALL_TECHNIQUES }));
    const ev = run(duel, ticks(0.9), t => ({
      [A]: t === 0 ? { attack: { dir: 'diag_l', committed: false } } : {},
      [B]: t === at ? (bind ? { bind: true } : { parry: true }) : {},
    }));
    const a = duel.get(A)!;
    return { parried: of(ev, 'parry').length > 0, posture: a.posture, rattled: a.rattled, phase: a.phase };
  };
  // The bind's window is tighter than a parry's: find a moment where both meet the cut.
  const at = Array.from({ length: 40 }, (_, i) => i).find(t => after(false, t).parried && after(true, t).parried);
  assert.ok(at !== undefined, 'some timing catches the cut both ways');
  const p = after(false, at!), b = after(true, at!);
  assert.ok(p.parried && b.parried, 'both meet the cut');
  assert.ok(b.posture > p.posture + 20, `posture ${p.posture.toFixed(0)} → ${b.posture.toFixed(0)}`);
  assert.ok(b.rattled > p.rattled, 'the blade is wound out of line');
});

test('iai: a learned quick-draw cuts sooner from the scabbard', () => {
  const firstActive = (known: Training['known']) => {
    const duel = face(1.5, { drawn: false, training: { known } });
    const ev = run(duel, ticks(1), t => ({ [A]: t === 0 ? { attack: { dir: 'diag_l', committed: false } } : {} }));
    return of(ev, 'attack_active').find(e => e.a === A)!.tick;
  };
  assert.ok(firstActive(['wind_step', 'iai']) < firstActive(['wind_step']) - 5);
});

test('mastery makes a technique quicker; long-blade training eases a heavy blade; a short blade parries quicker', () => {
  const d = face(2, trained({ known: ALL_TECHNIQUES })).get(A)!;
  const fresh = buildAttack(d, 'kesa_giri', false).windup;
  d.training.mastery.kesa_giri = 1;
  assert.ok(buildAttack(d, 'kesa_giri', false).windup < fresh * 0.9);
  const heavy = face(2, { bladeMass: 1.8 }).get(A)!;
  const heavyTrained = face(2, { bladeMass: 1.8, training: { longBlade: 3 } }).get(A)!;
  assert.ok(buildAttack(heavyTrained, 'overhead', false).windup < buildAttack(heavy, 'overhead', false).windup);
  const short = face(2, { bladeLength: 0.5 }).get(A)!;
  const shortTrained = face(2, { bladeLength: 0.5, training: { shortBlade: 3 } }).get(A)!;
  assert.ok(parryWindow(shortTrained) > parryWindow(short));
});
