import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ATTACKS } from './constants.js';
import { Duel } from './duel.js';
import { DuelAI, PERSONALITIES, freshMemory, seededRandom, type PersonalityName, type RivalMemory } from './ai.js';
import { yawTo } from './math.js';
import type { DuelEvent, DuelistInput, TechniqueId } from './types.js';
import { cleanTraining } from './duelist.js';

function arena(): Duel {
  const duel = new Duel();
  duel.add('ai', { x: 0, z: 0 }, 0);
  duel.add('foe', { x: 0, z: 3.2 }, Math.PI);
  return duel;
}

test('AI-vs-AI soak: every pairing fights, stays finite, and never freezes in one phase', () => {
  const names = Object.keys(PERSONALITIES) as PersonalityName[];
  for (const x of names) {
    for (const y of names) {
      const duel = new Duel();
      duel.add('x', { x: 0, z: 0 }, 0);
      duel.add('y', { x: 0, z: 3 }, Math.PI);
      const ax = new DuelAI('x', 'y', PERSONALITIES[x], freshMemory(), seededRandom(names.indexOf(x) * 7 + names.indexOf(y)));
      const ay = new DuelAI('y', 'x', PERSONALITIES[y], freshMemory(), seededRandom(99 + names.indexOf(y)));
      const stuck = { x: 0, y: 0 };
      let attacks = 0;
      for (let t = 0; t < 60 * 90; t++) {
        const ev = duel.step({ x: ax.think(duel), y: ay.think(duel) });
        ax.learn(ev, duel); ay.learn(ev, duel);
        attacks += ev.filter(e => e.type === 'attack_start').length;
        for (const f of duel.fighters) {
          assert.ok(Number.isFinite(f.pos.x + f.pos.z + f.stamina + f.posture + f.vitality + f.composure), `${x}/${y} NaN`);
          const key = f.id as 'x' | 'y';
          stuck[key] = f.phase === 'ready' || f.phase === 'dead' || f.phase === 'sheathed' ? 0 : stuck[key] + 1;
          assert.ok(stuck[key] < 60 * 4, `${x}/${y}: ${f.id} stuck in ${f.phase}`);
        }
        if (duel.fighters.some(f => f.phase === 'dead')) break;
      }
      assert.ok(attacks > 0, `${x} vs ${y} never fought`);
    }
  }
});

test('the AI cannot react to an attack faster than its reaction time', () => {
  const duel = arena();
  duel.get('foe')!.pos.z = 1.5;
  const ai = new DuelAI('ai', 'foe', { ...PERSONALITIES.counter, parry: 1, evade: 0 }, freshMemory(), seededRandom(3));
  const start = 30;
  let firstReaction = -1;
  for (let t = 0; t < 90; t++) {
    const foe: DuelistInput = { move: { x: 0, z: 0 }, facing: Math.PI, guard: false, attack: t === start ? { dir: 'overhead', committed: true } : undefined };
    const input = ai.think(duel);
    if (t > start && firstReaction < 0 && (input.parry || input.guard || input.step)) firstReaction = t;
    ai.learn(duel.step({ ai: input, foe }), duel);
  }
  assert.ok(firstReaction >= start + Math.round(PERSONALITIES.counter.reaction * 60), `reacted at ${firstReaction}`);
});

/**
 * A defender with a reflex: whenever a cut comes, they guard their right. Between cuts they
 * show nothing, so the habit can only be exploited by remembering it.
 */
function encounterAgainstRightGuard(memory: RivalMemory, seed: number): { leftShare: number; events: DuelEvent[] } {
  const duel = arena();
  const ai = new DuelAI('ai', 'foe', PERSONALITIES.aggressive, memory, seededRandom(seed));
  const events: DuelEvent[] = [];
  for (let t = 0; t < 60 * 60; t++) {
    const foe = duel.get('foe')!;
    const me = duel.get('ai')!;
    const incoming = me.phase === 'windup' || me.phase === 'active';
    const foeInput: DuelistInput = { move: { x: 0, z: 0 }, facing: yawTo(foe.pos, me.pos), guard: incoming, guardLine: 'right' };
    const ev = duel.step({ ai: ai.think(duel), foe: foeInput });
    ai.learn(ev, duel);
    events.push(...ev);
    // Keep the defender standing so the habit can be sampled for the whole encounter.
    foe.vitality = 100;
    foe.posture = 0;
    foe.stamina = 100;
  }
  const lines = events.filter(e => e.a === 'ai' && e.type === 'attack_start' && e.kind !== 'wind_step').map(e => ATTACKS[e.kind as keyof typeof ATTACKS].line);
  ai.conclude(true);
  return { leftShare: lines.filter(l => l === 'left').length / Math.max(1, lines.length), events };
}

test('a remembered habit is exploited more in later encounters', () => {
  const firsts: number[] = [], thirds: number[] = [];
  for (const seed of [11, 23, 37, 41]) {
    const memory = freshMemory();
    firsts.push(encounterAgainstRightGuard(memory, seed).leftShare);
    encounterAgainstRightGuard(memory, seed + 1);
    thirds.push(encounterAgainstRightGuard(memory, seed + 2).leftShare);
    assert.equal(memory.encounters, 3);
  }
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  assert.ok(mean(thirds) > mean(firsts) + 0.15, `left-line share ${mean(firsts).toFixed(2)} → ${mean(thirds).toFixed(2)}`);
});

test('on the fourth encounter the rival changes its approach', () => {
  const memory = freshMemory();
  memory.encounters = 3;
  const ai = new DuelAI('ai', 'foe', PERSONALITIES.patient, memory);
  assert.notEqual(ai.personality.name, 'patient');
});

test('a trained rival uses what it knows: it binds instead of parrying, and voids a committed cut', () => {
  const answers = (known: TechniqueId[]) => {
    const duel = arena();
    duel.get('foe')!.pos.z = 1.5;
    duel.get('ai')!.training = cleanTraining({ known });
    const ai = new DuelAI('ai', 'foe', { ...PERSONALITIES.counter, parry: 0.5, evade: 1 }, freshMemory(), seededRandom(5));
    let binds = 0, voids = 0;
    for (let t = 0; t < 60 * 40; t++) {
      const foe = duel.get('foe')!;
      const attack = foe.phase === 'ready' && t % 90 === 0 ? { dir: 'overhead' as const, committed: t % 180 === 0 } : undefined;
      const input = ai.think(duel);
      if (input.bind) binds++;
      if (input.technique === 'void_step') voids++;
      ai.learn(duel.step({ ai: input, foe: { move: { x: 0, z: 0 }, facing: Math.atan2(duel.get('ai')!.pos.x - foe.pos.x, duel.get('ai')!.pos.z - foe.pos.z), guard: false, attack } }), duel);
      for (const f of duel.fighters) if (f.phase === 'dead') { f.phase = 'ready'; f.vitality = 100; }
    }
    return { binds, voids };
  };
  const untrainedAnswers = answers(['wind_step']);
  const trainedAnswers = answers(['wind_step', 'maki_otoshi', 'void_step']);
  assert.equal(untrainedAnswers.binds + untrainedAnswers.voids, 0, 'nothing it has not learned');
  assert.ok(trainedAnswers.binds > 0, `binds ${trainedAnswers.binds}`);
  assert.ok(trainedAnswers.voids > 0, `voids ${trainedAnswers.voids}`);
});
