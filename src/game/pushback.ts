/**
 * The tug's job: push the aircraft tail-first off its stand, swinging the nose
 * round towards the taxiway, then stop and hand it back to the pilot. Pure: it
 * is given the heading and says how fast to push and how fast to swing.
 */

/** Push this far before stopping (m). */
export const PUSH_DISTANCE = 55
/** Hard stop, whatever the heading is (m). */
const MAX_DISTANCE = 120
/** The nose swings after this much straight pushing (m). */
const SWING_AFTER = 20
const PUSH_SPEED = 1.6
const SWING_SPEED = 1.1
const MAX_YAW_RATE = 3.5
const DONE_ERROR = 3

const norm = (d: number): number => (((d % 360) + 540) % 360) - 180

export interface TugCommand {
  /** Tail-first speed (m/s). */
  speed: number
  /** Nose swing (deg/s, positive = nose to the right). */
  yawRate: number
}

export class Pushback {
  private _distance = 0
  private _done = false

  constructor(readonly targetHeadingDeg: number) {}

  get distance(): number {
    return this._distance
  }

  get done(): boolean {
    return this._done
  }

  /** One step: the tug command for this heading. */
  update(dt: number, headingDeg: number): TugCommand {
    if (this._done) return { speed: 0, yawRate: 0 }
    const error = norm(this.targetHeadingDeg - headingDeg)
    if ((this._distance >= PUSH_DISTANCE && Math.abs(error) < DONE_ERROR) || this._distance >= MAX_DISTANCE) {
      this._done = true
      return { speed: 0, yawRate: 0 }
    }
    const swinging = this._distance >= SWING_AFTER && Math.abs(error) >= DONE_ERROR
    const speed = swinging || this._distance >= PUSH_DISTANCE ? SWING_SPEED : PUSH_SPEED
    this._distance += speed * dt
    const yawRate = swinging ? Math.max(-MAX_YAW_RATE, Math.min(MAX_YAW_RATE, error * 0.6)) : 0
    return { speed, yawRate }
  }
}

/**
 * The heading to leave the stand on: towards the first taxiway waypoint, but
 * no more than 40 degrees off the stand heading.
 */
export function pushbackTarget(standHeadingDeg: number, from: { x: number; z: number }, to: { x: number; z: number }): number {
  const bearing = (Math.atan2(to.x - from.x, -(to.z - from.z)) * 180) / Math.PI
  const off = Math.max(-40, Math.min(40, norm(bearing - standHeadingDeg)))
  return (((standHeadingDeg + off) % 360) + 360) % 360
}
