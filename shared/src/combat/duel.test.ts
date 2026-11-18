import { test } from 'node:test';
import assert from 'node:assert/strict';
import { A, B, face, of, run, ticks } from './testkit.js';
import { ATTACKS, COST, MAX_POSTURE, STEP } from './constants.js';
import { Duel } from './duel.js';
import type { AttackDir, DuelistInput } from './types.js';

const atk = (dir: AttackDir, committed = false) => ({ attack: { dir, committed } });

test('identical inputs produce identical simulations; snapshots replay exactly', () => {
  const script = (t: number) => {
    const r = Math.sin(t * 12.9898) * 43758.5453;
    const k = Math.floor((r - Math.floor(r)) * 40);
    const dirs: AttackDir[] = ['overhead', 'diag_l', 'diag_r', 'horiz_l', 'horiz_r', 'thrust', 'low'];
    return {
      [A]: k < 7 ? atk(dirs[k]) : k === 8 ? { parry: true } : k === 9 ? { step: { x: 1, z: 0 } } : { move: { x: 0, z: 0.5 } },
      [B]: k > 30 ? atk(dirs[k % 7], k % 2 === 0) : k === 11 ? { feint: true } : { guard: k % 3 === 0, guardLine: 'right' as const },
    };
  };
  const one = face(1.6), two = face(1.6);
  run(one, 600, script);
  run(two, 300, script);
  const snap = two.snapshot();
  const three = new Duel();
  three.restore(snap);
  run(two, 300, (t) => script(t + 300));
  run(three, 300, (t) => script(t + 300));
  assert.equal(one.hash(), two.hash());
  assert.equal(two.hash(), three.hash());
});

test('distance decides which part of the blade arrives', () => {
  const contactAt = (d: number) => {
    const duel = face(d);
    const ev = run(duel, ticks(1), t => (t === 0 ? { [A]: atk('diag_l') } : {}));
    return of(ev, 'hit')[0]?.contact ?? (of(ev, 'whiff').length ? 'whiff' : 'none');
  };
  // Lunge during the active phase is 0.2 m, so test distances account for it.
  assert.equal(contactAt(1.55), 'clean');
  assert.equal(contactAt(1.2), 'mid');
  assert.equal(contactAt(0.7), 'jammed');
  assert.equal(contactAt(2.4), 'whiff');
});

test('a hit lands only after the windup, and a whiff recovers longer than contact', () => {
  const duel = face(1.5);
  const ev = run(duel, ticks(1.5), t => (t === 0 ? { [A]: atk('diag_l') } : {}));
  const hit = of(ev, 'hit')[0];
  assert.ok(hit.tick >= ticks(ATTACKS.diag_l.windup), 'cut cannot land during windup');

  const recoveryTicks = (d: number) => {
    const duel = face(d);
    let start = -1, end = -1;
    run(duel, ticks(2), (t, du) => {
      const f = du.get(A)!;
      if (f.phase === 'recover' && start < 0) start = t;
      if (start >= 0 && end < 0 && f.phase === 'ready') end = t;
      return t === 0 ? { [A]: atk('diag_l') } : {};
    });
    return end - start;
  };
  assert.ok(recoveryTicks(3) > recoveryTicks(1.5), 'whiffing leaves you open for longer');
});

test('a committed thrust cannot track a sidestep, but a horizontal still catches it', () => {
  const outcome = (dir: AttackDir) => {
    const duel = face(1.6);
    const ev = run(duel, ticks(1.5), t => ({
      [A]: t === 0 ? atk(dir, true) : {},
      // B reads the commit and steps off the line.
      [B]: t === ticks(0.27) ? { step: { x: 1, z: 0 } } : {},
    }));
    return of(ev, 'hit').length ? 'hit' : 'miss';
  };
  assert.equal(outcome('thrust'), 'miss');
  assert.equal(outcome('horiz_l'), 'hit');
});

test('guard must meet the line the cut arrives on', () => {
  const vs = (dir: AttackDir, guardLine: DuelistInput['guardLine']) => {
    const duel = face(1.5);
    const ev = run(duel, ticks(1), t => ({ [A]: t === 0 ? atk(dir) : {}, [B]: { guard: true, guardLine } }));
    if (of(ev, 'block').length) return `block:${of(ev, 'block')[0].quality}`;
    return of(ev, 'hit').length ? 'hit' : 'none';
  };
  assert.equal(vs('diag_l', 'right'), 'block:1');
  assert.equal(vs('diag_l', 'left'), 'hit');
  assert.equal(vs('diag_l', 'center'), 'block:0.5');
  assert.equal(vs('low', 'center'), 'hit');
  assert.equal(vs('overhead', 'high'), 'block:1');
});

test('a poor block displaces the blade; repeated blocking breaks the guard', () => {
  const duel = face(1.5);
  let blocked: ReturnType<typeof run> = [];
  for (let t = 0; t < ticks(1) && !blocked.length; t++) {
    blocked = of(run(duel, 1, () => ({ [A]: t === 0 ? atk('diag_l') : {}, [B]: { guard: true, guardLine: 'center' } })), 'block');
  }
  assert.equal(blocked[0].quality, 0.5);
  const b = duel.get(B)!;
  assert.ok(b.rattled > 0 && b.posture > 0);
  // While rattled, an attack request is refused.
  const refused = run(duel, 1, () => ({ [B]: atk('thrust') }));
  assert.equal(of(refused, 'attack_start').length, 0);

  const breaker = face(1.5);
  let breaks = 0;
  for (let i = 0; i < 8 && !breaks; i++) {
    const evs = run(breaker, ticks(1.1), t => ({ [A]: t === 0 ? atk('overhead', true) : {}, [B]: { guard: true, guardLine: 'high' } }));
    breaks += of(evs, 'guard_break').length;
    breaker.get(A)!.stamina = 100;
  }
  assert.equal(breaks, 1, 'sustained committed pressure on a held guard must break it');
});

test('a timed parry staggers the attacker and leaves time to counter; a mistimed one is punished', () => {
  const windup = ATTACKS.diag_l.windup;
  const parryAt = (pressTick: number) => {
    const duel = face(1.5);
    const ev = run(duel, ticks(2), t => ({
      [A]: t === 0 ? atk('diag_l') : {},
      [B]: t === pressTick ? { parry: true } : t > ticks(0.9) ? atk('thrust') : {},
    }));
    return ev;
  };
  // The blade reaches B early in the active phase; press so that the window covers it.
  const good = parryAt(ticks(windup) - 3);
  assert.equal(of(good, 'parry').length, 1);
  assert.ok(of(good, 'hit').some(e => e.a === B), 'parrier lands the counter');
  assert.ok(!of(good, 'hit').some(e => e.a === A));

  const early = parryAt(ticks(windup) - 25);
  assert.equal(of(early, 'parry').length, 0);
  assert.ok(of(early, 'hit').some(e => e.a === A && e.b === B), 'too-early parry gets cut');

  const nothing = face(3);
  const ev = run(nothing, ticks(0.6), t => ({ [B]: t === 0 ? { parry: true } : {} }));
  assert.equal(of(ev, 'parry_whiff').length, 1);
  assert.equal(nothing.get(B)!.phase, 'recover', 'a parry into nothing leaves you without guard');
});

test('blades meet: equal strikes deflect each other, a committed strike displaces a light one', () => {
  const both = (aCommitted: boolean) => {
    const duel = face(1.6);
    // Start the light strike later so both are active together.
    const delay = aCommitted ? ticks(ATTACKS.diag_l.windup * 1.55 - ATTACKS.diag_r.windup) : 0;
    return run(duel, ticks(1.5), t => ({ [A]: t === 0 ? atk('diag_l', aCommitted) : {}, [B]: t === delay ? atk('diag_r') : {} }));
  };
  const even = of(both(false), 'clash');
  assert.equal(even.length, 1);
  assert.equal(even[0].outcome, 'mutual');
  const uneven = of(both(true), 'clash');
  assert.equal(uneven.length, 1);
  assert.equal(uneven[0].outcome, B);
});

test('striking first interrupts a slower windup', () => {
  const duel = face(1.6);
  const ev = run(duel, ticks(1.5), t => ({ [A]: t === 4 ? atk('thrust') : {}, [B]: t === 0 ? atk('overhead', true) : {} }));
  assert.equal(of(ev, 'interrupt').length, 1);
  assert.ok(!of(ev, 'hit').some(e => e.a === B));
});

test('feints work only before the commit point and grow costlier when chained', () => {
  const duel = face(1.6);
  const ev = run(duel, ticks(0.25), t => ({ [A]: t === 0 ? atk('overhead') : t === 5 ? { feint: true } : {} }));
  assert.equal(of(ev, 'feint').length, 1);
  assert.equal(of(ev, 'attack_active').length, 0);

  const late = face(1.6);
  const ev2 = run(late, ticks(1), t => ({ [A]: t === 0 ? atk('overhead') : t === ticks(ATTACKS.overhead.windup * 0.8) ? { feint: true } : {} }));
  assert.equal(of(ev2, 'feint').length, 0);
  assert.equal(of(ev2, 'attack_active').length, 1);

  const chain = face(3);
  const costs: number[] = [];
  for (let i = 0; i < 3; i++) {
    const f = chain.get(A)!;
    run(chain, 1, () => ({ [A]: atk('overhead') }));
    const before = f.stamina;
    run(chain, 1, () => ({ [A]: { feint: true } }));
    costs.push(before - f.stamina);
    run(chain, ticks(0.2));
  }
  assert.ok(costs[1] > costs[0] && costs[2] > costs[1], `feint costs should escalate: ${costs}`);
});

test('a committed whiff costs composure and recovers longer than a light whiff', () => {
  const whiff = (committed: boolean) => {
    const duel = face(3.5);
    let rec = 0;
    run(duel, ticks(1.5), (t, du) => { if (du.get(A)!.phase === 'recover') rec++; return t === 0 ? { [A]: atk('diag_l', committed) } : {}; });
    return { rec, composure: duel.get(A)!.composure };
  };
  const light = whiff(false), heavy = whiff(true);
  assert.ok(heavy.rec > light.rec);
  assert.ok(heavy.composure < light.composure);
});

test('stamina gates actions; held guard drains; step spam escalates', () => {
  const duel = face(3);
  const a = duel.get(A)!;
  a.stamina = COST.attack - 1;
  const ev = run(duel, 1, () => ({ [A]: atk('diag_l') }));
  assert.equal(of(ev, 'attack_start').length, 0);

  const g = face(3);
  run(g, ticks(2), () => ({ [B]: { guard: true } }));
  assert.ok(g.get(B)!.stamina < 100);

  const s = face(5);
  const f = s.get(A)!;
  const spent: number[] = [];
  for (let i = 0; i < 3; i++) {
    const before = f.stamina;
    run(s, 1, () => ({ [A]: { step: { x: 1, z: 0 } } }));
    spent.push(before - f.stamina);
    run(s, ticks(STEP.duration) + 2);
  }
  assert.ok(spent[2] > spent[1] && spent[1] > spent[0], `${spent}`);
});

test('steps move the planned distance by direction, and leg wounds shorten them', () => {
  const back = face(5);
  run(back, ticks(0.4), t => ({ [A]: t === 0 ? { step: { x: 0, z: -1 } } : {} }));
  assert.ok(Math.abs(back.get(A)!.pos.z + STEP.back) < 0.02, `${back.get(A)!.pos.z}`);

  const hurt = face(5);
  hurt.get(A)!.wounds.leg = 2;
  run(hurt, ticks(0.4), t => ({ [A]: t === 0 ? { step: { x: 0, z: -1 } } : {} }));
  assert.ok(-hurt.get(A)!.pos.z < STEP.back * 0.75);
});

test('a low cut that lands clean wounds the leg', () => {
  const duel = face(1.45);
  const ev = run(duel, ticks(1), t => ({ [A]: t === 0 ? atk('low') : {} }));
  assert.equal(of(ev, 'hit')[0]?.wound, 'leg');
  assert.equal(duel.get(B)!.wounds.leg, 1);
});

test('stances change what is possible', () => {
  const empty = face(1.5, {}, { stance: 'empty' });
  const ev = run(empty, ticks(1), t => ({ [A]: t === 0 ? atk('diag_l') : {}, [B]: { guard: true, guardLine: 'right' } }));
  assert.equal(of(ev, 'block').length, 0, 'the empty stance has no guard');

  const windupIn = (stance: 'high' | 'low') => {
    const duel = face(4, { stance });
    const ev = run(duel, ticks(1), t => ({ [A]: t === 0 ? atk('overhead') : {} }));
    return of(ev, 'attack_active')[0].tick;
  };
  assert.ok(windupIn('high') < windupIn('low'));
});

test('sheathed fighters cannot guard; attacking from the sheath is a draw-cut', () => {
  const duel = face(1.5, {}, { drawn: false });
  const ev = run(duel, ticks(1), t => ({ [A]: t === 0 ? atk('diag_l') : {}, [B]: { guard: true, guardLine: 'right' } }));
  assert.equal(of(ev, 'block').length, 0);

  const iai = face(1.5, { drawn: false });
  const ev2 = run(iai, ticks(1), t => ({ [A]: t === 0 ? atk('thrust') : {} }));
  assert.equal(of(ev2, 'attack_start')[0].kind, 'draw_cut');
  assert.equal(iai.get(A)!.drawn, true);
});

test('the first clean strike of a duel carries extra weight', () => {
  const duel = face(1.55);
  run(duel, ticks(1), t => ({ [A]: t === 0 ? atk('diag_l') : {} }));
  const firstPosture = duel.get(B)!.posture;
  const later = face(1.55);
  later.firstStrikeAvailable = false;
  run(later, ticks(1), t => ({ [A]: t === 0 ? atk('diag_l') : {} }));
  assert.ok(firstPosture > later.get(B)!.posture);
  assert.equal(duel.firstStrikeAvailable, false);
});

test('Wind Step reaches from outside the range of an ordinary thrust', () => {
  const reach = (technique: boolean) => {
    const duel = face(2.9);
    const ev = run(duel, ticks(1.2), t => ({ [A]: t === 0 ? (technique ? { technique: 'wind_step' as const } : atk('thrust')) : {} }));
    return of(ev, 'hit').length > 0;
  };
  assert.equal(reach(false), false);
  assert.equal(reach(true), true);
});

test('bodies never overlap and posture breaks only at the maximum', () => {
  const duel = face(0.3);
  run(duel, ticks(0.5), () => ({ [A]: { move: { x: 0, z: 1 } }, [B]: { move: { x: 0, z: 1 } } }));
  const [p, q] = duel.fighters;
  assert.ok(Math.hypot(p.pos.x - q.pos.x, p.pos.z - q.pos.z) >= 0.56 - 1e-9);
  assert.ok(duel.get(A)!.posture <= MAX_POSTURE);
});

test('movement accelerates and decelerates instead of snapping', () => {
  const duel = face(6);
  run(duel, 1, () => ({ [A]: { move: { x: 0, z: 1 } } }));
  const v1 = Math.hypot(duel.get(A)!.vel.x, duel.get(A)!.vel.z);
  run(duel, ticks(1), () => ({ [A]: { move: { x: 0, z: 1 } } }));
  const vMax = Math.hypot(duel.get(A)!.vel.x, duel.get(A)!.vel.z);
  run(duel, 1);
  const vStop = Math.hypot(duel.get(A)!.vel.x, duel.get(A)!.vel.z);
  assert.ok(v1 < vMax * 0.2);
  assert.ok(vStop > 0 && vStop < vMax);
});

test('a heavier blade swings later but wins the clash it meets', () => {
  const activeTick = (mass: number) => {
    const duel = face(4, { bladeMass: mass });
    const ev = run(duel, ticks(1), t => ({ [A]: t === 0 ? atk('diag_l') : {} }));
    return of(ev, 'attack_active')[0].tick;
  };
  assert.ok(activeTick(1.6) > activeTick(1.1), 'heavier blade reaches the strike later');
  assert.ok(activeTick(0.8) < activeTick(1.1), 'lighter blade reaches it sooner');

  // Same cut, started so both are active together: the heavy blade displaces the light one.
  const duel = face(1.6, { bladeMass: 1.7 }, { bladeMass: 0.8 });
  const heavyLead = activeTick(1.7) - activeTick(0.8);
  const ev = run(duel, ticks(1.5), t => ({ [A]: t === 0 ? atk('diag_l') : {}, [B]: t === heavyLead ? atk('diag_r') : {} }));
  const clash = of(ev, 'clash')[0];
  assert.ok(clash, 'the blades meet');
  assert.equal(clash.outcome, B);
});
