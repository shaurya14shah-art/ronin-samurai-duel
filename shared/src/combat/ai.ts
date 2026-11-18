import { ATTACKS, COMMITTED, DT, PARRY } from './constants.js';
import type { Duel } from './duel.js';
import { buildAttack, knows } from './duelist.js';
import { dist, yawTo, type Vec2 } from './math.js';
import type { AttackDir, AttackKind, Duelist, DuelEvent, DuelistInput, Line, Phase, Stance } from './types.js';

// The AI is just another source of DuelistInput. It sees its opponent only through a
// reaction-delayed observation buffer and is judged by the same sim as a human.

export type PersonalityName = 'patient' | 'aggressive' | 'counter' | 'survivor' | 'teacher';

export interface Personality {
  name: PersonalityName;
  /** Seconds between what happens and what the AI can react to. */
  reaction: number;
  /** Preferred centre distance offset from the clean-cut band (m). */
  spacing: number;
  /** Seconds of neutral before initiating; lower = more pressure. */
  patience: number;
  /** Chance per read attack of answering with a parry rather than guard/step. */
  parry: number;
  /** Chance an initiated attack is a feint first. */
  feint: number;
  /** Chance an initiated attack is committed. */
  commit: number;
  /** Preference for stepping out over guarding. */
  evade: number;
  stance: Stance;
}

export const PERSONALITIES: Record<PersonalityName, Personality> = {
  patient: { name: 'patient', reaction: 0.24, spacing: 0.25, patience: 2.6, parry: 0.35, feint: 0.15, commit: 0.2, evade: 0.35, stance: 'middle' },
  aggressive: { name: 'aggressive', reaction: 0.26, spacing: -0.1, patience: 0.7, parry: 0.15, feint: 0.2, commit: 0.4, evade: 0.15, stance: 'high' },
  counter: { name: 'counter', reaction: 0.22, spacing: 0.35, patience: 4.0, parry: 0.6, feint: 0.25, commit: 0.15, evade: 0.3, stance: 'empty' },
  survivor: { name: 'survivor', reaction: 0.25, spacing: 0.5, patience: 2.0, parry: 0.2, feint: 0.3, commit: 0.1, evade: 0.7, stance: 'low' },
  teacher: { name: 'teacher', reaction: 0.3, spacing: 0.15, patience: 1.8, parry: 0.3, feint: 0.1, commit: 0.15, evade: 0.3, stance: 'middle' },
};

const DIRS: AttackDir[] = ['overhead', 'diag_l', 'diag_r', 'horiz_l', 'horiz_r', 'thrust', 'low'];
const LINES: Line[] = ['high', 'left', 'right', 'center', 'low'];

/** What the AI has learned about one opponent. Plain data: persisted between encounters. */
export interface Habits {
  attacks: Record<AttackDir, number>;
  /** How often each line was covered by the opponent's guard when a cut arrived. */
  guarded: Record<Line, number>;
  /** Cuts that arrived on each line and landed. */
  landed: Record<Line, number>;
  parries: number;
  parriesWhiffed: number;
  feints: number;
  committedWhiffs: number;
  stepsBack: number;
  stepsSide: number;
  samples: number;
}

export interface RivalMemory {
  encounters: number;
  wins: number;
  losses: number;
  habits: Habits;
}

const zero = <K extends string>(keys: readonly K[]): Record<K, number> =>
  Object.fromEntries(keys.map(k => [k, 0])) as Record<K, number>;

export function freshHabits(): Habits {
  return { attacks: zero(DIRS), guarded: zero(LINES), landed: zero(LINES), parries: 0, parriesWhiffed: 0, feints: 0, committedWhiffs: 0, stepsBack: 0, stepsSide: 0, samples: 0 };
}

export function freshMemory(): RivalMemory {
  return { encounters: 0, wins: 0, losses: 0, habits: freshHabits() };
}

/** Seeded PRNG (mulberry32). AI decisions may be random; rules never are. */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Observation {
  tick: number;
  pos: Vec2;
  phase: Phase;
  phaseTime: number;
  kind: AttackKind | null;
  committed: boolean;
  guarding: boolean;
  guardLine: Line;
  /** Heard, not read off a meter: heavy breathing below ~30 stamina. */
  winded: boolean;
  drawn: boolean;
}

function observe(d: Duelist, tick: number): Observation {
  return {
    tick, pos: { ...d.pos }, phase: d.phase, phaseTime: d.phaseTime, kind: d.attack?.kind ?? null,
    committed: d.attack?.committed ?? false, guarding: d.guarding, guardLine: d.guardLine, winded: d.stamina < 30,
    drawn: d.drawn,
  };
}

/**
 * How strongly the rival leans on what it has learned, by encounter number (1-based).
 * Encounter 1 fights on instinct; 2 recognises habits; 3 counters them; 4 changes approach;
 * 5+ weighs the current fight over history, forcing the player to keep evolving.
 */
export function exploitWeight(encounter: number): number {
  return [0.15, 0.15, 0.5, 0.85, 0.6, 0.75][Math.min(encounter, 5)];
}

export class DuelAI {
  private seen: Observation[] = [];
  private neutral = 0;
  private plan: { kind: AttackKind; committed: boolean; feintFirst: boolean } | null = null;
  private answer: 'none' | 'hold' | 'parry' | 'step' | 'guard' | 'spent' = 'none';
  private parryAt = 0;
  private readAttackKey = '';
  private feintedThisAttack = false;
  private circle = 1;
  private circleTimer = 0;
  private stepIn: { kind: AttackKind; committed: boolean } | null = null;
  private recovering = false;
  /** Habits learned during this fight only. */
  readonly fight = freshHabits();
  readonly personality: Personality;
  readonly encounter: number;

  constructor(
    readonly id: string,
    readonly opponentId: string,
    personality: Personality,
    readonly memory: RivalMemory = freshMemory(),
    private readonly random: () => number = seededRandom(1),
  ) {
    this.encounter = memory.encounters + 1;
    // Encounter 4: the rival abandons the approach the player has learned to beat.
    this.personality = this.encounter === 4 ? PERSONALITIES[shift(personality.name)] : personality;
  }

  /** Feed the events of a tick so the AI can learn the opponent's habits. */
  learn(events: DuelEvent[], duel: Duel): void {
    for (const e of events) {
      for (const h of [this.fight, this.memory.habits]) {
        if (e.a === this.opponentId && e.type === 'attack_start' && e.kind && e.kind in h.attacks) { h.attacks[e.kind as AttackDir]++; h.samples++; }
        if (e.b === this.opponentId && e.type === 'block' && e.line) h.guarded[e.line] += e.quality ?? 1;
        if (e.b === this.opponentId && e.type === 'hit' && e.line) h.landed[e.line]++;
        if (e.a === this.opponentId && e.type === 'parry') h.parries++;
        if (e.a === this.opponentId && e.type === 'parry_whiff') h.parriesWhiffed++;
        if (e.a === this.opponentId && e.type === 'feint') h.feints++;
        if (e.a === this.opponentId && e.type === 'whiff') {
          const opp = duel.get(this.opponentId);
          if (opp?.attack?.committed) h.committedWhiffs++;
        }
        if (e.a === this.opponentId && e.type === 'step') {
          const opp = duel.get(this.opponentId);
          const me = duel.get(this.id);
          if (opp && me) {
            const away = (opp.stepDir.x * (opp.pos.x - me.pos.x) + opp.stepDir.z * (opp.pos.z - me.pos.z)) > 0.3 * dist(opp.pos, me.pos);
            if (away) h.stepsBack++; else h.stepsSide++;
          }
        }
      }
    }
  }

  /** Close the encounter: decay old knowledge so recent behaviour matters most. */
  conclude(won: boolean): RivalMemory {
    const h = this.memory.habits;
    const decay = (r: Record<string, number>) => { for (const k of Object.keys(r)) r[k] *= 0.7; };
    decay(h.attacks); decay(h.guarded); decay(h.landed);
    for (const k of ['parries', 'parriesWhiffed', 'feints', 'committedWhiffs', 'stepsBack', 'stepsSide', 'samples'] as const) h[k] *= 0.7;
    this.memory.encounters++;
    if (won) this.memory.wins++; else this.memory.losses++;
    return this.memory;
  }

  think(duel: Duel): DuelistInput {
    const me = duel.get(this.id)!;
    const opp = duel.get(this.opponentId)!;
    this.seen.push(observe(opp, duel.tick));
    const lag = Math.round(this.personality.reaction / DT);
    while (this.seen.length > 1 && this.seen[1].tick <= duel.tick - lag) this.seen.shift();
    const o = this.seen[0];
    const input: DuelistInput = { move: { x: 0, z: 0 }, facing: yawTo(me.pos, o.pos), guard: false };
    if (me.phase === 'dead' || o.phase === 'dead') return input;
    if (me.stance !== this.personality.stance && me.phase === 'ready' && duel.tick < 30) {
      input.stance = this.personality.stance;
      return input;
    }
    const d = dist(me.pos, o.pos);
    if (me.phase === 'sheathed') {
      // Standoff: while the other blade stays sheathed and out of reach, so does ours.
      // If they walk into draw-cut range still sheathed, that is the opening.
      if (!o.drawn && d > 3.2) return input;
      if (!o.drawn && d < me.armReach + me.bladeLength + 0.2) input.attack = { dir: 'horiz_l', committed: false };
      else input.draw = true;
      return input;
    }

    const myReach = me.armReach + me.bladeLength;
    // Hold one step outside the reach of a cut, and step in to strike: the gap is where a
    // duel is read, and the step-in is the telegraph an opponent can answer.
    const ideal = myReach + 0.4 + this.personality.spacing * 0.6;

    // A step-in attack: the cut is requested during the step and buffered by the sim.
    if (this.stepIn) {
      if (me.phase === 'step') { input.attack = { dir: this.stepIn.kind as AttackDir, committed: this.stepIn.committed }; return input; }
      if (me.phase !== 'windup') this.stepIn = null;
    }

    // Mid-attack: decide whether to feint, otherwise let it fly.
    if (me.phase === 'windup' && me.attack) {
      this.stepIn = null;
      if (this.plan?.feintFirst && !this.feintedThisAttack && me.phaseTime > me.attack.commitAt * 0.5) {
        this.feintedThisAttack = true;
        this.plan = { ...this.plan, feintFirst: false };
        input.feint = true;
      }
      return input;
    }

    // Reading an incoming attack.
    const threat = (o.phase === 'windup' || o.phase === 'active') && o.kind && d < myReach + 0.7;
    if (threat && o.kind) {
      return this.defend(duel, me, o, d, input);
    }
    this.answer = 'none';
    this.readAttackKey = '';

    // Punish an opening we can see.
    const opening = o.phase === 'recover' || o.phase === 'stagger' || o.phase === 'parry';
    if (opening && me.phase === 'ready' && d <= myReach + 0.25) {
      input.attack = { dir: this.pickAttack(o, d, me), committed: o.phase === 'stagger' };
      return input;
    }
    if (opening && me.phase === 'ready' && d <= myReach + 0.85 && me.stamina > 30) {
      this.stepIn = { kind: this.pickAttack(o, d - 0.7, me), committed: o.phase === 'stagger' };
      input.step = { x: 0, z: 1 };
      return input;
    }

    // Winded: give ground to recover. A held guard drains stamina, so only raise it
    // when the opponent is close enough to cut.
    const oppReach = me.armReach + me.bladeLength + 0.3;
    if (me.stamina < 25 || this.recovering) {
      this.recovering = me.stamina < 60;
      input.move = { x: this.circle * 0.3, z: d < oppReach + 0.9 ? -1 : 0 };
      input.guard = d < oppReach;
      input.guardLine = this.expectedLine();
      return input;
    }

    // Neutral: manage distance, then decide to commit.
    this.neutral += DT;
    this.circleTimer -= DT;
    if (this.circleTimer <= 0) {
      this.circle = this.random() < 0.5 ? -1 : 1;
      this.circleTimer = 0.8 + this.random() * 1.2;
    }
    const gap = d - ideal;
    input.move = { x: this.circle * 0.4, z: Math.max(-1, Math.min(1, gap * 1.5)) };
    input.guard = this.personality.name !== 'counter' && d < oppReach && me.stamina > 50;
    input.guardLine = this.expectedLine();

    const patience = this.personality.patience * (o.winded ? 0.5 : 1) * (this.habitWaits() ? 1.6 : 1);
    if (me.phase === 'ready' && this.neutral > patience) {
      if (d > ideal + 0.9 && d < 3.3 && me.stamina > 55 && this.random() < 0.35 && this.personality.name !== 'counter') {
        input.technique = 'wind_step';
        input.guard = false;
        this.neutral = 0;
        return input;
      }
      if (gap < 0.5 && gap > -0.7) {
        const inReach = d - 0.28 <= myReach - 0.05;
        const kind = this.pickAttack(o, inReach ? d : d - 0.7, me);
        const committed = this.random() < this.personality.commit;
        const feintFirst = this.random() < this.personality.feint * (1 + this.memoryOf('parries'));
        this.plan = { kind, committed, feintFirst };
        this.feintedThisAttack = false;
        // A rival who knows kesa-giri uses it to break a guard it sees held.
        if (inReach && knows(me, 'kesa_giri') && o.guarding && me.stamina > 45 && this.random() < 0.45) { input.technique = 'kesa_giri'; input.guard = false; this.neutral = 0; return input; }
        if (inReach) input.attack = { dir: kind as AttackDir, committed };
        else { this.stepIn = { kind, committed }; input.step = { x: 0, z: 1 }; }
        input.guard = false;
        this.neutral = 0;
      }
    } else if (d < ideal - 0.45 && me.phase === 'ready' && me.stamina > 40 && this.random() < 0.05) {
      input.step = { x: 0, z: -1 };
    }
    return input;
  }

  private defend(duel: Duel, me: Duelist, o: Observation, d: number, input: DuelistInput): DuelistInput {
    const kind = o.kind!;
    const startTick = o.tick - Math.round(o.phaseTime / DT);
    const key = `${startTick}:${kind}`;
    if (key !== this.readAttackKey) {
      // Choose an answer once per read attack.
      this.readAttackKey = key;
      const attacker = duel.get(this.opponentId)!;
      const def = ATTACKS[kind];
      const reach = buildAttack(attacker, kind, o.committed).reach + def.lungeActive + def.lungeWindup;
      const parryBias = this.personality.parry * me.composure * (1 - Math.min(0.6, this.memoryOf('feints')));
      const roll = this.random();
      if (d - 0.28 > reach) {
        this.answer = 'hold';
      } else if (roll < parryBias) {
        const windup = def.windup * (o.committed ? COMMITTED.windup : 1);
        const arrival = startTick + Math.round(windup / DT) + Math.round(def.active * 0.35 / DT);
        this.parryAt = arrival - Math.round((PARRY.delay + PARRY.window * 0.45) / DT);
        this.answer = 'parry';
      } else if (roll < parryBias + this.personality.evade * (1 - parryBias)) {
        this.answer = 'step';
      } else {
        this.answer = 'guard';
      }
    }
    const line = ATTACKS[kind].line;
    switch (this.answer) {
      case 'hold':
        // Out of reach: give a little ground and let it whiff.
        input.move = { x: 0, z: -0.3 };
        break;
      case 'parry':
        if (duel.tick >= this.parryAt && me.phase === 'ready') {
          input.parry = true;
          // A rival trained in maki-otoshi binds the blade instead.
          if (knows(me, 'maki_otoshi')) input.bind = true;
          this.answer = 'spent';
        }
        break;
      case 'step':
        if (me.phase === 'ready') {
          // Thrusts are beaten sideways, wide cuts backwards; a committed cut, by one who knows
          // the void step, is stepped off and countered.
          if (o.committed && knows(me, 'void_step') && me.stamina > 30) input.technique = 'void_step', input.move = { x: this.circle, z: 0 };
          else input.step = line === 'center' ? { x: this.circle, z: 0 } : { x: 0, z: -1 };
          this.answer = 'guard';
        }
        break;
      case 'guard':
        input.guard = true;
        input.guardLine = line;
        break;
    }
    return input;
  }

  /**
   * Share of each key across within-fight and remembered habits (sums to 1 when there is data).
   * From encounter 5 the current fight counts for more than history.
   */
  private shares<K extends string>(pick: (h: Habits) => Record<K, number>): Record<K, number> {
    const now = pick(this.fight), past = pick(this.memory.habits);
    const sum = (r: Record<K, number>) => Object.values<number>(r).reduce((a, b) => a + b, 0);
    const sn = sum(now), sp = sum(past);
    const recent = sp === 0 ? 1 : sn === 0 ? 0 : this.encounter >= 5 ? 0.7 : 0.4;
    const out = {} as Record<K, number>;
    for (const k of Object.keys(now) as K[]) {
      out[k] = recent * (sn ? now[k] / sn : 0) + (1 - recent) * (sp ? past[k] / sp : 0);
    }
    return out;
  }

  private memoryOf(key: 'parries' | 'feints' | 'committedWhiffs'): number {
    const h = this.memory.habits, f = this.fight;
    const samples = Math.max(4, h.samples + f.samples);
    return Math.min(1, ((h[key] + f[key]) / samples) * exploitWeight(this.encounter) * 4);
  }

  /** Opponent who whiffs committed strikes: wait for it. */
  private habitWaits(): boolean {
    return this.memoryOf('committedWhiffs') > 0.3;
  }

  /** Guard where the opponent tends to cut. */
  private expectedLine(): Line {
    const attacks = this.shares(h => h.attacks);
    const byLine: Record<Line, number> = zero(LINES);
    for (const k of DIRS) byLine[ATTACKS[k].line] += attacks[k];
    // Only trust the read once it stands out from an even spread.
    let best: Line = 'center', score = 0.3 / exploitWeight(this.encounter);
    for (const l of LINES) if (byLine[l] > score) { best = l; score = byLine[l]; }
    return best;
  }

  /**
   * How often a cut on each line has landed against this opponent (Laplace-smoothed).
   * From encounter 5 the current fight weighs double: old reads stop being enough.
   */
  private lineSuccess(line: Line): number {
    const now = this.encounter >= 5 ? 2 : 1;
    const landed = this.fight.landed[line] * now + this.memory.habits.landed[line];
    const stopped = this.fight.guarded[line] * now + this.memory.habits.guarded[line];
    return (landed + 1) / (landed + stopped + 2);
  }

  /** Choose a cut: favour lines that have worked; the teacher keeps pressing the weakest. */
  private pickAttack(o: Observation, d: number, me: Duelist): AttackDir {
    const exploit = exploitWeight(this.encounter);
    const sharpen = this.personality.name === 'teacher' ? 4 : 2;
    const weights = DIRS.map(k => {
      const line = ATTACKS[k].line;
      const reach = buildAttack(me, k, false).reach + ATTACKS[k].lungeActive;
      if (d - 0.28 > reach - 0.08) return 0;
      let w = (1 - exploit) + exploit * this.lineSuccess(line) ** sharpen;
      if (o.guarding && o.guardLine === line) w *= 0.2;
      if (this.personality.name === 'survivor' && (k === 'low' || k.startsWith('horiz'))) w *= 1.6;
      if (this.personality.name === 'aggressive' && (k === 'overhead' || k.startsWith('diag'))) w *= 1.4;
      return Math.max(0.02, w);
    });
    if (weights.every(w => w === 0)) return 'thrust';
    let r = this.random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < DIRS.length; i++) { r -= weights[i]; if (r <= 0) return DIRS[i]; }
    return 'diag_l';
  }
}

function shift(name: PersonalityName): PersonalityName {
  const next: Record<PersonalityName, PersonalityName> = { patient: 'aggressive', aggressive: 'counter', counter: 'patient', survivor: 'counter', teacher: 'aggressive' };
  return next[name];
}

