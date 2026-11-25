/**
 * Gate arrival: after landing, vacate the runway, taxi to the stand, park,
 * shut down, then connect the bridge and deplane (the turnaround services
 * take over once the aircraft is parked). Same shape as the departure's
 * GroundOps so the panel and the lights work for both.
 */

import { getAirport } from '../config/airports'
import type { AircraftId } from '../config/aircraftCatalog'
import { airportLayout, airportRunways, headingVector, inRect, toLocal } from './airportGeometry'
import { planTaxiRoute, type GroundInputs, type GroundView, type Pt, type TaxiRoute, routeDistance } from './groundOps'
import type { FlightPlace } from './spawns'

const RAD = Math.PI / 180

function headingOf(dx: number, dz: number): number {
  return ((Math.atan2(dx, -dz) / RAD) % 360 + 360) % 360
}

/**
 * The way in from the runway: off at a connector (in the middle of a long
 * runway, at the far end of a short one), along the taxiway, across the apron
 * and nose-first onto the stand. The stand and the bridge are the departure's.
 */
export function planArrivalRoute(place: FlightPlace, aircraftId: AircraftId = 'a320'): TaxiRoute {
  const dep = planTaxiRoute(place, aircraftId)
  const airport = getAirport(dep.airportId)
  const layout = airportLayout(airport)
  const primary = airportRunways(airport)[0]
  const d = headingVector(primary.def.headingDeg)
  const right = { x: -d.z, z: d.x }
  const at = (along: number, across: number): Pt => ({
    x: primary.rect.cx + d.x * along + right.x * across,
    z: primary.rect.cz + d.z * along + right.z * across,
  })
  const taxiAcross = toLocal(primary.rect, layout.taxiway.cx, layout.taxiway.cz).across
  const stand = dep.points[0]
  const standLocal = toLocal(primary.rect, stand.x, stand.z)

  // The landing end of the primary runway for the chosen place.
  const len = primary.def.length
  const w = layout.taxiway.width
  // Landing in the direction the departure end faces away from: the departure end is where take-offs START,
  // so a landing there rolls towards the opposite end.
  const rollsPositive = dep.end.headingDeg !== primary.def.headingDeg
  const farAlong = (rollsPositive ? 1 : -1) * 0.5 * (len - w)
  const exitAlong = len >= 2400 ? 0 : farAlong
  const holdAcross = primary.def.width / 2 + 38

  const entryAlong = standLocal.along + 45
  const points: Pt[] = [
    at(exitAlong, 0),
    at(exitAlong, holdAcross),
    at(exitAlong, taxiAcross),
    at(entryAlong, taxiAcross),
    at(entryAlong, standLocal.across),
    stand,
  ]
  return {
    airportId: dep.airportId,
    kind: 'arrival',
    stand: dep.stand,
    points,
    holdIndex: 2,
    lineUpIndex: points.length - 1,
    end: dep.end,
    bridge: dep.bridge,
  }
}

export type ArrivalPhase = 'final' | 'rollout' | 'vacating' | 'taxiIn' | 'parking' | 'parked'

const ORDER: readonly ArrivalPhase[] = ['final', 'rollout', 'vacating', 'taxiIn', 'parking', 'parked']
const atLeast = (p: ArrivalPhase, q: ArrivalPhase): boolean => ORDER.indexOf(p) >= ORDER.indexOf(q)

/** Stand-side limits for a good park (m, degrees, m/s). */
const PARK_RADIUS = 6
const PARK_HEADING = 12
const PARKING_RADIUS = 40
const WAYPOINT_RADIUS = 28
const TAXI_LIMIT = 8.5

export class ArrivalOps {
  private _phase: ArrivalPhase = 'final'
  private atc: string
  private warning: string | null = null
  private nextIndex = 1
  private touched = false
  private view_: GroundView

  constructor(
    private readonly route: TaxiRoute,
    private readonly hasServices: boolean,
  ) {
    const code = getAirport(route.airportId).code
    this.atc = `${code} Tower: runway ${route.end.designator.replace(/[LRC]?$/, '')}, cleared to land.`
    this.view_ = this.build(null)
  }

  get phase(): ArrivalPhase {
    return this._phase
  }

  get view(): GroundView {
    return this.view_
  }

  private code(): string {
    return getAirport(this.route.airportId).code
  }

  update(i: GroundInputs & { servicesDone?: boolean }): GroundView {
    const route = this.route
    const rect = route.end.runway.rect
    this.warning = null

    if (this._phase === 'final' && i.onGround) {
      this._phase = 'rollout'
      this.touched = true
      this.atc = `${this.code()} Tower: slow down and vacate at the green lights, then contact Ground.`
    }
    const onRunway = inRect(rect, i.x, i.z, 0)
    if (this._phase === 'rollout' && i.groundSpeed < 25) this._phase = 'vacating'
    if ((this._phase === 'vacating' || this._phase === 'rollout') && i.onGround && !onRunway && i.groundSpeed < 25) {
      this._phase = 'taxiIn'
      this.atc = `${this.code()} Ground: taxi to the gate and stop on the line, keep under 15 knots. Follow the green lights.`
    }
    if (this._phase === 'taxiIn' || this._phase === 'parking') {
      const next = route.points[Math.min(this.nextIndex, route.lineUpIndex)]
      if (Math.hypot(next.x - i.x, next.z - i.z) < WAYPOINT_RADIUS && this.nextIndex < route.lineUpIndex) this.nextIndex++
      if (i.groundSpeed > TAXI_LIMIT) this.warning = 'Slow down: taxi speed is 15 knots at most.'
      const toStand = Math.hypot(route.stand.x - i.x, route.stand.z - i.z)
      if (this._phase === 'taxiIn' && toStand < PARKING_RADIUS) {
        this._phase = 'parking'
        this.atc = `${this.code()} Ground: stop on the line. Set the parking brake (K) and shut the engines down (N).`
      }
      const headingOff = Math.abs((((i.headingDeg - route.stand.headingDeg) % 360) + 540) % 360 - 180)
      if (this._phase === 'parking') {
        if (toStand < PARK_RADIUS && headingOff < PARK_HEADING && i.groundSpeed < 0.5 && i.parkingBrake && !i.engineRunning && i.engineStart === 0) {
          this._phase = 'parked'
          this.atc = `${this.code()} Ground: parked. Extend the jet bridge, open the doors and deplane.`
        } else if (toStand < PARK_RADIUS && i.groundSpeed < 0.5 && headingOff >= PARK_HEADING) {
          this.warning = 'Not square to the stand: you can move again to straighten up.'
        }
      }
    }
    if (this._phase === 'parked' && (i.groundSpeed > 0.8 || i.engineRunning)) this._phase = 'parking'

    this.view_ = this.build(i)
    return this.view_
  }

  private build(i: (GroundInputs & { servicesDone?: boolean }) | null): GroundView {
    const route = this.route
    const phase = this._phase
    let taxi: GroundView['taxi'] = null
    if (i && (phase === 'taxiIn' || phase === 'parking' || phase === 'vacating')) {
      const target = route.points[Math.min(this.nextIndex, route.lineUpIndex)]
      taxi = {
        distanceToHold: routeDistance(route.points, { x: i.x, z: i.z }, Math.min(this.nextIndex, route.lineUpIndex), route.lineUpIndex),
        bearingRelDeg: (((headingOf(target.x - i.x, target.z - i.z) - i.headingDeg) % 360) + 540) % 360 - 180,
        nextIndex: this.nextIndex,
      }
    }
    return {
      phase,
      atc: this.atc,
      warning: this.warning,
      cleared: this.touched,
      taxi,
      services: null,
      checklist: [
        { id: 'landed', label: 'Landed', done: this.touched },
        { id: 'vacated', label: 'Runway vacated', done: atLeast(phase, 'taxiIn') },
        { id: 'taxied', label: 'Taxied to the gate', done: atLeast(phase, 'parking') },
        { id: 'parked', label: 'Parked: brake set, engines off', done: phase === 'parked' },
        ...(this.hasServices ? [{ id: 'deplaned', label: 'Passengers off, bridge retracted', done: phase === 'parked' && (i?.servicesDone ?? false) }] : []),
      ],
    }
  }
}
