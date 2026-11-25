/**
 * Other aircraft on the taxiways of the player's airport: departures that
 * arrive on the taxiway behind the stand, taxi to the hold-short line, wait
 * for their clearance, line up and roll. Closed-form in simulation time (no
 * state), so the world draws them and the session checks the player's
 * clearance from the same function. Pure.
 */

import type { Pt, TaxiRoute } from './groundOps'

export interface TrafficPose {
  visible: boolean
  x: number
  z: number
  headingDeg: number
  /** Height above the field (m): zero on the ground, then the climb-out. */
  lift: number
  pitchDeg: number
  speed: number
  /** Model index for the world to pick a glTF. */
  model: number
  /** Waiting at the hold line or lined up (on the pavement, not moving). */
  waiting: boolean
  /** Beyond the hold-short line: lining up or rolling. */
  onRunway: boolean
}

export const TAXI_SPEED = 7
const HOLD_WAIT = 55
const LINEUP_SPEED = 4.5
const ROLL_SECONDS = 36
const ROLL_ACCEL = 2.4
const GAP = 40
/** The taxiway section behind the stand that departures arrive from (m). */
const LEAD_IN = 300

const RAD = Math.PI / 180

function heading(dx: number, dz: number): number {
  return (((Math.atan2(dx, -dz) / RAD) % 360) + 360) % 360
}

interface Seg {
  a: Pt
  b: Pt
  len: number
  start: number
}

export class GroundTraffic {
  readonly count: number
  /** Taxi path from the far end of the taxiway behind the stand to the line-up point. */
  private readonly segs: Seg[] = []
  private readonly toHold: number
  private readonly toLineUp: number
  private readonly runwayHeading: number
  private readonly cycle: number
  private readonly lineUp: Pt

  constructor(readonly route: TaxiRoute, count = 2) {
    this.count = count
    const p = route.points
    const j = p[2]
    const c = p[3]
    const dx = c.x - j.x
    const dz = c.z - j.z
    const dl = Math.hypot(dx, dz) || 1
    const far: Pt = { x: j.x - (dx / dl) * LEAD_IN, z: j.z - (dz / dl) * LEAD_IN }
    const path: Pt[] = [far, j, c, p[4], p[5], p[route.lineUpIndex]]
    let at = 0
    for (let i = 0; i + 1 < path.length; i++) {
      const len = Math.hypot(path[i + 1].x - path[i].x, path[i + 1].z - path[i].z)
      this.segs.push({ a: path[i], b: path[i + 1], len, start: at })
      at += len
    }
    // Index 3 of the path is the hold-short point.
    this.toHold = this.segs[3].start
    this.toLineUp = at
    this.lineUp = path[path.length - 1]
    this.runwayHeading = route.end.headingDeg
    const taxiTime = this.toHold / TAXI_SPEED
    const lineUpTime = (this.toLineUp - this.toHold) / LINEUP_SPEED
    this.cycle = taxiTime + HOLD_WAIT + lineUpTime + ROLL_SECONDS + GAP
  }

  /** Position at `dist` metres along the taxi path. */
  private onPath(dist: number, out: TrafficPose): void {
    let s = this.segs[0]
    for (const seg of this.segs) {
      s = seg
      if (dist <= seg.start + seg.len) break
    }
    const f = s.len > 0 ? Math.max(0, Math.min(1, (dist - s.start) / s.len)) : 0
    out.x = s.a.x + (s.b.x - s.a.x) * f
    out.z = s.a.z + (s.b.z - s.a.z) * f
    out.headingDeg = heading(s.b.x - s.a.x, s.b.z - s.a.z)
  }

  /** Aircraft `i` at simulation time `t`. */
  poseAt(i: number, t: number, out: TrafficPose): TrafficPose {
    out.lift = 0
    out.pitchDeg = 0
    out.speed = 0
    out.waiting = false
    out.onRunway = false
    out.model = i
    // Staggered so one is on the taxiway ahead of the stand and another waits at the hold line from the start.
    const tau = (((t + (i + 0.4) * (this.cycle / this.count) + 14) % this.cycle) + this.cycle) % this.cycle
    const taxiTime = this.toHold / TAXI_SPEED
    const lineUpTime = (this.toLineUp - this.toHold) / LINEUP_SPEED
    out.visible = true
    if (tau < taxiTime) {
      this.onPath(tau * TAXI_SPEED, out)
      out.speed = TAXI_SPEED
    } else if (tau < taxiTime + HOLD_WAIT) {
      this.onPath(this.toHold, out)
      out.waiting = true
    } else if (tau < taxiTime + HOLD_WAIT + lineUpTime) {
      const d = this.toHold + (tau - taxiTime - HOLD_WAIT) * LINEUP_SPEED
      out.onRunway = true
      this.onPath(d, out)
      out.speed = LINEUP_SPEED
    } else if (tau < taxiTime + HOLD_WAIT + lineUpTime + ROLL_SECONDS) {
      const r = tau - taxiTime - HOLD_WAIT - lineUpTime
      out.onRunway = true
      const run = 0.5 * ROLL_ACCEL * r * r
      const rh = this.runwayHeading * RAD
      out.x = this.lineUp.x + Math.sin(rh) * run
      out.z = this.lineUp.z - Math.cos(rh) * run
      out.headingDeg = this.runwayHeading
      out.speed = ROLL_ACCEL * r
      if (out.speed > 70) {
        out.lift = (out.speed - 70) * (r - 29) * 0.9
        out.pitchDeg = 10
        if (out.lift < 0) out.lift = 0
      }
    } else out.visible = false
    return out
  }

  /** Whether an aircraft is lined up or rolling on the runway at time `t`. */
  runwayBusy(t: number, scratch: TrafficPose): boolean {
    for (let i = 0; i < this.count; i++) if (this.poseAt(i, t, scratch).onRunway && scratch.visible) return true
    return false
  }

  /**
   * The nearest aircraft in front of `from` (within 40 degrees of `headingDeg`), its distance, and whether any is
   * within `collideAt` metres in any direction.
   */
  nearestAhead(t: number, from: Pt, headingDeg: number, scratch: TrafficPose): { distance: number; model: number; hit: boolean } | null {
    let best: { distance: number; model: number; hit: boolean } | null = null
    const h = headingDeg * RAD
    const fx = Math.sin(h)
    const fz = -Math.cos(h)
    for (let i = 0; i < this.count; i++) {
      const p = this.poseAt(i, t, scratch)
      if (!p.visible || p.lift > 1) continue
      const dx = p.x - from.x
      const dz = p.z - from.z
      const d = Math.hypot(dx, dz)
      const hit = d < 30
      const cosA = d > 0 ? (dx * fx + dz * fz) / d : 1
      if ((cosA > 0.77 || hit) && (!best || d < best.distance)) best = { distance: d, model: p.model, hit }
    }
    return best
  }
}
