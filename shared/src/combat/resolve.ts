import {
  BASE_DAMAGE, BODY_RADIUS, CLASH, CLEAN_FROM, CONTACT_DAMAGE, CONTACT_POSTURE, FIRST_STRIKE, GUARD_BREAK_STAGGER,
  GUARD_CONE, GUARD_TABLE, HIT_STAGGER, MAX_POSTURE, MID_FROM, PARRY, RATTLE, STANCES, TECHNIQUE,
} from './constants.js';
import { addPosture, defenceMult, isExhausted, loseComposure, parryWindow, setPhase, type StepContext } from './duelist.js';
import { bearing, clamp, dist, easeInOut, forward, lerp } from './math.js';
import type { ActiveAttack, Contact, Duelist, Wounds } from './types.js';

/** Where the arc currently is, in attacker-local bearing, and how far the blade reaches. */
export function attackPose(a: ActiveAttack, progress: number): { angle: number; reach: number } {
  const t = easeInOut(progress);
  if (a.extend) return { angle: 0, reach: lerp(a.reach * 0.55, a.reach, t) };
  return { angle: lerp(a.arcStart, a.arcEnd, t), reach: a.reach };
}

export function classifyContact(att: Duelist, distance: number): Contact {
  const s = (distance - att.armReach) / att.bladeLength;
  if (s > 1) return 'graze';
  if (s >= CLEAN_FROM) return 'clean';
  if (s >= MID_FROM) return 'mid';
  return 'jammed';
}

/** Does this tick's portion of the attack pass through the defender's body? */
export function sweepHits(att: Duelist, def: Duelist, a: ActiveAttack, progress: number): Contact | null {
  const d = dist(att.pos, def.pos);
  const half = d > BODY_RADIUS ? Math.asin(BODY_RADIUS / d) : Math.PI;
  const phi = bearing(att.pos, att.facing, def.pos);
  const pose = attackPose(a, progress);
  if (d - BODY_RADIUS > pose.reach) return null;
  if (a.extend) {
    const width = Math.max(Math.abs(a.arcStart), Math.abs(a.arcEnd));
    if (Math.abs(phi) > width + half) return null;
  } else {
    const lo = Math.min(a.prevAngle, pose.angle) - half;
    const hi = Math.max(a.prevAngle, pose.angle) + half;
    if (phi < lo || phi > hi) return null;
  }
  return classifyContact(att, d);
}

function facingDot(from: Duelist, to: Duelist): number {
  const f = forward(from.facing);
  const dx = to.pos.x - from.pos.x, dz = to.pos.z - from.pos.z;
  const l = Math.hypot(dx, dz) || 1;
  return (f.x * dx + f.z * dz) / l;
}

function clashForce(d: Duelist, a: ActiveAttack): number {
  return a.force * (isExhausted(d) ? 0.7 : 1) * (1 - 0.1 * d.wounds.arm);
}

/** Blades meet when both fighters are mid-strike, within reach, and turned toward each other. */
export function resolveClash(x: Duelist, y: Duelist, ctx: StepContext): boolean {
  const ax = x.attack, ay = y.attack;
  if (x.phase !== 'active' || y.phase !== 'active' || !ax || !ay || ax.clashed || ay.clashed) return false;
  const d = dist(x.pos, y.pos);
  if (d > Math.min(ax.reach, ay.reach) + CLASH.reachSlack) return false;
  if (facingDot(x, y) < CLASH.facingDot || facingDot(y, x) < CLASH.facingDot) return false;
  ax.clashed = ay.clashed = true;
  const fx = clashForce(x, ax), fy = clashForce(y, ay);
  if (Math.abs(fx - fy) / Math.max(fx, fy) <= CLASH.mutualWithin) {
    for (const [f, a] of [[x, ax], [y, ay]] as const) {
      a.contact = true;
      setPhase(f, 'recover', CLASH.mutualRecovery);
    }
    ctx.events.push({ tick: ctx.tick, type: 'clash', a: x.id, b: y.id, outcome: 'mutual' });
    return true;
  }
  const [loser, winner] = fx < fy ? [x, y] : [y, x];
  loser.attack!.contact = true;
  addPosture(loser, 15);
  setPhase(loser, 'stagger', CLASH.displacedStagger);
  ctx.events.push({ tick: ctx.tick, type: 'clash', a: winner.id, b: loser.id, outcome: loser.id });
  return true;
}

export type Outcome =
  | { kind: 'parry' }
  | { kind: 'block'; quality: number }
  | { kind: 'hit' };

/** Judge the defence purely from the defender's state at the moment the blade arrives. */
export function judgeDefence(att: Duelist, def: Duelist, a: ActiveAttack): Outcome {
  const off = Math.abs(bearing(def.pos, def.facing, att.pos));
  const stance = STANCES[def.stance];
  if (def.phase === 'parry') {
    const window = parryWindow(def) * (def.binding ? TECHNIQUE.bindWindow : 1);
    const t = def.phaseTime;
    if (t >= PARRY.delay && t <= PARRY.delay + window && off <= PARRY.cone) return { kind: 'parry' };
    if (t > PARRY.delay + window && off <= GUARD_CONE) return { kind: 'block', quality: 0.5 };
    return { kind: 'hit' };
  }
  if (def.guarding && off <= GUARD_CONE) {
    const q = Math.min(GUARD_TABLE[def.guardLine][a.line], stance.blockCap);
    if (q > 0) return { kind: 'block', quality: q };
  }
  return { kind: 'hit' };
}

function woundFor(def: Duelist, a: ActiveAttack): keyof Wounds {
  if (a.line === 'low') return 'leg';
  if ((a.line === 'left' || a.line === 'right') && (def.phase === 'windup' || def.phase === 'active')) return 'arm';
  return 'torso';
}

export function applyOutcome(att: Duelist, def: Duelist, a: ActiveAttack, contact: Contact, outcome: Outcome, ctx: StepContext): void {
  a.contact = true;
  if (outcome.kind === 'parry') {
    // Maki-otoshi: the defender binds the blade and winds it down; the attacker is left further
    // off balance, with their blade out of line.
    const bind = def.binding;
    att.attack = null;
    addPosture(att, (a.posture * 1.2 + 15 + (bind ? TECHNIQUE.bindPosture : 0)) * defenceMult(att));
    loseComposure(att, bind ? 0.2 : 0.12);
    setPhase(att, 'stagger', PARRY.stagger * (bind ? TECHNIQUE.bindStagger : 1));
    if (bind) att.rattled = TECHNIQUE.bindRattle + PARRY.stagger * TECHNIQUE.bindStagger;
    def.composure = Math.min(1, def.composure + 0.1);
    def.binding = false;
    setPhase(def, 'recover', PARRY.successRecovery);
    ctx.events.push({ tick: ctx.tick, type: 'parry', a: def.id, b: att.id, kind: bind ? 'maki_otoshi' : a.kind });
    return;
  }

  if (outcome.kind === 'block') {
    const mult = outcome.quality >= 1 ? 1 : 1.6;
    // A kesa-giri drives through a guard; training in defence absorbs some of any blow.
    const posture = a.posture * mult * STANCES[def.stance].postureTaken * (a.kind === 'kesa_giri' ? TECHNIQUE.kesaGuardPosture : 1) * defenceMult(def);
    const stamina = 6 * a.force * mult;
    def.stamina = Math.max(0, def.stamina - stamina);
    def.sinceStaminaSpend = 0;
    addPosture(def, posture);
    addPosture(att, 4);
    setPhase(att, 'recover', a.recovery);
    if (def.posture >= MAX_POSTURE || def.stamina <= 0) {
      def.attack = null;
      loseComposure(def, 0.2);
      def.posture = MAX_POSTURE;
      setPhase(def, 'stagger', GUARD_BREAK_STAGGER);
      ctx.events.push({ tick: ctx.tick, type: 'guard_break', a: att.id, b: def.id, kind: a.kind, line: a.line });
      return;
    }
    if (outcome.quality < 1) {
      def.rattled = RATTLE;
      loseComposure(def, 0.03);
    }
    // A late parry resolves as a block; return the defender to a neutral footing.
    if (def.phase === 'parry') setPhase(def, 'recover', PARRY.successRecovery * 2);
    ctx.events.push({ tick: ctx.tick, type: 'block', a: att.id, b: def.id, kind: a.kind, line: a.line, quality: outcome.quality });
    return;
  }

  const fs = a.firstStrike && contact === 'clean' ? FIRST_STRIKE : 1;
  const damage = BASE_DAMAGE * a.damage * CONTACT_DAMAGE[contact];
  const wound = contact === 'clean' || contact === 'mid' ? woundFor(def, a) : null;
  const interrupted = def.phase === 'windup';
  def.vitality = Math.max(0, def.vitality - damage);
  def.sinceHurt = 0;
  loseComposure(def, 0.15 * fs);
  addPosture(def, a.posture * CONTACT_POSTURE[contact] * STANCES[def.stance].postureTaken * fs * defenceMult(def));
  if (wound) {
    def.wounds[wound] = Math.min(2, def.wounds[wound] + 1);
    if (wound === 'torso') loseComposure(def, 0.1);
  }
  if (contact === 'clean') att.composure = clamp(att.composure + 0.05, 0, 1);
  if (def.attack && def.phase !== 'active') def.attack = null;
  ctx.events.push({ tick: ctx.tick, type: 'hit', a: att.id, b: def.id, kind: a.kind, line: a.line, contact, damage, wound: wound ?? undefined });
  if (interrupted) ctx.events.push({ tick: ctx.tick, type: 'interrupt', a: att.id, b: def.id });
  if (def.vitality <= 0) {
    def.attack = null;
    setPhase(def, 'dead');
    ctx.events.push({ tick: ctx.tick, type: 'death', a: def.id, b: att.id });
    return;
  }
  // A fighter cut mid-swing still completes the swing (simultaneous strikes trade).
  if (def.phase !== 'active') setPhase(def, 'stagger', HIT_STAGGER);
}
