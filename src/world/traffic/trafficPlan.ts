/**
 * AI airliner traffic: deterministic flight plans, no physics. Each aircraft
 * flies back-to-back legs between airports: line up, take-off roll, climb with
 * terrain clearance, cruise, a 3 degree approach, touchdown and roll-out, then
 * a pause out of sight. Position is a pure function of time, so it needs no
 * state, survives pauses and can be tested. World frame: +X east, +Z south,
 * heading 0 = north (-Z).
 */

import { AIRPORTS, type AirportDef } from '../../config/airports'
import { headingVector, runwayEnds, type RunwayEnd } from '../../game/airportGeometry'

export const TRAFFIC = {
  /** Runways shorter than this are not used by the airliners. */
  minRunway: 1500,
  /** Distance along the take-off roll where the aircraft lifts off (m). */
  liftoffDistance: 1300,
  accel: 2.4,
  brakeAir: 1.2,
  brakeRoll: 3.0,
  cruiseSpeed: 135,
  approachSpeed: 72,
  touchdownSpeed: 68,
  climbGradient: Math.tan((7 * Math.PI) / 180),
  glideGradient: Math.tan((3 * Math.PI) / 180),
  /** Steepest climb and descent the terrain-clearance smoothing may ask for. */
  maxClimbGradient: Math.tan((9 * Math.PI) / 180),
  maxDescentGradient: Math.tan((6 * Math.PI) / 180),
  /** Minimum height above the ground in the cruise, fading out towards both airports (m). */
  clearance: 250,
  /** Straight-in final starts this far before the threshold (m). */
  finalDistance: 7000,
  /** Smallest turn radius the path rounds its corners with (m): about 32 degrees of bank at cruise speed. */
  cornerRadius: 3400,
  /** Distance beyond the runway end where the departure turn starts, and before the final where the intercept turn ends (m). */
  turnLead: 3500,
  /** Seconds lined up on the runway before the roll, and stopped after roll-out, both visible. */
  lineup: 6,
  holdAfter: 8,
  /** Out of sight between legs (s): taxi, turnaround. */
  gapMin: 30,
  gapMax: 90,
  maxBank: (32 * Math.PI) / 180,
  /** Spacing of the sampled path (m). */
  step: 40,
} as const

const G = 9.80665

export interface TrafficPose {
  visible: boolean
  x: number
  y: number
  z: number
  /** Degrees clockwise from north. */
  headingDeg: number
  pitchDeg: number
  /** Degrees, positive = right wing down. */
  bankDeg: number
  onGround: boolean
  /** m/s along the path. */
  speed: number
}

export interface PlannerOptions {
  seed?: number
  /** Ground height (m) at a world position, used for terrain clearance. */
  heightAt: (x: number, z: number) => number
  airports?: readonly AirportDef[]
}

export interface Leg {
  from: AirportDef
  to: AirportDef
  dep: RunwayEnd
  arr: RunwayEnd
  /** Time (s, plan time) the aircraft appears lined up. */
  start: number
  /** Seconds from the start of the roll to the stop. */
  duration: number
  /** Time the next leg appears. */
  next: number
  n: number
  x: Float32Array
  y: Float32Array
  z: Float32Array
  heading: Float32Array
  pitch: Float32Array
  bank: Float32Array
  v: Float32Array
  /** Seconds from the start of the roll at each sample. */
  t: Float64Array
  onGround: Uint8Array
}

function hash(...parts: number[]): number {
  let h = 2166136261
  for (const p of parts) {
    h ^= p | 0
    h = Math.imul(h, 16777619)
    h ^= h >>> 13
  }
  return h >>> 0
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type P2 = [number, number]

/** The polyline with each corner replaced by a circular arc (radius reduced where the legs are too short for it). */
function roundCorners(pts: P2[], radius: number): P2[] {
  const out: P2[] = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]
    const l1 = Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1])
    const l2 = Math.hypot(pts[i + 1][0] - p[0], pts[i + 1][1] - p[1])
    const u: P2 = [(p[0] - pts[i - 1][0]) / l1, (p[1] - pts[i - 1][1]) / l1]
    const w: P2 = [(pts[i + 1][0] - p[0]) / l2, (pts[i + 1][1] - p[1]) / l2]
    const theta = Math.acos(Math.max(-1, Math.min(1, u[0] * w[0] + u[1] * w[1])))
    if (theta < 0.02) {
      out.push(p)
      continue
    }
    const half = Math.tan(Math.min(theta, Math.PI * 0.95) / 2)
    const t = Math.min(radius * half, 0.45 * Math.min(l1, l2))
    const r = t / half
    const side = u[0] * w[1] - u[1] * w[0] > 0 ? 1 : -1
    const entry: P2 = [p[0] - u[0] * t, p[1] - u[1] * t]
    const centre: P2 = [entry[0] + side * -u[1] * r, entry[1] + side * u[0] * r]
    const a0 = Math.atan2(entry[1] - centre[1], entry[0] - centre[0])
    const m = Math.max(3, Math.ceil((theta * r) / 60))
    for (let k = 0; k <= m; k++) {
      const a = a0 + side * theta * (k / m)
      out.push([centre[0] + Math.cos(a) * r, centre[1] + Math.sin(a) * r])
    }
  }
  out.push(pts[pts.length - 1])
  return out
}

/** The polyline resampled at a constant spacing along its length. */
function resample(pts: P2[], step: number): P2[] {
  const cum = [0]
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
  const total = cum[cum.length - 1]
  const n = Math.max(2, Math.floor(total / step) + 1)
  const out: P2[] = []
  let j = 0
  for (let i = 0; i < n; i++) {
    const s = Math.min(i * step, total)
    while (j < pts.length - 2 && cum[j + 1] < s) j++
    const seg = cum[j + 1] - cum[j]
    const f = seg > 1e-9 ? (s - cum[j]) / seg : 0
    out.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * f, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * f])
  }
  return out
}

function wrapPi(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a))
}

function smooth(a: Float32Array, passes: number): void {
  const tmp = new Float32Array(a.length)
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < a.length; i++) tmp[i] = (a[Math.max(0, i - 1)] + a[i] * 2 + a[Math.min(a.length - 1, i + 1)]) / 4
    a.set(tmp)
  }
}

export class TrafficPlanner {
  private readonly seed: number
  private readonly heightAt: (x: number, z: number) => number
  private readonly airports: readonly AirportDef[]
  private readonly legs = new Map<number, Leg[]>()
  private readonly cursor = new Map<number, number>()
  private readonly endsCache = new Map<string, RunwayEnd[]>()

  constructor(opts: PlannerOptions) {
    this.seed = opts.seed ?? 1
    this.heightAt = opts.heightAt
    this.airports = (opts.airports ?? AIRPORTS).filter((a) => this.usableEnds(a).length > 0)
  }

  private usableEnds(a: AirportDef): RunwayEnd[] {
    let ends = this.endsCache.get(a.id)
    if (!ends) {
      ends = runwayEnds(a).filter((e) => e.runway.def.length >= TRAFFIC.minRunway)
      this.endsCache.set(a.id, ends)
    }
    return ends
  }

  /** Seconds the aircraft's schedule is ahead of the clock, so the fleet is not in step. */
  private offsetOf(index: number): number {
    return mulberry32(hash(this.seed, index, 7))() * 600
  }

  leg(index: number, k: number): Leg {
    let list = this.legs.get(index)
    if (!list) {
      list = []
      this.legs.set(index, list)
    }
    while (list.length <= k) {
      const j = list.length
      const rng = mulberry32(hash(this.seed, index, j, 99))
      const from = j === 0 ? this.airports[Math.floor(rng() * this.airports.length)] : list[j - 1].to
      const start = j === 0 ? 0 : list[j - 1].next
      list.push(this.buildLeg(from, start, rng))
    }
    return list[k]
  }

  private pickDestination(from: AirportDef, rng: () => number): AirportDef {
    const others = this.airports.filter((a) => a.id !== from.id)
    const inRange = others.filter((a) => {
      const d = Math.hypot(a.center.x - from.center.x, a.center.z - from.center.z)
      return d >= 18000 && d <= 65000
    })
    const pool = inRange.length > 0 ? inRange : others
    return pool[Math.floor(rng() * pool.length)]
  }

  private buildLeg(from: AirportDef, start: number, rng: () => number): Leg {
    const to = this.pickDestination(from, rng)
    // Use runway ends that point roughly the way the flight goes, so no leg needs a hairpin.
    const bearing = Math.atan2(to.center.x - from.center.x, -(to.center.z - from.center.z))
    const alignment = (e: RunwayEnd) => Math.abs(wrapPi((e.headingDeg * Math.PI) / 180 - bearing))
    const pickAligned = (ends: RunwayEnd[]): RunwayEnd => {
      const best = Math.min(...ends.map(alignment))
      const good = ends.filter((e) => alignment(e) <= best + (20 * Math.PI) / 180)
      return good[Math.floor(rng() * good.length)]
    }
    const dep = pickAligned(this.usableEnds(from))
    const arr = pickAligned(this.usableEnds(to))
    const cruise = 2300 + rng() * 900
    const gap = TRAFFIC.gapMin + rng() * (TRAFFIC.gapMax - TRAFFIC.gapMin)

    // Control polygon: collinear points keep the roll and the final straight.
    const d0 = headingVector(dep.headingDeg)
    const len0 = dep.runway.def.length
    const dA = headingVector(arr.headingDeg)
    const lenA = arr.runway.def.length
    const at = (e: RunwayEnd, d: { x: number; z: number }, along: number): P2 => [e.threshold.x + d.x * along, e.threshold.z + d.z * along]
    const poly: P2[] = [
      at(dep, d0, 0),
      at(dep, d0, len0 + TRAFFIC.turnLead),
      at(arr, dA, -(TRAFFIC.finalDistance + TRAFFIC.turnLead)),
      at(arr, dA, 0),
      at(arr, dA, lenA),
    ]
    const path = resample(roundCorners(poly, TRAFFIC.cornerRadius), TRAFFIC.step)
    const n = path.length
    const ds = TRAFFIC.step

    // Where the threshold is along the sampled path.
    const T = poly[3]
    let iT = 0
    let best = Infinity
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(path[i][0] - T[0], path[i][1] - T[1])
      if (d < best) {
        best = d
        iT = i
      }
    }
    const sT = iT * ds
    const iLO = Math.min(n - 1, Math.round(Math.min(TRAFFIC.liftoffDistance, len0 * 0.85) / ds))
    const sLO = iLO * ds
    const e0 = from.elevation
    const eA = to.elevation

    // Altitude: the lowest of the cruise ceiling, the climb and the 3 degree glide, kept clear of the terrain.
    const alt = new Float32Array(n)
    const ground = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const s = i * ds
      ground[i] = this.heightAt(path[i][0], path[i][1])
      if (s >= sT) {
        alt[i] = eA
        continue
      }
      const profile = Math.min(cruise, e0 + Math.max(0, s - sLO) * TRAFFIC.climbGradient, eA + (sT - s) * TRAFFIC.glideGradient)
      const fade = Math.max(0, Math.min(1, Math.min(s - (sLO + 1500), sT - s - 1500) / 3000))
      alt[i] = Math.max(profile, s < sLO ? e0 : ground[i] + TRAFFIC.clearance * fade)
    }
    for (let i = n - 2; i >= 0; i--) alt[i] = Math.max(alt[i], alt[i + 1] - TRAFFIC.maxClimbGradient * ds)
    for (let i = 1; i < n; i++) alt[i] = Math.max(alt[i], alt[i - 1] - TRAFFIC.maxDescentGradient * ds)
    for (let i = 0; i < n; i++) {
      if (i * ds < sLO) alt[i] = e0
      else if (i >= iT) alt[i] = eA
    }

    const x = new Float32Array(n)
    const z = new Float32Array(n)
    const heading = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      x[i] = path[i][0]
      z[i] = path[i][1]
      const a = path[Math.max(0, i - 1)]
      const b = path[Math.min(n - 1, i + 1)]
      heading[i] = Math.atan2(b[0] - a[0], -(b[1] - a[1]))
    }

    // Speed: accelerate from rest, slow for the approach and brake on the runway.
    let iF = iT - Math.round(TRAFFIC.finalDistance / ds)
    iF = Math.max(0, iF)
    const v = new Float32Array(n)
    const cap = new Float32Array(n).fill(TRAFFIC.cruiseSpeed)
    // Tight bends (short legs) are flown slower so the bank stays within limits.
    for (let i = 1; i < n - 1; i++) {
      const rate = Math.abs(wrapPi(heading[i + 1] - heading[i - 1])) / (2 * ds)
      if (rate > 1e-6) cap[i] = Math.min(cap[i], Math.max(85, Math.sqrt((G * Math.tan(TRAFFIC.maxBank)) / rate)))
    }
    cap[0] = 0
    cap[iF] = Math.min(cap[iF], TRAFFIC.approachSpeed)
    cap[iT] = Math.min(cap[iT], TRAFFIC.touchdownSpeed)
    cap[n - 1] = 0
    for (let i = 1; i < n; i++) v[i] = Math.min(cap[i], Math.sqrt(v[i - 1] * v[i - 1] + 2 * TRAFFIC.accel * ds))
    for (let i = n - 2; i >= 0; i--) {
      const decel = i >= iT ? TRAFFIC.brakeRoll : TRAFFIC.brakeAir
      v[i] = Math.min(v[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * decel * ds))
    }
    const t = new Float64Array(n)
    for (let i = 0; i < n - 1; i++) t[i + 1] = t[i] + (2 * ds) / Math.max(v[i] + v[i + 1], 0.5)

    // Attitude from the path.
    const pitch = new Float32Array(n)
    const bank = new Float32Array(n)
    const onGround = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
      onGround[i] = i * ds < sLO || i >= iT ? 1 : 0
      const slope = Math.atan2(alt[Math.min(n - 1, i + 1)] - alt[Math.max(0, i - 1)], (Math.min(n - 1, i + 1) - Math.max(0, i - 1)) * ds)
      pitch[i] = onGround[i] ? 0 : Math.max(-0.14, Math.min(0.2, slope + 0.04))
    }
    for (let i = 0; i < n; i++) {
      const dpsi = wrapPi(heading[Math.min(n - 1, i + 1)] - heading[Math.max(0, i - 1)]) / (Math.min(n - 1, i + 1) - Math.max(0, i - 1)) / ds
      bank[i] = onGround[i] ? 0 : Math.max(-TRAFFIC.maxBank, Math.min(TRAFFIC.maxBank, Math.atan((v[i] * v[i] * dpsi) / G)))
    }
    smooth(pitch, 6)
    smooth(bank, 6)

    const duration = t[n - 1]
    return {
      from,
      to,
      dep,
      arr,
      start,
      duration,
      next: start + TRAFFIC.lineup + duration + TRAFFIC.holdAfter + gap,
      n,
      x,
      y: alt,
      z,
      heading,
      pitch,
      bank,
      v,
      t,
      onGround,
    }
  }

  poseAt(index: number, time: number, out?: TrafficPose): TrafficPose {
    const pose =
      out ??
      ({ visible: false, x: 0, y: 0, z: 0, headingDeg: 0, pitchDeg: 0, bankDeg: 0, onGround: true, speed: 0 } as TrafficPose)
    const tau = Math.max(0, time) + this.offsetOf(index)
    let k = Math.min(this.cursor.get(index) ?? 0, 100000)
    while (k > 0 && tau < this.leg(index, k).start) k--
    while (tau >= this.leg(index, k).next) k++
    this.cursor.set(index, k)
    const leg = this.leg(index, k)

    const local = tau - leg.start
    const roll = local - TRAFFIC.lineup
    pose.visible = true
    if (roll >= leg.duration + TRAFFIC.holdAfter) {
      pose.visible = false
      return pose
    }
    let j: number
    let f: number
    if (roll <= 0) {
      j = 0
      f = 0
    } else if (roll >= leg.duration) {
      j = leg.n - 2
      f = 1
    } else {
      let lo = 0
      let hi = leg.n - 1
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1
        if (leg.t[mid] <= roll) lo = mid
        else hi = mid
      }
      j = lo
      f = (roll - leg.t[j]) / Math.max(leg.t[j + 1] - leg.t[j], 1e-9)
    }
    const lerp = (a: Float32Array) => a[j] + (a[j + 1] - a[j]) * f
    pose.x = lerp(leg.x)
    pose.y = lerp(leg.y)
    pose.z = lerp(leg.z)
    const dh = wrapPi(leg.heading[j + 1] - leg.heading[j])
    pose.headingDeg = ((((leg.heading[j] + dh * f) * 180) / Math.PI) % 360 + 360) % 360
    pose.pitchDeg = (lerp(leg.pitch) * 180) / Math.PI
    pose.bankDeg = (lerp(leg.bank) * 180) / Math.PI
    pose.onGround = leg.onGround[f > 0.5 ? j + 1 : j] === 1
    pose.speed = lerp(leg.v)
    return pose
  }
}
