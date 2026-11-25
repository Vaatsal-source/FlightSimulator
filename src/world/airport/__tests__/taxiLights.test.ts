import { describe, expect, it } from 'vitest'
import { isPavedAt } from '../../../game/airportGeometry'
import { planTaxiRoute } from '../../../game/groundOps'
import { centrelineLights, SPACING, STOP_BAR_HALF_WIDTH, stopBarLights } from '../taxiLights'

describe('taxi lights', () => {
  const route = planTaxiRoute({ airportId: 'harbor', runwayEnd: '09R' })

  it('run along the route at an even spacing, from the stand to the line-up point', () => {
    const lights = centrelineLights(route)
    expect(lights.length).toBeGreaterThan(20)
    expect(Math.hypot(lights[0].x - route.points[0].x, lights[0].z - route.points[0].z)).toBeLessThan(1)
    const last = lights[lights.length - 1]
    const end = route.points[route.lineUpIndex]
    expect(Math.hypot(last.x - end.x, last.z - end.z)).toBeLessThan(SPACING + 1)
    // Neighbours are never further apart than the spacing (a corner makes them closer).
    for (let i = 1; i < lights.length; i++) {
      expect(Math.hypot(lights[i].x - lights[i - 1].x, lights[i].z - lights[i - 1].z)).toBeLessThanOrEqual(SPACING + 0.01)
    }
  })

  it('the lights up to the hold line are on paved ground', () => {
    const hold = route.points[route.holdIndex]
    const lights = centrelineLights(route)
    const toHold = lights.filter((l) => {
      // Before the hold point: nearer the stand than the hold point is, along the route.
      const idx = lights.indexOf(l)
      return idx < lights.findIndex((m) => Math.hypot(m.x - hold.x, m.z - hold.z) < SPACING)
    })
    expect(toHold.length).toBeGreaterThan(10)
    for (const l of toHold) expect(isPavedAt(l.x, l.z)).toBe(true)
  })

  it('the stop bar is a row across the connector, centred on the hold line', () => {
    const bar = stopBarLights(route)
    const hold = route.points[route.holdIndex]
    expect(bar.length).toBeGreaterThan(5)
    const cx = bar.reduce((s, p) => s + p.x, 0) / bar.length
    const cz = bar.reduce((s, p) => s + p.z, 0) / bar.length
    expect(Math.hypot(cx - hold.x, cz - hold.z)).toBeLessThan(0.5)
    const width = Math.hypot(bar[0].x - bar[bar.length - 1].x, bar[0].z - bar[bar.length - 1].z)
    expect(width).toBeCloseTo(2 * STOP_BAR_HALF_WIDTH, 0)
    // The row is square to the direction the aircraft arrives from.
    const before = route.points[route.holdIndex - 1]
    const arrive = { x: hold.x - before.x, z: hold.z - before.z }
    const across = { x: bar[bar.length - 1].x - bar[0].x, z: bar[bar.length - 1].z - bar[0].z }
    const cos = (arrive.x * across.x + arrive.z * across.z) / (Math.hypot(arrive.x, arrive.z) * Math.hypot(across.x, across.z))
    expect(Math.abs(cos)).toBeLessThan(0.01)
  })
})
