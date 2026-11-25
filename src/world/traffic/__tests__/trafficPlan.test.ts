import { describe, expect, it } from 'vitest'
import { inRect } from '../../../game/airportGeometry'
import { TRAFFIC, TrafficPlanner, type TrafficPose } from '../trafficPlan'

const flat = () => 0
/** A tall ridge between the central and western airports, clear of every airfield (the real terrain is flattened to each airport's elevation). */
const ridge = (x: number, z: number) => 1800 * Math.exp(-(((x + 15000) / 3000) ** 2 + ((z - 5000) / 6000) ** 2))

function fresh(): TrafficPose {
  return { visible: false, x: 0, y: 0, z: 0, headingDeg: 0, pitchDeg: 0, bankDeg: 0, onGround: true, speed: 0 }
}

describe('TrafficPlanner', () => {
  it('is deterministic for a seed and differs between seeds', () => {
    const a = new TrafficPlanner({ seed: 5, heightAt: flat })
    const b = new TrafficPlanner({ seed: 5, heightAt: flat })
    const c = new TrafficPlanner({ seed: 6, heightAt: flat })
    let differs = false
    for (let t = 0; t < 900; t += 37) {
      const pa = a.poseAt(2, t)
      const pb = b.poseAt(2, t)
      expect(pa).toEqual(pb)
      if (c.poseAt(2, t).x !== pa.x) differs = true
    }
    expect(differs).toBe(true)
  })

  it('moves smoothly: no jumps in position, heading or speed while visible', () => {
    const planner = new TrafficPlanner({ seed: 3, heightAt: ridge })
    const dt = 0.1
    for (let i = 0; i < 4; i++) {
      let prev: TrafficPose | null = null
      for (let t = 0; t < 1800; t += dt) {
        const p = { ...planner.poseAt(i, t) }
        if (prev && prev.visible && p.visible) {
          const moved = Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z)
          expect(moved, `aircraft ${i} at ${t.toFixed(1)} s`).toBeLessThan(TRAFFIC.cruiseSpeed * dt * 1.6 + 1)
          const dh = Math.abs(((p.headingDeg - prev.headingDeg + 540) % 360) - 180)
          expect(dh, `heading jump, aircraft ${i} at ${t.toFixed(1)} s`).toBeLessThan(3)
          expect(Math.abs(p.speed - prev.speed)).toBeLessThan(TRAFFIC.brakeRoll * dt * 3 + 0.5)
        }
        prev = p
      }
    }
  })

  it('stays within speed, bank and pitch limits', () => {
    const planner = new TrafficPlanner({ seed: 9, heightAt: ridge })
    for (let i = 0; i < 4; i++) {
      for (let t = 0; t < 1800; t += 1.3) {
        const p = planner.poseAt(i, t)
        if (!p.visible) continue
        expect(p.speed).toBeGreaterThanOrEqual(0)
        expect(p.speed).toBeLessThanOrEqual(TRAFFIC.cruiseSpeed + 0.5)
        expect(Math.abs(p.bankDeg)).toBeLessThanOrEqual(32.5)
        expect(p.pitchDeg).toBeLessThan(13)
        expect(p.pitchDeg).toBeGreaterThan(-9)
        for (const n of [p.x, p.y, p.z, p.headingDeg]) expect(Number.isFinite(n)).toBe(true)
      }
    }
  })

  it('lines up, rolls and lifts off along the departure runway', () => {
    const planner = new TrafficPlanner({ seed: 4, heightAt: flat })
    const leg = planner.leg(0, 0)
    const rect = leg.dep.runway.rect
    for (let i = 0; i < leg.n; i++) {
      if (!leg.onGround[i] || leg.t[i] > 60) break
      if (leg.v[i] <= 0 && i > 0) continue
      const margin = 3
      // Everything before lift-off stays on the runway rectangle.
      if (i * TRAFFIC.step < TRAFFIC.liftoffDistance) {
        expect(inRect(rect, leg.x[i], leg.z[i], margin), `sample ${i}`).toBe(true)
        expect(leg.y[i]).toBeCloseTo(leg.from.elevation, 3)
      }
    }
    // The first sample is the threshold, lined up with the runway heading.
    expect(Math.hypot(leg.x[0] - leg.dep.threshold.x, leg.z[0] - leg.dep.threshold.z)).toBeLessThan(1)
    const dh = Math.abs(((((leg.heading[0] * 180) / Math.PI) - leg.dep.headingDeg + 540) % 360) - 180)
    expect(dh).toBeLessThan(1)
  })

  it('touches down at the threshold of the arrival runway and stops on it', () => {
    const planner = new TrafficPlanner({ seed: 8, heightAt: flat })
    const leg = planner.leg(1, 0)
    const last = leg.n - 1
    expect(leg.v[last]).toBe(0)
    expect(leg.y[last]).toBeCloseTo(leg.to.elevation, 3)
    expect(inRect(leg.arr.runway.rect, leg.x[last], leg.z[last], 3)).toBe(true)
    // The ground phase after touchdown is on the runway and never above field elevation.
    for (let i = 0; i <= last; i++) if (leg.onGround[i] && i > leg.n / 2) expect(leg.y[i]).toBeCloseTo(leg.to.elevation, 3)
  })

  it('keeps clear of high ground away from the airports', () => {
    const planner = new TrafficPlanner({ seed: 2, heightAt: ridge })
    for (let i = 0; i < 6; i++) {
      for (let k = 0; k < 3; k++) {
        const leg = planner.leg(i, k)
        for (let s = 0; s < leg.n; s++) {
          if (leg.onGround[s]) continue
          const dist = Math.min(s * TRAFFIC.step, (leg.n - s) * TRAFFIC.step)
          // The clearance fades out over the last 4.5 km before the threshold, plus the roll-out and the lift-off zone.
          if (dist < 9500) continue
          expect(leg.y[s] - ridge(leg.x[s], leg.z[s]), `aircraft ${i} leg ${k} sample ${s}`).toBeGreaterThan(TRAFFIC.clearance * 0.85)
        }
      }
    }
  })

  it('chains legs: each starts where the last one ended, on airports with long runways', () => {
    const planner = new TrafficPlanner({ seed: 11, heightAt: flat })
    for (let k = 0; k < 6; k++) {
      const leg = planner.leg(3, k)
      expect(leg.dep.runway.def.length).toBeGreaterThanOrEqual(TRAFFIC.minRunway)
      expect(leg.arr.runway.def.length).toBeGreaterThanOrEqual(TRAFFIC.minRunway)
      expect(leg.to.id).not.toBe(leg.from.id)
      if (k > 0) {
        const prev = planner.leg(3, k - 1)
        expect(leg.from.id).toBe(prev.to.id)
        expect(leg.start).toBeCloseTo(prev.next, 6)
      }
    }
  })

  it('hides the aircraft between legs and shows it again for the next', () => {
    const planner = new TrafficPlanner({ seed: 12, heightAt: flat })
    const leg = planner.leg(0, 0)
    // plan time = clock + offset, so probe through the leg's own schedule via many clock times
    const seen = { visible: false, hidden: false }
    for (let t = 0; t < 2400; t += 0.5) {
      if (planner.poseAt(0, t).visible) seen.visible = true
      else seen.hidden = true
    }
    expect(leg.next).toBeGreaterThan(leg.start + leg.duration)
    expect(seen.visible).toBe(true)
    expect(seen.hidden).toBe(true)
  })

  it('survives huge times, repeated and out-of-order queries', () => {
    const planner = new TrafficPlanner({ seed: 1, heightAt: flat })
    const p = fresh()
    for (const t of [1e5, 0, 5e4, -10, 3, 1e5, 12.5]) {
      planner.poseAt(0, t, p)
      for (const n of [p.x, p.y, p.z, p.headingDeg, p.pitchDeg, p.bankDeg, p.speed]) expect(Number.isFinite(n)).toBe(true)
    }
  })

  it('starts the fleet out of step', () => {
    const planner = new TrafficPlanner({ seed: 7, heightAt: flat })
    const xs = new Set<number>()
    for (let i = 0; i < 8; i++) xs.add(Math.round(planner.poseAt(i, 0).x))
    expect(xs.size).toBeGreaterThan(4)
  })
})
