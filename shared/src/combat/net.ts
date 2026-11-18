// Network contract for server-authoritative duels.
//
// Clients send only intent (DuelistInput); the server runs the sim and is the only authority on
// hits, damage and results. Everything a client sends passes through `sanitizeInput`: unknown
// fields are dropped, numbers are clamped, enums are checked. A malformed message is ignored.

import type { AttackDir, DuelistInput, Line, Stance } from './types.js';
import type { DuelEvent } from './types.js';
import { Duel, type DuelSnapshot } from './duel.js';

const DIRS: readonly AttackDir[] = ['overhead', 'diag_l', 'diag_r', 'horiz_l', 'horiz_r', 'thrust', 'low'];
const LINES: readonly Line[] = ['high', 'left', 'right', 'center', 'low'];
const STANCES: readonly Stance[] = ['high', 'middle', 'low', 'fluid', 'empty'];

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function vec(v: unknown): { x: number; z: number } | null {
  if (!v || typeof v !== 'object') return null;
  const x = num((v as any).x), z = num((v as any).z);
  if (x === null || z === null) return null;
  const l = Math.hypot(x, z);
  return l > 1 ? { x: x / l, z: z / l } : { x, z };
}

/** Turn an untrusted client message into a valid input, or null if it is not one. */
export function sanitizeInput(raw: unknown): DuelistInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const move = vec(r.move) ?? { x: 0, z: 0 };
  const facing = num(r.facing);
  if (facing === null || Math.abs(facing) > 1000) return null;
  const input: DuelistInput = { move, facing: Math.atan2(Math.sin(facing), Math.cos(facing)), guard: r.guard === true };
  if (typeof r.guardLine === 'string' && (LINES as readonly string[]).includes(r.guardLine)) input.guardLine = r.guardLine as Line;
  if (r.attack && typeof r.attack === 'object') {
    const dir = (r.attack as any).dir;
    if (typeof dir === 'string' && (DIRS as readonly string[]).includes(dir)) input.attack = { dir: dir as AttackDir, committed: (r.attack as any).committed === true };
  }
  if (r.technique === 'wind_step' || r.technique === 'kesa_giri' || r.technique === 'void_step') input.technique = r.technique;
  if (r.bind === true) input.bind = true;
  if (r.feint === true) input.feint = true;
  if (r.parry === true) input.parry = true;
  const step = vec(r.step);
  if (step && Math.hypot(step.x, step.z) > 0.1) input.step = step;
  if (typeof r.stance === 'string' && (STANCES as readonly string[]).includes(r.stance)) input.stance = r.stance as Stance;
  if (r.draw === true) input.draw = true;
  return input;
}

const ONE_SHOTS = ['attack', 'technique', 'feint', 'parry', 'bind', 'step', 'stance', 'draw'] as const;
const hasShot = (i: DuelistInput) => ONE_SHOTS.some(k => i[k] !== undefined);

/** Most ticks of input the server holds for a player before it skips plain (held-only) ones. */
export const MAX_INPUT_LAG = 4;

/**
 * Per-player input on the server. Clients send one stamped input per sim tick; the server
 * consumes them in order, one per tick, and acknowledges the last one it applied (the client
 * replays everything after that ack on top of each snapshot). When nothing has arrived, the
 * last held state (move, facing, guard) continues and no one-shot intent is ever repeated.
 * A client that floods is limited to `maxPerSecond` messages; a backlog beyond
 * MAX_INPUT_LAG ticks drops plain inputs (never a cut, parry or step) to keep latency low.
 */
export class InputBuffer {
  private held: DuelistInput;
  private queue: { seq: number; input: DuelistInput }[] = [];
  private window: number[] = [];
  private lastSeq = 0;
  /** Sequence number of the last input applied to the sim. */
  ack = 0;
  rejected = 0;

  constructor(facing: number, private maxPerSecond = 90) {
    this.held = { move: { x: 0, z: 0 }, facing, guard: false };
  }

  /** Offer a raw message at server time `now` (seconds). Returns whether it was accepted. */
  push(raw: unknown, now: number): boolean {
    this.window = this.window.filter(t => now - t < 1);
    if (this.window.length >= this.maxPerSecond) { this.rejected++; return false; }
    const input = sanitizeInput(raw);
    if (!input) { this.rejected++; return false; }
    // Stamped inputs must move forward (no replays); unstamped ones are numbered here.
    const stamp = (raw as { seq?: unknown }).seq;
    let seq: number;
    if (typeof stamp === 'number' && Number.isInteger(stamp)) {
      if (stamp <= this.lastSeq) { this.rejected++; return false; }
      seq = stamp;
    } else seq = this.lastSeq + 1;
    this.lastSeq = seq;
    this.window.push(now);
    this.queue.push({ seq, input });
    return true;
  }

  /** A new round: queued and held input are dropped; sequence numbers carry on. */
  reset(facing: number): void {
    this.queue = [];
    this.held = { move: { x: 0, z: 0 }, facing, guard: false };
    this.ack = this.lastSeq;
  }

  /** The input for this tick. */
  take(): DuelistInput {
    while (this.queue.length > MAX_INPUT_LAG) {
      const i = this.queue.findIndex((q, k) => k < this.queue.length - 1 && !hasShot(q.input));
      if (i < 0) break;
      this.queue.splice(i, 1);
    }
    const next = this.queue.shift();
    if (!next) return { ...this.held, move: { ...this.held.move } };
    this.ack = next.seq;
    const i = next.input;
    this.held = { move: i.move, facing: i.facing, guard: i.guard, guardLine: i.guardLine };
    return i;
  }

  /** What continues when no input arrives (shared with clients so they can predict). */
  get heldInput(): DuelistInput {
    return { ...this.held, move: { ...this.held.move } };
  }
}

/** What the server broadcasts: the full authoritative state and what happened since last time. */
export interface NetSnapshot {
  state: DuelSnapshot;
  events: DuelEvent[];
  round: number;
  /** Fighter id → display name. */
  names: Record<string, string>;
  /** Fighter id → sequence number of that player's last input applied to `state`. */
  acks: Record<string, number>;
  /** Fighter id → the held input that continues for them until their next one arrives. */
  held: Record<string, DuelistInput>;
}

/**
 * Client-side prediction for one fighter in a server-authoritative duel.
 *
 * Every local input is applied to a local copy of the duel immediately and remembered. Each
 * server snapshot replaces the local copy with the server's truth, drops the inputs the server
 * has acknowledged, and replays the rest, so your own fighter answers your hands at once and
 * still ends up exactly where the server says. Other fighters are carried forward on their
 * last held input. Events from the local copy are never shown as outcomes; only the server's are.
 */
export class Predictor {
  readonly duel = new Duel();
  private pending: { seq: number; input: DuelistInput }[] = [];
  private seq = 0;
  private others: Record<string, DuelistInput> = {};
  /** Inputs sent but not yet acknowledged. */
  get unacked(): number { return this.pending.length; }

  constructor(readonly me: string) {}

  /** Apply our input now, locally. Returns the stamped message to send. */
  input(i: DuelistInput): DuelistInput & { seq: number } {
    const msg = { ...i, seq: ++this.seq };
    this.pending.push({ seq: msg.seq, input: i });
    // A server that stops acknowledging is not caught up with forever (2 s of input).
    if (this.pending.length > 120) this.pending.shift();
    if (this.duel.get(this.me)) this.duel.step(this.inputsWith(i));
    return msg;
  }

  /** Rewind to the server's state and replay what it has not seen. Returns how far our fighter was corrected (m). */
  reconcile(s: NetSnapshot): number {
    const before = this.duel.get(this.me);
    const bx = before?.pos.x ?? 0, bz = before?.pos.z ?? 0;
    this.duel.restore(s.state);
    const ack = s.acks[this.me] ?? 0;
    this.pending = this.pending.filter(p => p.seq > ack);
    this.others = {};
    for (const [id, inp] of Object.entries(s.held)) if (id !== this.me) this.others[id] = inp;
    if (this.duel.get(this.me)) for (const p of this.pending) this.duel.step(this.inputsWith(p.input));
    const after = this.duel.get(this.me);
    return before && after ? Math.hypot(after.pos.x - bx, after.pos.z - bz) : 0;
  }

  private inputsWith(mine: DuelistInput): Record<string, DuelistInput> {
    return { ...this.others, [this.me]: mine };
  }
}
