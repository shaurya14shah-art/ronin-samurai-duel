import { DEG } from './math.js';
import type { AttackKind, Line, Stance } from './types.js';

// All duel tuning lives here. docs/COMBAT_DESIGN.md is the human-readable version;
// keep the two in step.

export const TICK_HZ = 60;
export const DT = 1 / TICK_HZ;

export const BODY_RADIUS = 0.28;
export const ARM_REACH = 0.55;
export const BLADE_LENGTH = 0.95;
/** Reference blade mass (kg) for an ordinary katana; heavier swings slower and hits harder. */
export const BLADE_MASS = 1.1;

export const MAX_STAMINA = 100;
export const MAX_POSTURE = 100;
export const MAX_VITALITY = 100;

export const STAMINA_REGEN = 16;
export const STAMINA_REGEN_DELAY = 0.8;
export const EXHAUSTED_BELOW = 15;
export const GUARD_DRAIN = 2;
export const POSTURE_REGEN = 14;
export const POSTURE_REGEN_DELAY = 1;

export const COST = {
  attack: 12,
  committed: 26,
  parry: 8,
  step: 10,
  feint: 8,
  windStep: 30,
  kesaGiri: 28,
  voidStep: 22,
  bind: 12,
} as const;

/** Training effects per rank (ranks 0–3). Three ranks of anything are worth about a tenth. */
export const TRAINING = {
  maxRank: 3,
  strength: 0.035,          // cut damage, posture and force
  endurance: { regen: 0.05, cost: 0.03 },
  defence: 0.035,           // posture taken, from blocks and hits
  footwork: { distance: 0.04, cost: 0.05 },
  longBlade: 0.25,          // share of a heavy blade's extra swing time removed
  shortBlade: 0.08,         // parry window, with a blade under SHORT_BLADE
} as const;
export const SHORT_BLADE = 0.65;
export const MASTERY = { windup: 0.12, cost: 0.15 } as const;
/** Techniques: the bind's window is tighter than a parry's; the void step's counter is quick. */
export const TECHNIQUE = { bindWindow: 0.85, bindPosture: 35, bindStagger: 1.6, bindRattle: 0.6, voidSide: 1.1, voidQuick: 0.7, iaiWindup: 0.65, kesaGuardPosture: 1.6 } as const;

export const BASE_DAMAGE = 40;
export const CONTACT_DAMAGE = { clean: 1, graze: 0.5, mid: 0.7, jammed: 0.25 } as const;
export const CONTACT_POSTURE = { clean: 0.6, graze: 0.4, mid: 1, jammed: 1.4 } as const;
/** Blade fraction (from the hilt) at or above which contact counts as the clean tip third. */
export const CLEAN_FROM = 0.62;
export const MID_FROM = 0.3;

export const COMMITTED = { windup: 1.55, recovery: 1.5, damage: 1.4, posture: 1.8, force: 1.6, commitAt: 0.7 } as const;
export const LIGHT_COMMIT_AT = 0.55;
export const WHIFF_RECOVERY = 1.35;

export const PARRY = { delay: 0.03, window: 0.13, late: 0.1, cone: 50 * DEG, whiffRecovery: 0.45, successRecovery: 0.15, stagger: 0.6 } as const;
export const GUARD_CONE = 75 * DEG;
export const GUARD_BREAK_STAGGER = 0.9;
export const RATTLE = 0.25;
export const HIT_STAGGER = 0.35;
export const CLASH = { reachSlack: 0.1, facingDot: 0.4, mutualWithin: 0.2, displacedStagger: 0.45, mutualRecovery: 0.3 } as const;
export const FEINT_RECOVERY = 0.12;
export const FEINT_CHAIN_RESET = 3;
export const STEP = { duration: 0.22, forward: 1.3, back: 1.6, side: 1.0, chainWindow: 1.2, chainCost: 1.5 } as const;
export const DRAW_TIME = 0.5;
export const SHEATH_TIME = 0.6;
export const STANCE_CHANGE = 0.35;
export const BUFFER_TTL = 0.15;
export const FIRST_STRIKE = 1.3;

export const SPEED = { sheathed: 3.2, drawn: 2.0, guarding: 1.3, accel: 12 } as const;
/** Max turn rate (rad/s) by situation. A committed cut cannot track a sidestep. */
export const TURN = { free: 10, windupOpen: 6, windupCommitted: 1.2, active: 0.6, recover: 4, stagger: 0 } as const;

export interface AttackDef {
  line: Line;
  windup: number;
  active: number;
  recovery: number;
  arcStart: number;
  arcEnd: number;
  extend: boolean;
  reachBonus: number;
  damage: number;
  posture: number;
  force: number;
  lungeWindup: number;
  lungeActive: number;
}

// Arc bearings are attacker-local (+ = attacker's right). A cut starting on the attacker's
// left arrives on the defender's right, hence diag_l → line 'right'.
export const ATTACKS: Record<AttackKind, AttackDef> = {
  overhead: { line: 'high', windup: 0.40, active: 0.12, recovery: 0.46, arcStart: -12 * DEG, arcEnd: 12 * DEG, extend: false, reachBonus: 0, damage: 1.15, posture: 30, force: 1.25, lungeWindup: 0, lungeActive: 0.25 },
  diag_l: { line: 'right', windup: 0.33, active: 0.14, recovery: 0.40, arcStart: -37.5 * DEG, arcEnd: 37.5 * DEG, extend: false, reachBonus: 0, damage: 1, posture: 20, force: 1, lungeWindup: 0, lungeActive: 0.2 },
  diag_r: { line: 'left', windup: 0.33, active: 0.14, recovery: 0.40, arcStart: 37.5 * DEG, arcEnd: -37.5 * DEG, extend: false, reachBonus: 0, damage: 1, posture: 20, force: 1, lungeWindup: 0, lungeActive: 0.2 },
  horiz_l: { line: 'right', windup: 0.30, active: 0.16, recovery: 0.42, arcStart: -55 * DEG, arcEnd: 55 * DEG, extend: false, reachBonus: 0.05, damage: 0.85, posture: 14, force: 0.85, lungeWindup: 0, lungeActive: 0.15 },
  horiz_r: { line: 'left', windup: 0.30, active: 0.16, recovery: 0.42, arcStart: 55 * DEG, arcEnd: -55 * DEG, extend: false, reachBonus: 0.05, damage: 0.85, posture: 14, force: 0.85, lungeWindup: 0, lungeActive: 0.15 },
  thrust: { line: 'center', windup: 0.27, active: 0.10, recovery: 0.52, arcStart: -6 * DEG, arcEnd: 6 * DEG, extend: true, reachBonus: 0.3, damage: 0.9, posture: 18, force: 0.9, lungeWindup: 0, lungeActive: 0.3 },
  low: { line: 'low', windup: 0.32, active: 0.14, recovery: 0.44, arcStart: -35 * DEG, arcEnd: 35 * DEG, extend: false, reachBonus: -0.1, damage: 0.8, posture: 18, force: 0.9, lungeWindup: 0, lungeActive: 0.15 },
  draw_cut: { line: 'right', windup: 0.38, active: 0.14, recovery: 0.5, arcStart: -55 * DEG, arcEnd: 55 * DEG, extend: false, reachBonus: 0, damage: 1, posture: 22, force: 1.1, lungeWindup: 0.1, lungeActive: 0.2 },
  wind_step: { line: 'center', windup: 0.36, active: 0.10, recovery: 0.6, arcStart: -6 * DEG, arcEnd: 6 * DEG, extend: true, reachBonus: 0.3, damage: 1.1, posture: 24, force: 1.2, lungeWindup: 1.2, lungeActive: 0.2 },
  // Kesa-giri: the whole body behind one diagonal from the shoulder. Drives through a guard.
  kesa_giri: { line: 'right', windup: 0.5, active: 0.16, recovery: 0.75, arcStart: -42 * DEG, arcEnd: 42 * DEG, extend: false, reachBonus: 0.05, damage: 1.3, posture: 34, force: 1.5, lungeWindup: 0.25, lungeActive: 0.2 },
};

/** Guard quality: GUARD_TABLE[guardLine][incomingLine]. */
export const GUARD_TABLE: Record<Line, Record<Line, number>> = {
  center: { high: 0.5, left: 0.5, right: 0.5, center: 1, low: 0 },
  high: { high: 1, left: 0.5, right: 0.5, center: 0.5, low: 0 },
  left: { high: 0.5, left: 1, right: 0, center: 0.5, low: 0.5 },
  right: { high: 0.5, left: 0, right: 1, center: 0.5, low: 0.5 },
  low: { high: 0, left: 0.5, right: 0.5, center: 0.5, low: 1 },
};

export interface StanceDef {
  windup: Partial<Record<AttackKind, number>>;
  windupAll: number;
  reach: number;
  postureTaken: number;
  parryWindow: number;
  stepDistance: number;
  stepCost: number;
  blockCap: number;
  staminaRegen: number;
  defaultGuard: Line;
}

const S = (o: Partial<StanceDef>): StanceDef => ({
  windup: {}, windupAll: 1, reach: 0, postureTaken: 1, parryWindow: 1, stepDistance: 1, stepCost: 1,
  blockCap: 1, staminaRegen: 1, defaultGuard: 'center', ...o,
});

export const STANCES: Record<Stance, StanceDef> = {
  high: S({ windup: { overhead: 0.85, diag_l: 0.85, diag_r: 0.85, thrust: 1.3, low: 1.3 }, reach: 0.05, postureTaken: 1.15, defaultGuard: 'high' }),
  middle: S({ windup: { thrust: 0.9 }, parryWindow: 1.1 }),
  low: S({ windup: { low: 0.85, thrust: 0.85, overhead: 1.35 }, stepDistance: 1.1, defaultGuard: 'low' }),
  fluid: S({ windup: { horiz_l: 0.85, horiz_r: 0.85 }, stepCost: 0.8, blockCap: 0.5 }),
  empty: S({ windupAll: 1.1, parryWindow: 1.35, staminaRegen: 1.3, blockCap: 0 }),
};
