import type { Vec2 } from './math.js';

/** Which part of the defender an attack arrives at, from the defender's point of view. */
export type Line = 'high' | 'left' | 'right' | 'center' | 'low';

/** Attacks a fighter can request directly. Directions are named from the attacker's side. */
export type AttackDir = 'overhead' | 'diag_l' | 'diag_r' | 'horiz_l' | 'horiz_r' | 'thrust' | 'low';
export type AttackKind = AttackDir | 'draw_cut' | 'wind_step' | 'kesa_giri';

/** Physical techniques, learned through training (see Training). None is magic: each is a body movement. */
export type TechniqueId = 'wind_step' | 'kesa_giri' | 'void_step' | 'maki_otoshi' | 'iai';
/** Techniques performed with the technique key (the others ride on the draw and the parry). */
export type ActiveTechnique = 'wind_step' | 'kesa_giri' | 'void_step';

/**
 * A fighter's training. Conditioning ranks (0–3 each) are deliberately small: all of it together
 * is worth about a tenth; the duel is decided by the hands. Blade proficiencies reduce what a long
 * blade's weight costs, or sharpen a short blade's parry. Mastery (0–1) comes from using a
 * technique well, and makes it quicker and cheaper.
 */
export interface Training {
  strength: number;
  endurance: number;
  defence: number;
  footwork: number;
  longBlade: number;
  shortBlade: number;
  known: TechniqueId[];
  mastery: Partial<Record<TechniqueId, number>>;
}

export type Stance = 'high' | 'middle' | 'low' | 'fluid' | 'empty';

export type Phase =
  | 'sheathed'
  | 'drawing'
  | 'sheathing'
  | 'ready'
  | 'stance_change'
  | 'windup'
  | 'active'
  | 'recover'
  | 'parry'
  | 'stagger'
  | 'step'
  | 'dead';

export type Contact = 'clean' | 'graze' | 'mid' | 'jammed';

/** One tick of intent from a human, network client or AI. Edge-triggered fields are one-shot. */
export interface DuelistInput {
  /** Local move direction: x = right, z = forward. Magnitude ≤ 1. */
  move: Vec2;
  /** Desired absolute yaw. The sim turns toward it at a phase-dependent rate. */
  facing: number;
  /** Held. */
  guard: boolean;
  guardLine?: Line;
  attack?: { dir: AttackDir; committed: boolean };
  technique?: ActiveTechnique;
  /** Maki-otoshi: a parry that binds and winds the incoming blade down (if learned). */
  bind?: boolean;
  feint?: boolean;
  parry?: boolean;
  /** Local step direction (x = right, z = forward). */
  step?: Vec2;
  stance?: Stance;
  /** Toggle draw / sheath. */
  draw?: boolean;
}

export interface ActiveAttack {
  kind: AttackKind;
  committed: boolean;
  windup: number;
  commitAt: number;
  active: number;
  recovery: number;
  /** Arc in attacker-local bearing (radians, + = attacker's right). */
  arcStart: number;
  arcEnd: number;
  extend: boolean;
  reach: number;
  line: Line;
  damage: number;
  posture: number;
  force: number;
  lungeWindup: number;
  lungeActive: number;
  /** Bearing swept up to last tick (sweep attacks). */
  prevAngle: number;
  prevReach: number;
  contact: boolean;
  /** Fighters this attack has already resolved against. */
  resolved: string[];
  clashed: boolean;
  firstStrike: boolean;
}

export interface Wounds { leg: number; arm: number; torso: number }

export interface Duelist {
  id: string;
  pos: Vec2;
  vel: Vec2;
  facing: number;
  phase: Phase;
  phaseTime: number;
  phaseDur: number;
  stance: Stance;
  nextStance: Stance | null;
  drawn: boolean;
  guarding: boolean;
  guardLine: Line;
  attack: ActiveAttack | null;
  buffered: { attack?: DuelistInput['attack']; technique?: 'wind_step' | 'kesa_giri'; ttl: number; quick?: boolean } | null;
  /** The current parry is a bind (maki-otoshi). */
  binding: boolean;
  training: Training;
  stamina: number;
  posture: number;
  /** 0..1. Never shown as a bar. */
  composure: number;
  vitality: number;
  sinceStaminaSpend: number;
  sincePostureHit: number;
  sinceHurt: number;
  feintChain: number;
  sinceFeint: number;
  stepChain: number;
  sinceStep: number;
  stepDir: Vec2;
  stepDist: number;
  stepApplied: number;
  /** Blade displaced after a poor block: cannot attack until it reaches 0. */
  rattled: number;
  wounds: Wounds;
  bladeLength: number;
  /** kg. Swing time and force scale with it (see massFactor). */
  bladeMass: number;
  armReach: number;
}

export type DuelEventType =
  | 'attack_start'
  | 'commit'
  | 'attack_active'
  | 'feint'
  | 'whiff'
  | 'hit'
  | 'block'
  | 'parry'
  | 'parry_whiff'
  | 'clash'
  | 'guard_break'
  | 'interrupt'
  | 'step'
  | 'stance'
  | 'draw'
  | 'sheath'
  | 'death';

export interface DuelEvent {
  tick: number;
  type: DuelEventType;
  /** The actor (attacker, stepper…). */
  a: string;
  /** The other party, if any. */
  b?: string;
  kind?: AttackKind | TechniqueId;
  line?: Line;
  contact?: Contact;
  quality?: number;
  /** Clash: 'mutual' or the id of the fighter whose blade was displaced. */
  outcome?: string;
  wound?: keyof Wounds;
  damage?: number;
}
