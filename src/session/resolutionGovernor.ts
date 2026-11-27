/**
 * Adaptive render resolution. A weak or software GPU is limited by how many
 * pixels it shades, so when frames run long the canvas renders fewer pixels
 * (the page still fills the window; the image just gets softer), and when
 * there is plenty of headroom it climbs back. Pure: it is fed frame times and
 * answers with the device-pixel-ratio to use.
 */

export interface GovernorOptions {
  /** Highest ratio allowed (the quality profile's cap, limited by the display). */
  max: number
  /** Lowest ratio ever used. */
  min?: number
  /** Start here (a software renderer starts low). */
  start?: number
  /** Frames longer than this (ms, smoothed) mean we are too slow: scale down. */
  slowMs?: number
  /** Frames shorter than this (ms, smoothed) for a while mean there is headroom. */
  fastMs?: number
}

const STEP_DOWN = 0.85
const STEP_UP = 1.08
/** How long the smoothed frame time must stay low before climbing (s). */
const CLIMB_AFTER = 6
/** After a downgrade, do not climb back above the failed level for this long (s). */
const HOLD_CEILING = 40
/** Frames longer than this are a hidden tab or a pause: ignored. */
const HIDDEN_MS = 5000
/** A slow frame counts as at most this, so one hitch cannot swing the average (a machine this slow still reads as slow). */
const CAP_MS = 400

export class ResolutionGovernor {
  private scale: number
  private ema = 16.7
  private since = 0
  private calm = 0
  private ceiling: number
  private ceilingUntil = 0
  private clock = 0
  private floorTime = 0
  private readonly min: number
  private readonly max: number
  private readonly slow: number
  private readonly fast: number

  constructor(o: GovernorOptions) {
    this.max = o.max
    this.min = Math.min(o.min ?? 0.5, o.max)
    this.slow = o.slowMs ?? 31
    this.fast = o.fastMs ?? 25
    this.scale = Math.min(this.max, Math.max(this.min, o.start ?? o.max))
    this.ceiling = this.max
  }

  get current(): number {
    return this.scale
  }

  /** Seconds spent at the lowest resolution while frames are still too slow: the cue to lower the quality tier. */
  get stuckSeconds(): number {
    return this.floorTime
  }

  resetStuck(): void {
    this.floorTime = 0
  }

  /** Feed one frame (ms). Returns the ratio to use, which changes at most about once a second. */
  frame(ms: number): number {
    if (!(ms > 0) || ms > HIDDEN_MS) return this.scale
    ms = Math.min(ms, CAP_MS)
    this.clock += ms / 1000
    this.ema += (ms - this.ema) * 0.04
    this.since += ms / 1000
    if (this.scale <= this.min + 1e-6 && this.ema > this.slow) this.floorTime += ms / 1000
    else this.floorTime = 0
    if (this.since < 1) return this.scale
    this.since = 0
    if (this.clock > this.ceilingUntil && this.ceiling < this.max) {
      // Probe a little higher now and then, instead of straight back to the maximum.
      this.ceiling = Math.min(this.max, this.ceiling * 1.12)
      this.ceilingUntil = this.clock + HOLD_CEILING
    }
    if (this.ema > this.slow && this.scale > this.min) {
      // Too slow: remember where it failed and step down.
      this.scale = Math.max(this.min, this.scale * STEP_DOWN)
      this.ceiling = this.scale
      this.ceilingUntil = this.clock + HOLD_CEILING
      this.calm = 0
    } else if (this.ema < this.fast && this.scale < Math.min(this.max, this.ceiling)) {
      this.calm++
      if (this.calm >= CLIMB_AFTER) {
        this.scale = Math.min(this.max, this.ceiling, this.scale * STEP_UP)
        this.calm = 0
      }
    } else this.calm = 0
    return this.scale
  }
}
