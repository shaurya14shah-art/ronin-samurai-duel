// Ground-plane math for the duel sim. Vec2 is (x, z) in world metres.
// Facing convention: yaw θ, forward = (sin θ, cos θ), right = (-cos θ, sin θ)
// (right = forward × up in Three's right-handed Y-up frame).

export interface Vec2 { x: number; z: number }

export const vec = (x = 0, z = 0): Vec2 => ({ x, z });
export const len = (v: Vec2): number => Math.hypot(v.x, v.z);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z);
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export function forward(yaw: number): Vec2 {
  return { x: Math.sin(yaw), z: Math.cos(yaw) };
}

export function right(yaw: number): Vec2 {
  return { x: -Math.cos(yaw), z: Math.sin(yaw) };
}

/** Yaw that faces from `from` toward `to`. */
export function yawTo(from: Vec2, to: Vec2): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

/** Bearing of `target` relative to `origin`'s facing: 0 ahead, positive to origin's right. */
export function bearing(origin: Vec2, yaw: number, target: Vec2): number {
  const dx = target.x - origin.x, dz = target.z - origin.z;
  const f = forward(yaw), r = right(yaw);
  return Math.atan2(dx * r.x + dz * r.z, dx * f.x + dz * f.z);
}

/** Convert a local (x = right, z = forward) direction into world space for a yaw. */
export function localToWorld(local: Vec2, yaw: number): Vec2 {
  const f = forward(yaw), r = right(yaw);
  return { x: r.x * local.x + f.x * local.z, z: r.z * local.x + f.z * local.z };
}

export function easeInOut(t: number): number {
  t = clamp(t, 0, 1);
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

export const DEG = Math.PI / 180;
