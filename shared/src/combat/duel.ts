import { BODY_RADIUS } from './constants.js';
import { advance, applyInput, createDuelist, type DuelistOptions, type StepContext } from './duelist.js';
import { applyOutcome, judgeDefence, resolveClash, sweepHits, attackPose, type Outcome } from './resolve.js';
import { dist, type Vec2 } from './math.js';
import type { ActiveAttack, Contact, Duelist, DuelEvent, DuelistInput } from './types.js';

export function idleInput(facing: number): DuelistInput {
  return { move: { x: 0, z: 0 }, facing, guard: false };
}

interface PendingHit { att: Duelist; def: Duelist; a: ActiveAttack; contact: Contact; outcome: Outcome }

/**
 * A deterministic sword duel between any number of fighters.
 * Step order per tick: inputs → advance → body separation → clashes → hits (collected, then applied).
 */
export class Duel {
  public tick = 0;
  public readonly fighters: Duelist[] = [];
  /** True until the first clean strike lands. */
  public firstStrikeAvailable = true;

  add(id: string, pos: Vec2, facing: number, opts?: DuelistOptions): Duelist {
    const d = createDuelist(id, pos, facing, opts);
    this.fighters.push(d);
    return d;
  }

  remove(id: string): void {
    const i = this.fighters.findIndex(f => f.id === id);
    if (i >= 0) this.fighters.splice(i, 1);
  }

  get(id: string): Duelist | undefined {
    return this.fighters.find(f => f.id === id);
  }

  step(inputs: Record<string, DuelistInput | undefined>): DuelEvent[] {
    const events: DuelEvent[] = [];
    const ctx: StepContext = { tick: this.tick, events, firstStrikeAvailable: this.firstStrikeAvailable };
    const inputFor = (d: Duelist) => inputs[d.id] ?? idleInput(d.facing);

    for (const d of this.fighters) applyInput(d, inputFor(d), ctx);
    for (const d of this.fighters) advance(d, inputFor(d), ctx);
    this.separate();

    for (let i = 0; i < this.fighters.length; i++) {
      for (let j = i + 1; j < this.fighters.length; j++) resolveClash(this.fighters[i], this.fighters[j], ctx);
    }

    // Collect every hit against the state as it stands, then apply: simultaneous cuts trade.
    const pending: PendingHit[] = [];
    for (const att of this.fighters) {
      const a = att.attack;
      if (att.phase !== 'active' || !a) continue;
      const progress = Math.min(1, att.phaseTime / a.active);
      for (const def of this.fighters) {
        if (def === att || def.phase === 'dead' || a.resolved.includes(def.id)) continue;
        const contact = sweepHits(att, def, a, progress);
        if (!contact) continue;
        a.resolved.push(def.id);
        pending.push({ att, def, a, contact, outcome: judgeDefence(att, def, a) });
      }
      a.prevAngle = attackPose(a, progress).angle;
    }
    for (const h of pending) {
      if (h.def.phase === 'dead') continue;
      applyOutcome(h.att, h.def, h.a, h.contact, h.outcome, ctx);
      if (h.outcome.kind === 'hit' && h.contact === 'clean') this.firstStrikeAvailable = false;
    }

    this.tick++;
    return events;
  }

  /** Keep bodies from overlapping. Symmetric, order-independent for a pair. */
  private separate(): void {
    const min = BODY_RADIUS * 2;
    for (let i = 0; i < this.fighters.length; i++) {
      for (let j = i + 1; j < this.fighters.length; j++) {
        const p = this.fighters[i], q = this.fighters[j];
        if (p.phase === 'dead' || q.phase === 'dead') continue;
        const d = dist(p.pos, q.pos);
        if (d >= min) continue;
        const nx = d > 1e-6 ? (q.pos.x - p.pos.x) / d : 1;
        const nz = d > 1e-6 ? (q.pos.z - p.pos.z) / d : 0;
        const push = (min - d) / 2;
        p.pos.x -= nx * push; p.pos.z -= nz * push;
        q.pos.x += nx * push; q.pos.z += nz * push;
      }
    }
  }

  /** Deep copy of all state, for prediction rollback and replays. */
  snapshot(): DuelSnapshot {
    return JSON.parse(JSON.stringify({ tick: this.tick, firstStrikeAvailable: this.firstStrikeAvailable, fighters: this.fighters }));
  }

  restore(s: DuelSnapshot): void {
    const copy: DuelSnapshot = JSON.parse(JSON.stringify(s));
    this.tick = copy.tick;
    this.firstStrikeAvailable = copy.firstStrikeAvailable;
    this.fighters.length = 0;
    this.fighters.push(...copy.fighters);
  }

  /** FNV-1a over the serialised state. Equal hashes ⇔ identical simulations. */
  hash(): string {
    const text = JSON.stringify(this.snapshot());
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }
}

export interface DuelSnapshot {
  tick: number;
  firstStrikeAvailable: boolean;
  fighters: Duelist[];
}
