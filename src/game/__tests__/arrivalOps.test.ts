import { describe, expect, it } from 'vitest'
import { AIRPORTS } from '../../config/airports'
import { airportRunways, endsOf, inRect, isPavedAt } from '../airportGeometry'
import { ArrivalOps, planArrivalRoute } from '../arrivalOps'
import type { GroundInputs } from '../groundOps'

const primaryEnds = AIRPORTS.flatMap((a) => endsOf(airportRunways(a)[0]).map((e) => ({ airport: a, end: e })))
const angleDiff = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180)

describe('arrival route', () => {
  it.each(primaryEnds.map((p) => [p.airport.code, p.end.designator, p] as const))('%s runway %s: off the runway, along the taxiway, onto the stand', (_c, _r, p) => {
    const route = planArrivalRoute({ airportId: p.airport.id, runwayEnd: p.end.designator }, 'a320')
    expect(route.kind).toBe('arrival')
    const rect = route.end.runway.rect
    // Starts on the runway, leaves it by the connector, ends on the stand.
    expect(inRect(rect, route.points[0].x, route.points[0].z, 0)).toBe(true)
    expect(inRect(rect, route.points[1].x, route.points[1].z, 0)).toBe(false)
    const last = route.points[route.points.length - 1]
    expect(Math.hypot(last.x - route.stand.x, last.z - route.stand.z)).toBeLessThan(0.01)
    for (let i = 1; i < route.points.length; i++) expect(isPavedAt(route.points[i].x, route.points[i].z), `point ${i}`).toBe(true)
    // The last leg is flown nose-first onto the stand: its direction is the stand heading.
    const a = route.points[route.points.length - 2]
    const heading = ((Math.atan2(last.x - a.x, -(last.z - a.z)) * 180) / Math.PI + 360) % 360
    expect(angleDiff(heading, route.stand.headingDeg)).toBeLessThan(1)
    // The bridge is the departure's: same stand, same door.
    expect(route.bridge.length).toBeGreaterThan(10)
  })
})

function inputs(route: ReturnType<typeof planArrivalRoute>, over: Partial<GroundInputs> & { servicesDone?: boolean } = {}) {
  return {
    x: 0,
    z: 0,
    headingDeg: route.end.headingDeg,
    groundSpeed: 70,
    onGround: false,
    heightAboveGround: 50,
    engineRunning: true,
    engineStart: 0,
    parkingBrake: false,
    flaps: 1,
    time: 0,
    ...over,
  }
}

describe('ArrivalOps phases', () => {
  const route = planArrivalRoute({ airportId: 'harbor', runwayEnd: '09R' }, 'a320')
  const onRunway = route.points[0]
  const clear = route.points[2]
  const stand = route.stand

  it('lands, vacates, taxis in, parks and is parked only when stopped, square, brake set, engines off', () => {
    const ops = new ArrivalOps(route, true)
    expect(ops.view.atc).toContain('cleared to land')
    expect(ops.phase).toBe('final')

    ops.update(inputs(route, { x: onRunway.x, z: onRunway.z, onGround: true, heightAboveGround: 0 }))
    expect(ops.phase).toBe('rollout')
    expect(ops.view.checklist.find((c) => c.id === 'landed')!.done).toBe(true)

    ops.update(inputs(route, { x: onRunway.x, z: onRunway.z, onGround: true, heightAboveGround: 0, groundSpeed: 20 }))
    expect(ops.phase).toBe('vacating')
    expect(ops.view.taxi).not.toBeNull()

    ops.update(inputs(route, { x: clear.x, z: clear.z, onGround: true, heightAboveGround: 0, groundSpeed: 6 }))
    expect(ops.phase).toBe('taxiIn')
    expect(ops.view.atc).toContain('taxi to the gate')
    expect(ops.view.checklist.find((c) => c.id === 'vacated')!.done).toBe(true)

    // Speeding is flagged.
    expect(ops.update(inputs(route, { x: clear.x, z: clear.z, onGround: true, heightAboveGround: 0, groundSpeed: 14 })).warning).toContain('Slow down')

    // Near the stand: parking.
    const near = { x: stand.x + 20, z: stand.z }
    for (const p of route.points.slice(2)) ops.update(inputs(route, { x: p.x, z: p.z, onGround: true, heightAboveGround: 0, groundSpeed: 5, headingDeg: stand.headingDeg }))
    ops.update(inputs(route, { ...near, onGround: true, heightAboveGround: 0, groundSpeed: 3, headingDeg: stand.headingDeg }))
    expect(ops.phase).toBe('parking')

    // On the stand but still rolling, or brake off, or engines running: not parked yet.
    const base = { x: stand.x, z: stand.z, onGround: true, heightAboveGround: 0, headingDeg: stand.headingDeg }
    ops.update(inputs(route, { ...base, groundSpeed: 2, parkingBrake: true, engineRunning: false }))
    expect(ops.phase).toBe('parking')
    ops.update(inputs(route, { ...base, groundSpeed: 0, parkingBrake: false, engineRunning: false }))
    expect(ops.phase).toBe('parking')
    ops.update(inputs(route, { ...base, groundSpeed: 0, parkingBrake: true, engineRunning: true }))
    expect(ops.phase).toBe('parking')
    ops.update(inputs(route, { ...base, groundSpeed: 0, parkingBrake: true, engineRunning: false }))
    expect(ops.phase).toBe('parked')
    expect(ops.view.atc).toContain('Extend the jet bridge')

    // Moving again drops back to parking; the deplaning item follows the services.
    ops.update(inputs(route, { ...base, groundSpeed: 0, parkingBrake: true, engineRunning: false, servicesDone: true }))
    expect(ops.view.checklist.find((c) => c.id === 'deplaned')!.done).toBe(true)
    ops.update(inputs(route, { ...base, groundSpeed: 3, parkingBrake: false, engineRunning: false }))
    expect(ops.phase).toBe('parking')
  })

  it('asks to straighten up when stopped on the stand but crooked', () => {
    const ops = new ArrivalOps(route, false)
    ops.update(inputs(route, { x: onRunway.x, z: onRunway.z, onGround: true, heightAboveGround: 0 }))
    ops.update(inputs(route, { x: clear.x, z: clear.z, onGround: true, heightAboveGround: 0, groundSpeed: 5 }))
    ops.update(inputs(route, { x: stand.x, z: stand.z, onGround: true, heightAboveGround: 0, groundSpeed: 5, headingDeg: stand.headingDeg }))
    const v = ops.update(inputs(route, { x: stand.x, z: stand.z, onGround: true, heightAboveGround: 0, groundSpeed: 0, headingDeg: stand.headingDeg + 45, parkingBrake: true, engineRunning: false }))
    expect(v.warning).toContain('square')
    expect(ops.phase).toBe('parking')
    // No services for this aircraft: no deplaning item.
    expect(v.checklist.some((c) => c.id === 'deplaned')).toBe(false)
  })
})
