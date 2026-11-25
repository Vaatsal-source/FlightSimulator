import { describe, expect, it } from 'vitest'
import { AIRCRAFT_IDS } from '../../../config/aircraftCatalog'
import { cockpitSpecFor } from '../cockpitSpec'
import { HeadMotion, LOOK_PITCH_MAX, LOOK_YAW_LIMIT, type HeadInput } from '../headMotion'

const base: HeadInput = { dt: 1 / 60, gForce: 1, touchdownAt: null, touchdownSink: 0, lookYaw: 0, lookPitch: 0 }

function run(h: HeadMotion, seconds: number, input: Partial<HeadInput> = {}): void {
  for (let i = 0; i < seconds * 60; i++) h.update({ ...base, ...input })
}

describe('HeadMotion', () => {
  it('stays put in 1 g', () => {
    const h = new HeadMotion()
    run(h, 2)
    expect(h.y).toBeCloseTo(0, 6)
  })

  it('sags under positive g, rises under negative g, and settles', () => {
    const h = new HeadMotion()
    run(h, 3, { gForce: 5 })
    expect(h.y).toBeLessThan(-0.03)
    run(h, 3, { gForce: -2 })
    expect(h.y).toBeGreaterThan(0.02)
  })

  it('never moves further than the sag limit', () => {
    const h = new HeadMotion()
    run(h, 3, { gForce: 50 })
    expect(h.y).toBeGreaterThanOrEqual(-0.1)
  })

  it('bumps down on a new touchdown, once, then settles', () => {
    const h = new HeadMotion()
    run(h, 0.5, { touchdownAt: 10, touchdownSink: 2 }) // first sight: ignored (could be an old one)
    expect(Math.abs(h.y)).toBeLessThan(1e-9)
    let min = 0
    for (let i = 0; i < 120; i++) {
      h.update({ ...base, touchdownAt: 20, touchdownSink: 2 })
      min = Math.min(min, h.y)
    }
    expect(min).toBeLessThan(-0.005)
    run(h, 4, { touchdownAt: 20, touchdownSink: 2 })
    expect(Math.abs(h.y)).toBeLessThan(1e-4)
  })

  it('looks where asked, within limits', () => {
    const h = new HeadMotion()
    run(h, 2, { lookYaw: 1, lookPitch: 0.4 })
    expect(h.yaw).toBeCloseTo(1, 2)
    expect(h.pitch).toBeCloseTo(0.4, 2)
    run(h, 3, { lookYaw: 99, lookPitch: 99 })
    expect(h.yaw).toBeCloseTo(LOOK_YAW_LIMIT, 2)
    expect(h.pitch).toBeCloseTo(LOOK_PITCH_MAX, 2)
  })

  it('survives a zero or huge dt and non-finite g', () => {
    const h = new HeadMotion()
    h.update({ ...base, dt: 0 })
    h.update({ ...base, dt: 5, gForce: Number.NaN })
    expect(Number.isFinite(h.y)).toBe(true)
  })
})

describe('cockpitSpecFor', () => {
  it('covers every aircraft', () => {
    for (const id of AIRCRAFT_IDS) expect(cockpitSpecFor(id)).toBeDefined()
  })
})
