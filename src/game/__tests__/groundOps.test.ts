import { describe, expect, it } from 'vitest'
import { AIRPORTS } from '../../config/airports'
import { airportLayout, airportRunways, endsOf, headingVector, inRect, isPavedAt } from '../airportGeometry'
import { distanceToRoute, GroundOps, planTaxiRoute, routeDistance, TAXI_SPEED_LIMIT, type GroundInputs, type TaxiRoute } from '../groundOps'

const angleDiff = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180)

function place(airportId: string, runwayEnd: string) {
  return { airportId, runwayEnd }
}

const primaryEnds = AIRPORTS.flatMap((a) => endsOf(airportRunways(a)[0]).map((e) => ({ airport: a, end: e })))

describe('taxi route planning', () => {
  it.each(primaryEnds.map((p) => [p.airport.code, p.end.designator, p] as const))('%s runway %s: stand, taxiway, hold line and line-up make sense', (_code, _rw, p) => {
    const route = planTaxiRoute(place(p.airport.id, p.end.designator))
    const layout = airportLayout(p.airport)
    expect(route.end.designator).toBe(p.end.designator)
    // Parked on the apron, facing the runway side.
    expect(inRect(layout.apron, route.stand.x, route.stand.z)).toBe(true)
    // Paved all the way to the hold line.
    for (let i = 0; i <= route.holdIndex; i++) expect(isPavedAt(route.points[i].x, route.points[i].z), `point ${i}`).toBe(true)
    // The hold line is short of the runway; the line-up point is on it.
    const rect = route.end.runway.rect
    expect(inRect(rect, route.points[route.holdIndex].x, route.points[route.holdIndex].z, 0)).toBe(false)
    expect(inRect(rect, route.points[route.lineUpIndex].x, route.points[route.lineUpIndex].z, 0)).toBe(true)
    // Rolling from the centreline point to the line-up point is in the direction of the runway end.
    const a = route.points[route.lineUpIndex - 1]
    const b = route.points[route.lineUpIndex]
    const heading = ((Math.atan2(b.x - a.x, -(b.z - a.z)) * 180) / Math.PI + 360) % 360
    expect(angleDiff(heading, route.end.headingDeg)).toBeLessThan(1)
    // The line-up point is close to the threshold, not mid-runway.
    expect(Math.hypot(b.x - route.end.threshold.x, b.z - route.end.threshold.z)).toBeLessThan(140)
    // The stand is within a short taxi of the hold line.
    expect(routeDistance(route.points, route.points[0], 1, route.holdIndex)).toBeLessThan(3200)
  })

  it('stands face the taxiway: the first leg heads towards the runway', () => {
    const route = planTaxiRoute(place('harbor', '09L'))
    const v = headingVector(route.stand.headingDeg)
    const dx = route.points[1].x - route.points[0].x
    const dz = route.points[1].z - route.points[0].z
    expect((v.x * dx + v.z * dz) / Math.hypot(dx, dz)).toBeGreaterThan(0.99)
  })

  it('a chosen end on a secondary runway uses the primary runway end that points the same way', () => {
    // Central Field: runway 36 is primary; its crossing runway is 09/27.
    const route = planTaxiRoute(place('central', '09'))
    expect(route.end.runway.index).toBe(0)
  })

  it('measures distances along the route and to it', () => {
    const route = planTaxiRoute(place('central', '36'))
    const p = route.points
    expect(routeDistance(p, p[0], 1, 1)).toBeCloseTo(Math.hypot(p[1].x - p[0].x, p[1].z - p[0].z), 6)
    expect(distanceToRoute(p, { x: p[1].x, z: p[1].z })).toBeCloseTo(0, 6)
    expect(distanceToRoute(p, { x: p[1].x + 500, z: p[1].z + 500 })).toBeGreaterThan(100)
  })
})

/** A scripted pilot flying the departure. */
function pilot(route: TaxiRoute, takeoffFlaps = 1 / 3) {
  const ops = new GroundOps(route, takeoffFlaps)
  const state: GroundInputs = {
    x: route.stand.x,
    z: route.stand.z,
    headingDeg: route.stand.headingDeg,
    groundSpeed: 0,
    onGround: true,
    heightAboveGround: 0,
    engineRunning: false,
    engineStart: 0,
    parkingBrake: true,
    flaps: 0,
    time: 0,
  }
  const tick = (over: Partial<GroundInputs> = {}, seconds = 0.5) => {
    Object.assign(state, over)
    state.time += seconds
    return ops.update({ ...state })
  }
  return { ops, state, tick }
}

describe('GroundOps phases', () => {
  const route = planTaxiRoute(place('harbor', '09L'))
  const hold = route.points[route.holdIndex]

  it('starts cold and dark and says how to start', () => {
    const { ops, tick } = pilot(route)
    const v = tick()
    expect(ops.phase).toBe('coldDark')
    expect(v.atc).toContain('Press N')
    expect(v.taxi).toBeNull()
    expect(v.checklist.every((c) => !c.done || c.id === 'flaps')).toBe(true)
  })

  it('flies a whole departure: start, taxi, hold short, clearance, line up, roll, airborne', () => {
    const { ops, tick } = pilot(route)
    expect(tick({ engineStart: 0.3 }).phase).toBe('starting')
    expect(tick({ engineStart: 0, engineRunning: true }).phase).toBe('taxi')
    const v = tick({ parkingBrake: false, flaps: 1 / 3 })
    // A gate departure always uses the primary runway: asking for 09L at Harbor gives 09R.
    expect(route.end.designator).toBe('09R')
    expect(v.atc).toContain(`taxi to runway ${route.end.designator}`)
    expect(v.taxi).not.toBeNull()
    expect(v.taxi!.distanceToHold).toBeGreaterThan(100)
    expect(v.checklist.find((c) => c.id === 'engines')!.done).toBe(true)
    expect(v.checklist.find((c) => c.id === 'brake')!.done).toBe(true)
    expect(v.checklist.find((c) => c.id === 'flaps')!.done).toBe(true)

    // Taxi along the route at a legal speed, stopping at the hold line.
    for (let i = 1; i <= route.holdIndex; i++) {
      const p = route.points[i]
      tick({ x: p.x, z: p.z, groundSpeed: 5 })
    }
    expect(ops.phase).not.toBe('lineUp')
    tick({ x: hold.x, z: hold.z, groundSpeed: 0 })
    expect(ops.phase).toBe('holdShort')
    expect(ops.view.cleared).toBe(false)
    // Held for the delay, the clearance comes.
    for (let t = 0; t < 12; t++) tick({ groundSpeed: 0 })
    expect(ops.view.cleared).toBe(true)
    expect(ops.view.atc).toContain('cleared for take-off')

    // Onto the runway and lined up.
    const lu = route.points[route.lineUpIndex]
    tick({ x: lu.x, z: lu.z, headingDeg: route.end.headingDeg, groundSpeed: 2 })
    expect(ops.phase).toBe('lineUp')
    expect(tick({ groundSpeed: 20 }).phase).toBe('takeoff')
    expect(tick({ onGround: false, heightAboveGround: 25, groundSpeed: 80 }).phase).toBe('airborne')
    expect(ops.view.checklist.every((c) => c.done)).toBe(true)
  })

  it('flags speeding, leaving the taxiway and entering the runway without clearance', () => {
    const { ops, tick } = pilot(route)
    tick({ engineRunning: true, parkingBrake: false })
    expect(ops.phase).toBe('taxi')
    expect(tick({ groundSpeed: TAXI_SPEED_LIMIT + 2 }).warning).toContain('Slow down')
    expect(tick({ x: route.stand.x + 4000, z: route.stand.z + 4000, groundSpeed: 3 }).warning).toContain('Off the taxiway')
    const lu = route.points[route.lineUpIndex]
    const v = tick({ x: lu.x, z: lu.z, groundSpeed: 3 })
    expect(v.warning).toContain('incursion')
    // Not lined up, because it was not cleared.
    expect(ops.phase).toBe('taxi')
  })

  it('goes back to cold and dark when the engines are shut down on the stand', () => {
    const { ops, tick } = pilot(route)
    tick({ engineRunning: true, parkingBrake: false })
    expect(ops.phase).toBe('taxi')
    tick({ engineRunning: false, engineStart: 0, parkingBrake: true })
    expect(ops.phase).toBe('coldDark')
    expect(ops.view.taxi).toBeNull()
    // An aborted start returns to cold and dark too.
    tick({ engineStart: 0.4 })
    expect(ops.phase).toBe('starting')
    tick({ engineStart: 0 })
    expect(ops.phase).toBe('coldDark')
  })

  it('the guidance points at the next waypoint and the distance falls as the route is flown', () => {
    const { tick } = pilot(route)
    tick({ engineRunning: true, parkingBrake: false })
    const start = tick({ groundSpeed: 3 }).taxi!
    // Facing the first leg: the bearing is almost straight ahead.
    expect(Math.abs(start.bearingRelDeg)).toBeLessThan(5)
    const mid = route.points[2]
    const later = tick({ x: mid.x, z: mid.z, groundSpeed: 5 }).taxi!
    expect(later.distanceToHold).toBeLessThan(start.distanceToHold - 100)
  })
})
