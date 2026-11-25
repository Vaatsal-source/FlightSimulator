import { describe, expect, it } from 'vitest'
import { planTaxiRoute } from '../../../game/groundOps'
import { bridgePose, PARKED_SWING, RETRACTED_FRACTION } from '../bridgeGeometry'

describe('jet bridge pose', () => {
  const dir = { x: 0, z: -1 } // towards -Z (north)

  it('docked: full length, pointing at the door, sections end to end', () => {
    const p = bridgePose(dir, 24, 1)
    expect(p.length).toBeCloseTo(24, 6)
    // three.js: yaw maps +X to (cos, 0, -sin); the bridge axis +X must end up along `dir`.
    expect(Math.cos(p.yaw)).toBeCloseTo(dir.x, 6)
    expect(-Math.sin(p.yaw)).toBeCloseTo(dir.z, 6)
    expect(p.sections).toHaveLength(3)
    expect(p.sections[0].centre).toBeCloseTo(4, 6)
    expect(p.sections[2].centre).toBeCloseTo(20, 6)
    expect(p.cabAt).toBeCloseTo(24, 6)
  })

  it('retracted: shorter and swung away from the aircraft', () => {
    const p = bridgePose(dir, 24, 0)
    expect(p.length).toBeCloseTo(24 * RETRACTED_FRACTION, 6)
    expect(p.yaw).toBeCloseTo(bridgePose(dir, 24, 1).yaw + PARKED_SWING, 6)
  })

  it('extends smoothly and monotonically between the two', () => {
    let last = -1
    for (let i = 0; i <= 20; i++) {
      const len = bridgePose(dir, 24, i / 20).length
      expect(len).toBeGreaterThanOrEqual(last)
      last = len
    }
    const mid = bridgePose(dir, 24, 0.5).length
    expect(mid).toBeGreaterThan(24 * RETRACTED_FRACTION)
    expect(mid).toBeLessThan(24)
  })

  it('survives nonsense progress', () => {
    for (const v of [Number.NaN, -3, 7, Number.POSITIVE_INFINITY]) {
      const p = bridgePose(dir, 24, v)
      expect(Number.isFinite(p.length)).toBe(true)
      expect(p.length).toBeGreaterThanOrEqual(12 - 1e-9)
      expect(p.length).toBeLessThanOrEqual(24 + 1e-9)
    }
  })

  it('the stand puts the aircraft door exactly at the docked end of the bridge', () => {
    for (const [airport, rw] of [
      ['harbor', '09R'],
      ['central', '36'],
    ] as const) {
      const route = planTaxiRoute({ airportId: airport, runwayEnd: rw }, 'a320')
      const { base, dir: d, length, doorWorld } = route.bridge
      expect(Math.hypot(d.x, d.z)).toBeCloseTo(1, 6)
      expect(base.x + d.x * length).toBeCloseTo(doorWorld.x, 4)
      expect(base.z + d.z * length).toBeCloseTo(doorWorld.z, 4)
    }
  })
})
