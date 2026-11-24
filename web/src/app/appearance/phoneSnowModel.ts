export type Vector = { x: number; y: number; z: number };
export type PhoneSnowState = { gravity: Vector | null; down: { x: number; y: number }; wind: number; shakeAt: number; impulse: Vector | null; impulseAt: number; lastAt: number };
export function newPhoneSnowState(): PhoneSnowState { return { gravity: null, down: { x: 0, y: 1 }, wind: 0, shakeAt: -Infinity, impulse: null, impulseAt: 0, lastAt: -Infinity }; }
export function motionVector(value: { x: number | null; y: number | null; z: number | null } | null): Vector | null {
  if (!value || ![value.x, value.y, value.z].every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 100)) return null;
  return value as Vector;
}
export function usesAppleMotionConvention(platform: { userAgent: string; platform: string; maxTouchPoints: number }) {
  return /iPhone|iPad|iPod/.test(platform.userAgent) || (platform.platform === "MacIntel" && platform.maxTouchPoints > 1);
}
export function normalizeMotion(value: Vector | null, apple: boolean): Vector | null {
  return value && apple ? { x: -value.x, y: -value.y, z: -value.z } : value;
}
// Device axes stay in the natural orientation. Canvas Y points down.
export function screenGravity(gravity: Vector, angle: number) {
  const radians = angle * Math.PI / 180;
  const x = -(gravity.x * Math.cos(radians) - gravity.y * Math.sin(radians));
  const y = gravity.y * Math.cos(radians) + gravity.x * Math.sin(radians);
  const magnitude = Math.hypot(x, y);
  // When laid flat, retain the last usable in-plane direction instead of noise.
  return magnitude < 1.8 ? null : { x: x / magnitude, y: y / magnitude };
}
export function updatePhoneSnow(state: PhoneSnowState, gravity: Vector | null, acceleration: Vector | null, at: number, angle = 0): PhoneSnowState {
  if ((!gravity && !acceleration) || at <= state.lastAt) return state;
  // Evaluate gesture impulses on every sample; short peaks can fall between render frames.
  const elapsed = Number.isFinite(state.lastAt) ? Math.min(100, at - state.lastAt) : 33;
  const gravityBlend = 1 - Math.pow(.9, elapsed / 33), windBlend = 1 - Math.pow(.85, elapsed / 33);
  const previous = state.gravity;
  const nextGravity = gravity ? (previous ? { x: previous.x * (1 - gravityBlend) + gravity.x * gravityBlend, y: previous.y * (1 - gravityBlend) + gravity.y * gravityBlend, z: previous.z * (1 - gravityBlend) + gravity.z * gravityBlend } : gravity) : previous;
  const radians = angle * Math.PI / 180;
  const targetWind = nextGravity ? Math.max(-1, Math.min(1, -(nextGravity.x * Math.cos(radians) - nextGravity.y * Math.sin(radians)) / 7)) : 0;
  const down = nextGravity ? screenGravity(nextGravity, angle) ?? state.down : state.down;
  const next = { ...state, gravity: nextGravity, down, wind: state.wind * (1 - windBlend) + targetWind * windBlend, lastAt: at };
  const residual = gravity && previous ? { x: gravity.x - previous.x, y: gravity.y - previous.y, z: gravity.z - previous.z } : null;
  // Some embedded browsers expose a zero linear channel but usable raw readings.
  const linear = acceleration && Math.hypot(acceleration.x, acceleration.y, acceleration.z) > .2 ? acceleration : residual;
  if (!linear || Math.hypot(linear.x, linear.y, linear.z) < 4.5) return next;
  if (state.impulse && at - state.impulseAt >= 60 && at - state.impulseAt < 700) {
    const dot = linear.x * state.impulse.x + linear.y * state.impulse.y + linear.z * state.impulse.z;
    if (dot < -.25 * Math.hypot(linear.x, linear.y, linear.z) * Math.hypot(state.impulse.x, state.impulse.y, state.impulse.z) && at - state.shakeAt >= 4000) return { ...next, shakeAt: at, impulse: null, impulseAt: 0 };
  }
  if (!state.impulse || at - state.impulseAt >= 700) return { ...next, impulse: linear, impulseAt: at };
  return next;
}
