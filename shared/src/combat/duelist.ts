import {
  ARM_REACH, ATTACKS, BLADE_LENGTH, BLADE_MASS, BUFFER_TTL, COMMITTED, COST, DRAW_TIME, DT, EXHAUSTED_BELOW, FEINT_CHAIN_RESET,
  FEINT_RECOVERY, GUARD_DRAIN, LIGHT_COMMIT_AT, MAX_POSTURE, MAX_STAMINA, MAX_VITALITY, PARRY, POSTURE_REGEN,
  POSTURE_REGEN_DELAY, SHEATH_TIME, SPEED, STAMINA_REGEN, STAMINA_REGEN_DELAY, STANCE_CHANGE, STANCES, STEP, TURN,
  WHIFF_RECOVERY, TRAINING, MASTERY, TECHNIQUE, SHORT_BLADE,
} from './constants.js';
import { clamp, forward, len, localToWorld, wrapAngle, type Vec2 } from './math.js';
import type { ActiveAttack, AttackKind, Duelist, DuelEvent, DuelistInput, Phase, Stance, TechniqueId, Training } from './types.js';

export interface StepContext {
  tick: number;
  events: DuelEvent[];
  /** True until the first clean strike of the duel has landed. */
  firstStrikeAvailable: boolean;
}

export interface DuelistOptions {
  drawn?: boolean;
  stance?: Stance;
  bladeLength?: number;
  bladeMass?: number;
  training?: Partial<Training>;
}

/** Untrained, knowing only the Passing Step (wind_step), which every swordsman has. */
export function untrained(): Training {
  return { strength: 0, endurance: 0, defence: 0, footwork: 0, longBlade: 0, shortBlade: 0, known: ['wind_step'], mastery: {} };
}

/** Everything known and no conditioning: online duels, where only skill may decide. */
export const ALL_TECHNIQUES: TechniqueId[] = ['wind_step', 'kesa_giri', 'void_step', 'maki_otoshi', 'iai'];

const rank = (v: number) => clamp(Math.round(v) || 0, 0, TRAINING.maxRank);

/** A training record made safe: ranks clamped to 0–3, mastery to 0–1, known techniques checked. */
export function cleanTraining(t: Partial<Training> = {}): Training {
  const base = untrained();
  const known = Array.isArray(t.known) ? t.known.filter((k): k is TechniqueId => ALL_TECHNIQUES.includes(k)) : base.known;
  const mastery: Training['mastery'] = {};
  for (const k of ALL_TECHNIQUES) { const m = t.mastery?.[k]; if (typeof m === 'number' && Number.isFinite(m)) mastery[k] = clamp(m, 0, 1); }
  return {
    strength: rank(t.strength ?? 0), endurance: rank(t.endurance ?? 0), defence: rank(t.defence ?? 0),
    footwork: rank(t.footwork ?? 0), longBlade: rank(t.longBlade ?? 0), shortBlade: rank(t.shortBlade ?? 0),
    known: [...new Set(known)], mastery,
  };
}

export function knows(d: Duelist, t: TechniqueId): boolean {
  return d.training.known.includes(t);
}

/** Stamina cost after endurance training and (for a technique) its mastery. */
function cost(d: Duelist, base: number, technique?: TechniqueId): number {
  const m = technique ? d.training.mastery[technique] ?? 0 : 0;
  return base * (1 - TRAINING.endurance.cost * d.training.endurance) * (1 - MASTERY.cost * m);
}

/** Strength: what a fighter's cuts carry. */
export function strengthMult(d: Duelist): number {
  return 1 + TRAINING.strength * d.training.strength;
}

/** Defence: how much posture a fighter loses to what lands on them. */
export function defenceMult(d: Duelist): number {
  return 1 - TRAINING.defence * d.training.defence;
}

export function createDuelist(id: string, pos: Vec2, facing: number, opts: DuelistOptions = {}): Duelist {
  const drawn = opts.drawn ?? true;
  const stance = opts.stance ?? 'middle';
  return {
    id,
    pos: { ...pos },
    vel: { x: 0, z: 0 },
    facing,
    phase: drawn ? 'ready' : 'sheathed',
    phaseTime: 0,
    phaseDur: 0,
    stance,
    nextStance: null,
    drawn,
    guarding: false,
    guardLine: STANCES[stance].defaultGuard,
    attack: null,
    buffered: null,
    stamina: MAX_STAMINA,
    posture: 0,
    composure: 1,
    vitality: MAX_VITALITY,
    sinceStaminaSpend: 99,
    sincePostureHit: 99,
    sinceHurt: 99,
    feintChain: 0,
    sinceFeint: 99,
    stepChain: 0,
    sinceStep: 99,
    stepDir: { x: 0, z: 0 },
    stepDist: 0,
    stepApplied: 0,
    rattled: 0,
    wounds: { leg: 0, arm: 0, torso: 0 },
    bladeLength: opts.bladeLength ?? BLADE_LENGTH,
    bladeMass: opts.bladeMass ?? BLADE_MASS,
    armReach: ARM_REACH,
    binding: false,
    training: cleanTraining(opts.training),
  };
}

export function setPhase(d: Duelist, phase: Phase, dur = 0): void {
  // Leaving a step early (cut, stopped) ends its momentum rather than letting it drift.
  if (d.phase === 'step' && phase !== 'step') d.vel = { x: 0, z: 0 };
  d.phase = phase;
  d.phaseTime = 0;
  d.phaseDur = dur;
  if (phase !== 'ready') d.guarding = false;
}

export function spendStamina(d: Duelist, amount: number): boolean {
  if (d.stamina < amount) return false;
  d.stamina -= amount;
  d.sinceStaminaSpend = 0;
  return true;
}

export function loseComposure(d: Duelist, amount: number): void {
  d.composure = clamp(d.composure - amount, 0, 1);
}

export function addPosture(d: Duelist, amount: number): void {
  d.posture = Math.min(MAX_POSTURE, d.posture + amount);
  d.sincePostureHit = 0;
}

export function isExhausted(d: Duelist): boolean {
  return d.stamina < EXHAUSTED_BELOW;
}

function windupScale(d: Duelist, kind: AttackKind): number {
  const stance = STANCES[d.stance];
  const technique: TechniqueId | null = kind === 'wind_step' || kind === 'kesa_giri' ? kind : kind === 'draw_cut' && knows(d, 'iai') ? 'iai' : null;
  const mastery = technique ? d.training.mastery[technique] ?? 0 : 0;
  return (stance.windup[kind] ?? 1) * stance.windupAll
    * (1 + 0.15 * (1 - d.composure))
    * (isExhausted(d) ? 1.15 : 1)
    * (1 + 0.08 * d.wounds.arm)
    * bladeTime(d)
    * (technique === 'iai' ? TECHNIQUE.iaiWindup : 1)
    * (1 - MASTERY.windup * mastery);
}

/** Swing-time factor from the blade's mass, after long-blade training. */
function bladeTime(d: Duelist): number {
  const t = massFactor(d).time;
  return t > 1 ? 1 + (t - 1) * (1 - TRAINING.longBlade * (d.training?.longBlade ?? 0)) : t;
}

/**
 * What the blade's mass does to a swing: relative to an ordinary katana, a heavier blade
 * takes longer to start and stop (time) and lands with more force (force). Bounded so a forge
 * choice shapes the fight without deciding it.
 */
export function massFactor(d: Pick<Duelist, 'bladeMass'>): { time: number; force: number } {
  const r = Math.max(0.5, Math.min(2, (d.bladeMass ?? BLADE_MASS) / BLADE_MASS));
  return { time: Math.min(1.3, Math.max(0.85, Math.pow(r, 0.55))), force: Math.min(1.3, Math.max(0.85, Math.pow(r, 0.5))) };
}

/** The attack a fighter would perform, with every modifier applied. Pure: used by AI to plan too. */
export function buildAttack(d: Duelist, kind: AttackKind, committed: boolean, firstStrike = false): ActiveAttack {
  const def = ATTACKS[kind];
  const windup = def.windup * windupScale(d, kind) * (committed ? COMMITTED.windup : 1);
  return {
    kind,
    committed,
    windup,
    commitAt: windup * (committed ? COMMITTED.commitAt : LIGHT_COMMIT_AT),
    active: def.active,
    recovery: def.recovery * (committed ? COMMITTED.recovery : 1) * (0.5 + 0.5 * bladeTime(d)),
    arcStart: def.arcStart,
    arcEnd: def.arcEnd,
    extend: def.extend,
    reach: d.armReach + d.bladeLength + def.reachBonus + STANCES[d.stance].reach,
    line: def.line,
    damage: def.damage * (committed ? COMMITTED.damage : 1) * strengthMult(d),
    posture: def.posture * (committed ? COMMITTED.posture : 1) * strengthMult(d),
    force: def.force * (committed ? COMMITTED.force : 1) * massFactor(d).force * strengthMult(d),
    lungeWindup: def.lungeWindup,
    lungeActive: def.lungeActive,
    prevAngle: def.arcStart,
    prevReach: 0,
    contact: false,
    resolved: [],
    clashed: false,
    firstStrike,
  };
}

function attackCost(d: Duelist, kind: AttackKind, committed: boolean): number {
  if (kind === 'wind_step') return cost(d, COST.windStep, 'wind_step');
  if (kind === 'kesa_giri') return cost(d, COST.kesaGiri, 'kesa_giri');
  return cost(d, committed ? COST.committed : COST.attack);
}

function tryStartAttack(d: Duelist, kind: AttackKind, committed: boolean, ctx: StepContext, quick = false): boolean {
  if ((kind === 'wind_step' || kind === 'kesa_giri') && !knows(d, kind)) return false;
  if (kind === 'wind_step' && d.composure < 0.1) return false;
  if (!spendStamina(d, attackCost(d, kind, committed))) return false;
  if (kind === 'wind_step') loseComposure(d, 0.1);
  d.attack = buildAttack(d, kind, committed, ctx.firstStrikeAvailable);
  if (quick) { d.attack.windup *= TECHNIQUE.voidQuick; d.attack.commitAt *= TECHNIQUE.voidQuick; }
  setPhase(d, 'windup', d.attack.windup);
  d.buffered = null;
  ctx.events.push({ tick: ctx.tick, type: 'attack_start', a: d.id, kind, line: d.attack.line });
  return true;
}

function remaining(d: Duelist): number {
  return d.phaseDur - d.phaseTime;
}

function canBuffer(d: Duelist): boolean {
  return (d.phase === 'recover' || d.phase === 'step' || d.phase === 'stance_change' || d.phase === 'drawing')
    && remaining(d) <= BUFFER_TTL;
}

/** Turn edge-triggered intent into state transitions. One action per tick, in priority order. */
export function applyInput(d: Duelist, input: DuelistInput, ctx: StepContext): void {
  if (d.phase === 'dead') return;
  const stance = STANCES[d.stance];

  // Feint: only before the commit point.
  if (input.feint && d.phase === 'windup' && d.attack && d.phaseTime < d.attack.commitAt) {
    const chain = d.sinceFeint < FEINT_CHAIN_RESET ? d.feintChain + 1 : 0;
    const cost = COST.feint * 1.6 ** chain;
    if (spendStamina(d, Math.min(cost, d.stamina))) {
      d.feintChain = chain;
      d.sinceFeint = 0;
      loseComposure(d, 0.02 * (1 + chain));
      const kind = d.attack.kind;
      if (kind === 'draw_cut') d.drawn = true;
      d.attack = null;
      setPhase(d, 'recover', FEINT_RECOVERY);
      ctx.events.push({ tick: ctx.tick, type: 'feint', a: d.id, kind });
      return;
    }
  }

  const binding = !!input.bind && knows(d, 'maki_otoshi');
  if ((input.parry || binding) && d.phase === 'ready' && d.drawn && d.rattled <= 0 && spendStamina(d, cost(d, binding ? COST.bind : COST.parry, binding ? 'maki_otoshi' : undefined))) {
    setPhase(d, 'parry', PARRY.delay + parryWindow(d) * (binding ? TECHNIQUE.bindWindow : 1) + PARRY.late);
    d.binding = binding;
    return;
  }

  // Void step: off the line to the side, and straight into a quick counter-thrust.
  if (input.technique === 'void_step') {
    if (knows(d, 'void_step') && d.phase === 'ready' && d.drawn && spendStamina(d, cost(d, COST.voidStep, 'void_step'))) {
      const side = input.move.x < -0.1 ? -1 : 1;
      startStep(d, { x: side, z: 0.15 }, STEP.side * TECHNIQUE.voidSide * footworkMult(d), ctx);
      d.buffered = { attack: { dir: 'thrust', committed: false }, ttl: STEP.duration + 0.05, quick: true };
    }
    return;
  }

  const wantsAttack = input.attack || input.technique;
  if (wantsAttack) {
    const kind: AttackKind = input.technique ?? input.attack!.dir;
    const committed = !input.technique && !!input.attack?.committed;
    if (d.phase === 'sheathed' && !input.technique) {
      if (tryStartAttack(d, 'draw_cut', false, ctx)) return;
    } else if (d.phase === 'ready' && d.drawn && d.rattled <= 0) {
      if (tryStartAttack(d, kind, committed, ctx)) return;
    } else if (canBuffer(d)) {
      d.buffered = { attack: input.attack, technique: input.technique as 'wind_step' | 'kesa_giri' | undefined, ttl: BUFFER_TTL };
    }
  }

  if (input.step && (d.phase === 'ready' || d.phase === 'sheathed') && len(input.step) > 0.1) {
    const chain = d.sinceStep < STEP.chainWindow ? d.stepChain + 1 : 0;
    const stepCost = cost(d, COST.step) * stance.stepCost * STEP.chainCost ** chain * (1 - TRAINING.footwork.cost * d.training.footwork);
    if (spendStamina(d, stepCost)) {
      const l = input.step;
      const n = len(l);
      const local = { x: l.x / n, z: l.z / n };
      const base = Math.abs(local.z) >= Math.abs(local.x) ? (local.z > 0 ? STEP.forward : STEP.back) : STEP.side;
      d.stepChain = chain;
      startStep(d, local, base * stance.stepDistance * footworkMult(d), ctx);
      return;
    }
  }

  if (input.stance && input.stance !== d.stance && d.phase === 'ready' && d.drawn) {
    d.nextStance = input.stance;
    setPhase(d, 'stance_change', STANCE_CHANGE);
    return;
  }

  if (input.draw) {
    if (d.phase === 'sheathed') { setPhase(d, 'drawing', DRAW_TIME); return; }
    if (d.phase === 'ready' && d.drawn) { setPhase(d, 'sheathing', SHEATH_TIME); return; }
  }

  // Held guard.
  d.guarding = input.guard && d.phase === 'ready' && d.drawn && stance.blockCap > 0 && d.stamina > 0;
  d.guardLine = input.guardLine ?? stance.defaultGuard;
}

function footworkMult(d: Duelist): number {
  return (1 + TRAINING.footwork.distance * d.training.footwork) * (1 - 0.15 * d.wounds.leg);
}

function startStep(d: Duelist, local: { x: number; z: number }, dist: number, ctx: StepContext): void {
  const n = len(local) || 1;
  d.sinceStep = 0;
  d.stepDir = localToWorld({ x: local.x / n, z: local.z / n }, d.facing);
  d.stepDist = dist;
  d.stepApplied = 0;
  d.vel = { x: 0, z: 0 };
  setPhase(d, 'step', STEP.duration);
  ctx.events.push({ tick: ctx.tick, type: 'step', a: d.id });
}

/** The parry window: stance, composure, and a short blade's quickness if trained for it. */
export function parryWindow(d: Duelist): number {
  const short = d.bladeLength < SHORT_BLADE ? 1 + TRAINING.shortBlade * d.training.shortBlade : 1;
  return PARRY.window * STANCES[d.stance].parryWindow * (0.6 + 0.4 * d.composure) * short;
}

function turnRate(d: Duelist): number {
  switch (d.phase) {
    case 'windup': return d.attack && d.phaseTime >= d.attack.commitAt ? TURN.windupCommitted : TURN.windupOpen;
    case 'active': return TURN.active;
    case 'recover': case 'parry': return TURN.recover;
    case 'stagger': case 'dead': return TURN.stagger;
    default: return TURN.free;
  }
}

function moveScale(d: Duelist): number {
  switch (d.phase) {
    case 'windup': return 0.4;
    case 'recover': case 'parry': return 0.3;
    case 'stance_change': return 0.5;
    case 'drawing': case 'sheathing': return 0.6;
    case 'ready': case 'sheathed': return 1;
    default: return 0;
  }
}

function settle(d: Duelist, ctx: StepContext): void {
  if (d.drawn) setPhase(d, 'ready');
  else setPhase(d, 'sheathed');
  if (d.buffered && d.buffered.ttl > 0) {
    const b = d.buffered;
    d.buffered = null;
    const kind: AttackKind = b.technique ?? b.attack!.dir;
    if (d.phase === 'ready') tryStartAttack(d, kind, !b.technique && !!b.attack?.committed, ctx, !!b.quick);
  }
}

/** Advance timers, phase transitions, facing, movement and recovery by one tick. */
export function advance(d: Duelist, input: DuelistInput, ctx: StepContext): void {
  if (d.phase === 'dead') { d.vel = { x: 0, z: 0 }; return; }
  const dt = DT;
  const prevTime = d.phaseTime;
  d.phaseTime += dt;
  d.sinceStaminaSpend += dt;
  d.sincePostureHit += dt;
  d.sinceHurt += dt;
  d.sinceFeint += dt;
  d.sinceStep += dt;
  d.rattled = Math.max(0, d.rattled - dt);
  if (d.sinceFeint > FEINT_CHAIN_RESET) d.feintChain = 0;
  if (d.buffered) { d.buffered.ttl -= dt; if (d.buffered.ttl <= 0) d.buffered = null; }

  // Facing.
  const rate = turnRate(d);
  const diff = wrapAngle(input.facing - d.facing);
  d.facing = wrapAngle(d.facing + clamp(diff, -rate * dt, rate * dt));

  // Footwork displacement is applied before the phase can end so the full distance lands.
  if (d.phase === 'step') {
    const t = clamp(d.phaseTime / d.phaseDur, 0, 1);
    const target = d.stepDist * (0.5 - 0.5 * Math.cos(Math.PI * t));
    const delta = target - d.stepApplied;
    d.stepApplied = target;
    d.pos.x += d.stepDir.x * delta;
    d.pos.z += d.stepDir.z * delta;
    d.vel = { x: d.stepDir.x * delta / dt, z: d.stepDir.z * delta / dt };
  }

  // Phase transitions.
  const a = d.attack;
  switch (d.phase) {
    case 'drawing':
      if (d.phaseTime >= d.phaseDur) { d.drawn = true; ctx.events.push({ tick: ctx.tick, type: 'draw', a: d.id }); settle(d, ctx); }
      break;
    case 'sheathing':
      if (d.phaseTime >= d.phaseDur) { d.drawn = false; ctx.events.push({ tick: ctx.tick, type: 'sheath', a: d.id }); settle(d, ctx); }
      break;
    case 'stance_change':
      if (d.phaseTime >= d.phaseDur) {
        if (d.nextStance) d.stance = d.nextStance;
        d.nextStance = null;
        ctx.events.push({ tick: ctx.tick, type: 'stance', a: d.id });
        settle(d, ctx);
      }
      break;
    case 'windup':
      if (a && prevTime < a.commitAt && d.phaseTime >= a.commitAt) ctx.events.push({ tick: ctx.tick, type: 'commit', a: d.id, kind: a.kind });
      if (a && d.phaseTime >= d.phaseDur) {
        if (a.kind === 'draw_cut') d.drawn = true;
        a.prevAngle = a.arcStart;
        setPhase(d, 'active', a.active);
        ctx.events.push({ tick: ctx.tick, type: 'attack_active', a: d.id, kind: a.kind, line: a.line });
      }
      break;
    case 'active':
      if (a && d.phaseTime >= d.phaseDur) {
        let recovery = a.recovery;
        if (!a.contact) {
          recovery *= WHIFF_RECOVERY;
          if (a.committed) loseComposure(d, 0.06);
          ctx.events.push({ tick: ctx.tick, type: 'whiff', a: d.id, kind: a.kind });
        }
        setPhase(d, 'recover', recovery);
      }
      break;
    case 'parry':
      if (d.phaseTime >= d.phaseDur) {
        ctx.events.push({ tick: ctx.tick, type: 'parry_whiff', a: d.id });
        d.binding = false;
        setPhase(d, 'recover', PARRY.whiffRecovery);
      }
      break;
    case 'stagger':
      if (d.phaseTime >= d.phaseDur) {
        if (d.posture >= MAX_POSTURE) d.posture = 40;
        d.attack = null;
        settle(d, ctx);
      }
      break;
    case 'recover':
    case 'step':
      if (d.phaseTime >= d.phaseDur) {
        if (d.phase === 'recover') d.attack = null;
        settle(d, ctx);
      }
      break;
  }

  // Movement.
  const legScale = 1 - 0.15 * d.wounds.leg;
  if (d.phase !== 'step') integrateMovement(d, input, legScale);
  updateResources(d);
}

function integrateMovement(d: Duelist, input: DuelistInput, legScale: number): void {
  const dt = DT;
  const a = d.attack;
  if (d.phase === 'windup' && a && a.lungeWindup > 0) {
    const f = forward(d.facing);
    const s = a.lungeWindup / a.windup * dt;
    d.pos.x += f.x * s; d.pos.z += f.z * s;
  }
  if (d.phase === 'active' && a && a.lungeActive > 0 && !a.contact) {
    const f = forward(d.facing);
    const s = a.lungeActive / a.active * dt;
    d.pos.x += f.x * s; d.pos.z += f.z * s;
  }
  const base = !d.drawn && d.phase !== 'windup' ? SPEED.sheathed : d.guarding ? SPEED.guarding : SPEED.drawn;
  const m = input.move;
  const ml = Math.min(1, len(m));
  const local = ml > 0 ? { x: m.x / len(m) * ml, z: m.z / len(m) * ml } : { x: 0, z: 0 };
  const wish = localToWorld(local, d.facing);
  const speed = base * moveScale(d) * legScale;
  const tx = wish.x * speed, tz = wish.z * speed;
  const dvx = tx - d.vel.x, dvz = tz - d.vel.z;
  const dv = Math.hypot(dvx, dvz);
  const maxDv = SPEED.accel * dt;
  if (dv > maxDv) { d.vel.x += dvx / dv * maxDv; d.vel.z += dvz / dv * maxDv; }
  else { d.vel.x = tx; d.vel.z = tz; }
  d.pos.x += d.vel.x * dt;
  d.pos.z += d.vel.z * dt;
}

function updateResources(d: Duelist): void {
  const dt = DT;
  const exerting = d.phase === 'windup' || d.phase === 'active';
  if (d.guarding) {
    d.stamina = Math.max(0, d.stamina - GUARD_DRAIN * dt);
    d.sinceStaminaSpend = 0;
  } else if (!exerting && d.sinceStaminaSpend > STAMINA_REGEN_DELAY) {
    d.stamina = Math.min(MAX_STAMINA, d.stamina + STAMINA_REGEN * STANCES[d.stance].staminaRegen * (0.5 + 0.5 * d.composure) * (1 + TRAINING.endurance.regen * d.training.endurance) * dt);
  }
  if (d.sincePostureHit > POSTURE_REGEN_DELAY && d.phase !== 'stagger') {
    d.posture = Math.max(0, d.posture - POSTURE_REGEN * (0.5 + 0.5 * d.composure) * dt);
  }
  if (d.sinceHurt > 3 && d.stamina > 30) d.composure = Math.min(1, d.composure + 0.03 * dt);
  if (isExhausted(d)) d.composure = Math.max(0, d.composure - 0.02 * dt);
}
