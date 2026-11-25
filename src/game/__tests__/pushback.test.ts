import { describe, expect, it } from 'vitest'
import { PUSH_DISTANCE, Pushback, pushbackTarget } from '../pushback'

function run(target: number, start: number): { distance: number; heading: number; steps: number } {
  const p = new Pushback(target)
  let heading = start
  let steps = 0
  const dt = 0.1
  while (!p.done && steps < 20000) {
    const c = p.update(dt, heading)
    heading += c.yawRate * dt
    steps++
  }
  return { distance: p.distance, heading, steps }
}

describe('pushback controller', () => {
  it('pushes straight when the target is the stand heading', () => {
    const r = run(90, 90)
    expect(r.distance).toBeGreaterThanOrEqual(PUSH_DISTANCE)
    expect(r.distance).toBeLessThan(PUSH_DISTANCE + 2)
    expect(r.heading).toBeCloseTo(90, 6)
  })

  it('swings the nose to the target either way and stops there', () => {
    for (const target of [50, 130, 359, 20]) {
      const r = run(target, 90)
      const err = Math.abs((((target - r.heading) % 360) + 540) % 360 - 180)
      expect(err, `target ${target}`).toBeLessThan(3.1)
      expect(r.distance).toBeLessThan(120.1)
    }
  })

  it('stops handing out speed once done', () => {
    const p = new Pushback(90)
    while (!p.done) p.update(0.1, 90)
    expect(p.update(0.1, 90)).toEqual({ speed: 0, yawRate: 0 })
  })

  it('never exceeds the hard limit, even if the heading cannot be reached', () => {
    const p = new Pushback(10)
    let n = 0
    while (!p.done && n++ < 100000) p.update(0.1, 90) // heading never changes
    expect(p.done).toBe(true)
    expect(p.distance).toBeLessThan(121)
  })

  it('picks a leaving heading towards the taxiway, within 40 degrees of the stand heading', () => {
    // Stand heading north (0); the taxiway point is ahead and to the east (a steep bearing).
    const t = pushbackTarget(0, { x: 0, z: 0 }, { x: 100, z: -10 })
    expect(t).toBeCloseTo(40, 6)
    const straight = pushbackTarget(0, { x: 0, z: 0 }, { x: 0, z: -100 })
    expect(straight).toBeCloseTo(0, 6)
    const west = pushbackTarget(0, { x: 0, z: 0 }, { x: -20, z: -100 })
    expect(west).toBeGreaterThan(300)
    expect(west).toBeLessThan(360)
  })
})
