/**
 * The pilot's head: sags under g, bumps on touchdown, and looks around.
 * Pure maths (no three.js) so it can be unit-tested. Metres and radians, in
 * the body frame (+X right, +Y up, nose = -Z).
 */

export interface HeadInput {
  dt: number
  /** Load factor, 1 = level flight. */
  gForce: number
  /** Sim time of the last touchdown, or null. A new value triggers one bump. */
  touchdownAt: number | null
  /** Sink rate of that touchdown (m/s, positive). */
  touchdownSink: number
  /** Where the pilot is looking, relative to straight ahead (rad). */
  lookYaw: number
  lookPitch: number
}

const SAG_PER_G = 0.014
const SAG_LIMIT = 0.07
const SPRING_K = 90
const SPRING_C = 2 * Math.sqrt(SPRING_K) * 0.45
/** Head turns with this time constant (s). */
const LOOK_TAU = 0.09
export const LOOK_YAW_LIMIT = (140 * Math.PI) / 180
export const LOOK_PITCH_MIN = (-35 * Math.PI) / 180
export const LOOK_PITCH_MAX = (65 * Math.PI) / 180

export class HeadMotion {
  /** Offset from the eye point (m). */
  y = 0
  private vy = 0
  yaw = 0
  pitch = 0
  private lastTouchdown: number | null = null

  reset(): void {
    this.y = 0
    this.vy = 0
    this.yaw = 0
    this.pitch = 0
    this.lastTouchdown = null
  }

  update(input: HeadInput): void {
    const dt = Math.min(Math.max(input.dt, 0), 0.05)
    if (dt === 0) return

    if (input.touchdownAt !== null && input.touchdownAt !== this.lastTouchdown) {
      // First sight of a touchdown after a reset is not a bump (it may be an old one).
      if (this.lastTouchdown !== null) this.vy -= Math.min(0.6, Math.max(0, input.touchdownSink) * 0.14)
      this.lastTouchdown = input.touchdownAt
    } else if (input.touchdownAt === null) {
      this.lastTouchdown = null
    }

    const g = Number.isFinite(input.gForce) ? input.gForce : 1
    const target = -Math.max(-SAG_LIMIT, Math.min(SAG_LIMIT, (g - 1) * SAG_PER_G))
    const accel = SPRING_K * (target - this.y) - SPRING_C * this.vy
    this.vy += accel * dt
    this.y += this.vy * dt

    const k = 1 - Math.exp(-dt / LOOK_TAU)
    const wantYaw = Math.max(-LOOK_YAW_LIMIT, Math.min(LOOK_YAW_LIMIT, input.lookYaw))
    const wantPitch = Math.max(LOOK_PITCH_MIN, Math.min(LOOK_PITCH_MAX, input.lookPitch))
    this.yaw += (wantYaw - this.yaw) * k
    this.pitch += (wantPitch - this.pitch) * k
  }
}
