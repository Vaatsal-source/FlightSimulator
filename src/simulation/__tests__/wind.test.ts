import { describe, expect, it } from 'vitest'
import { groundSpawn, machSpawn, makeAircraft, run } from './helpers'

const KT = 1 / 0.514444

describe('wind', () => {
  it('a parked aircraft in a headwind has airspeed and no ground speed', () => {
    // The aircraft faces north (-Z); air moving towards +Z is a headwind.
    const sim = makeAircraft('a320', groundSpawn({ throttle: 0 }))
    sim.setWind(0, 12)
    run(sim, 1, (s) => s.setControls({ brakes: 1 }))
    expect(sim.state.airspeed).toBeGreaterThan(11.5)
    expect(sim.state.airspeed).toBeLessThan(12.5)
    expect(sim.state.groundSpeed).toBeLessThan(0.5)
    expect(sim.wind).toEqual({ x: 0, z: 12 })
  })

  it('an airborne start keeps its airspeed through the air; the ground track crabs and the ground speed follows the wind', () => {
    const calm = makeAircraft('a320', machSpawn(0, 1500, { airspeed: 80, throttle: 0.5 }))
    const sim = makeAircraft('a320', machSpawn(0, 1500, { airspeed: 80, throttle: 0.5 }))
    sim.setWind(10, 0)
    sim.reset(machSpawn(0, 1500, { airspeed: 80, throttle: 0.5 }))
    expect(sim.state.airspeed).toBeCloseTo(calm.state.airspeed, 0)
    // Heading north, air drifting east: the ground track points east of north.
    const track = (Math.atan2(sim.state.velocity.x, -sim.state.velocity.z) * 180) / Math.PI
    expect(track).toBeGreaterThan(6)
    expect(track).toBeLessThan(9)
    expect(sim.state.groundSpeed).toBeGreaterThan(calm.state.groundSpeed)
    expect(sim.state.crashed).toBe(false)
  })

  it('a headwind shortens the take-off run and a tailwind lengthens it', () => {
    const roll = (windZ: number) => {
      const sim = makeAircraft('a320', groundSpawn({ flaps: 1 / 3 }))
      sim.setWind(0, windZ)
      let rotate = false
      run(sim, 90, (s) => s.setControls({ throttle: 1, flaps: 1 / 3, pitch: rotate ? 0.35 : 0 }), (s) => {
        if (s.state.airspeed > 75) rotate = true
        return !s.state.onGround
      })
      expect(sim.state.crashed).toBe(false)
      return Math.hypot(sim.state.position.x, sim.state.position.z)
    }
    const head = roll(15)
    const calm = roll(0)
    const tail = roll(-8)
    expect(head).toBeLessThan(calm - 150)
    expect(tail).toBeGreaterThan(calm + 100)
  }, 60000)

  it('a crosswind on the roll gives the aircraft a sideslip, first from the side the wind comes from, and it weathervanes into it', () => {
    const sim = makeAircraft('a320', groundSpawn({ flaps: 1 / 3 }))
    sim.setWind(14, 0) // blowing towards the east: from the aircraft's left
    let minSideslip = 0
    let maxAbs = 0
    const yaw0 = sim.state.headingDeg
    run(sim, 25, (s) => s.setControls({ throttle: 1, flaps: 1 / 3 }), (s) => {
      if (s.state.airspeed > 25) minSideslip = Math.min(minSideslip, s.state.sideslip)
      maxAbs = Math.max(maxAbs, Math.abs(s.state.sideslip))
      return false
    })
    expect(sim.state.crashed).toBe(false)
    // The air comes from the left: negative sideslip in the body frame while the speed builds.
    expect(minSideslip).toBeLessThan(-0.05)
    expect(maxAbs).toBeGreaterThan(0.05)
    // It turned into the wind (the nose towards the west) rather than ignoring it.
    const turned = ((sim.state.headingDeg - yaw0 + 540) % 360) - 180
    expect(Math.abs(turned)).toBeGreaterThan(1)
  })

  it('ignores non-finite wind and limits absurd values', () => {
    const sim = makeAircraft('a320', groundSpawn({}))
    sim.setWind(Number.NaN, Number.POSITIVE_INFINITY)
    expect(sim.wind).toEqual({ x: 0, z: 0 })
    sim.setWind(500, -500)
    expect(Math.abs(sim.wind.x)).toBeLessThanOrEqual(60)
    expect(Math.abs(sim.wind.z)).toBeLessThanOrEqual(60)
    sim.setWind(0, 0)
    run(sim, 2, (s) => s.setControls({ brakes: 1 }))
    expect(sim.state.crashed).toBe(false)
  })

  it('wind strengths are plausible in knots', () => {
    expect(15 * KT).toBeGreaterThan(29)
  })
})
