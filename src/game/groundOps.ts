/**
 * Ground operations for the gate departure: where the aircraft is parked, the
 * taxi route from the stand to the runway hold line and onto the runway, and
 * the phase machine (cold and dark, engine start, taxi, hold short, line up,
 * take-off) with its ATC messages and checklist. Pure: the session feeds it
 * the aircraft's state and publishes what it reports.
 */

import { getAircraft, type AircraftId } from '../config/aircraftCatalog'
import { getAirport } from '../config/airports'
import {
  airportLayout,
  airportRunways,
  endsOf,
  getRunwayEnd,
  headingVector,
  inRect,
  toLocal,
  type RunwayEnd,
} from './airportGeometry'
import type { SpawnState } from '../simulation/types'
import type { ServicesView } from './gateServices'
import type { FlightPlace } from './spawns'

export interface Pt {
  x: number
  z: number
}

export interface TaxiRoute {
  airportId: string
  /** A departure runs from the stand to the runway, an arrival from the runway to the stand. */
  kind: 'departure' | 'arrival'
  /** Where the aircraft is parked and which way it faces. */
  stand: Pt & { headingDeg: number }
  /** Stand, taxiway, connector, hold-short point, runway centreline, line-up point. */
  points: Pt[]
  /** Index in `points` of the hold-short line. */
  holdIndex: number
  /** Index of the line-up point, and the heading to hold there. */
  lineUpIndex: number
  /** The runway end the route leads to (always on the primary runway). */
  end: RunwayEnd
  /** The jet bridge at the stand: where it is rooted, which way it reaches, how far, and how high its floor is. */
  bridge: { base: Pt; dir: Pt; length: number; floorY: number; doorWorld: Pt }
}

/** Left-hand front door of each airliner, in the body frame (x right, y up, z aft; metres from the CG). */
const DOORS: Partial<Record<AircraftId, { x: number; y: number; z: number }>> = {
  a320: { x: -1.98, y: 0.2, z: -11.9 },
  a220: { x: -1.73, y: 0.1, z: -14.2 },
  a350: { x: -2.98, y: 0.4, z: -25.5 },
  global8000: { x: -1.25, y: 0.1, z: -13.2 },
}
/** Docked reach of the bridge, from the terminal pod to the door (m). */
export const BRIDGE_LENGTH = 24
/** The door sits this far inside the apron edge (m). */
const DOOR_INSET = 10

const RAD = Math.PI / 180

/** Hold-short line, from the runway edge (m). */
const HOLD_OFFSET = 38
/** Line-up point, along the runway from the threshold (m). */
const LINEUP_ALONG = 90

function headingOf(dx: number, dz: number): number {
  return ((Math.atan2(dx, -dz) / RAD) % 360 + 360) % 360
}

/** The primary-runway end a gate departure uses for the chosen place (the end heading most nearly the same). */
function departureEnd(place: FlightPlace): RunwayEnd {
  const wanted = getRunwayEnd(place.airportId, place.runwayEnd)
  const primary = airportRunways(wanted.airport)[0]
  const ends = endsOf(primary)
  const diff = (e: RunwayEnd) => Math.abs((((e.headingDeg - wanted.headingDeg) % 360) + 540) % 360 - 180)
  return diff(ends[0]) <= diff(ends[1]) ? ends[0] : ends[1]
}

/** Parking stand and the full route for a gate departure from `place`. */
export function planTaxiRoute(place: FlightPlace, aircraftId: AircraftId = 'a320'): TaxiRoute {
  const end = departureEnd(place)
  const airport = end.airport
  const layout = airportLayout(airport)
  const primary = airportRunways(airport)[0]
  const h = primary.def.headingDeg
  const d = headingVector(h)
  const right = { x: -d.z, z: d.x }
  const at = (along: number, across: number): Pt => ({
    x: primary.rect.cx + d.x * along + right.x * across,
    z: primary.rect.cz + d.z * along + right.z * across,
  })

  const taxiAcross = toLocal(primary.rect, layout.taxiway.cx, layout.taxiway.cz).across
  const apronAcross = toLocal(primary.rect, layout.apron.cx, layout.apron.cz).across
  // Parked parallel to the taxiway, nose towards -along, left door to the terminal: the door sits just inside the apron edge.
  const door = DOORS[aircraftId] ?? DOORS.a320!
  const apronFar = apronAcross + layout.apron.width / 2
  const standAcross = apronFar - DOOR_INSET - Math.abs(door.x)
  const standAlong = -0.22 * layout.apron.length
  const stand = at(standAlong, standAcross)
  const standHeading = headingOf(-d.x, -d.z)
  const doorAlong = standAlong + door.z // forward is -along, and door.z is negative
  const doorAcross = standAcross + Math.abs(door.x)
  const gearDrop = -getAircraft(aircraftId).geometry.gear.mainLeft.y

  // The connector nearest the threshold of the departure end.
  const len = primary.def.length
  const towardsEnd = end.headingDeg === h ? -1 : 1
  const connectorAlong = towardsEnd * 0.5 * (len - layout.taxiway.width)
  const holdAcross = primary.def.width / 2 + HOLD_OFFSET
  const thresholdAlong = towardsEnd * (len / 2)
  const lineUpAlong = thresholdAlong - towardsEnd * LINEUP_ALONG

  const points: Pt[] = [
    stand,
    at(standAlong - 40, standAcross),
    at(standAlong - 40, taxiAcross),
    at(connectorAlong, taxiAcross),
    at(connectorAlong, holdAcross),
    at(connectorAlong, 0),
    at(lineUpAlong, 0),
  ]
  return {
    airportId: airport.id,
    kind: 'departure',
    stand: { ...stand, headingDeg: standHeading },
    points,
    holdIndex: 4,
    lineUpIndex: 6,
    end,
    bridge: {
      base: at(doorAlong, doorAcross + BRIDGE_LENGTH),
      // From the terminal towards the aircraft: back towards the runway side.
      dir: { x: -right.x, z: -right.z },
      length: BRIDGE_LENGTH,
      floorY: gearDrop + door.y - 0.9,
      doorWorld: at(doorAlong, doorAcross),
    },
  }
}

/** The spawn for a gate departure: parked on the stand, engines off, brakes set by the session. */
export function gateStandSpawn(place: FlightPlace, aircraftId: AircraftId): SpawnState {
  const route = planTaxiRoute(place, aircraftId)
  return {
    position: { x: route.stand.x, y: getAirport(route.airportId).elevation, z: route.stand.z },
    headingDeg: route.stand.headingDeg,
    airspeed: 0,
    throttle: 0,
    flaps: 0,
    onGround: true,
    engineRunning: false,
  }
}

/** Path length from `from` along the route points up to `toIndex`. */
export function routeDistance(points: readonly Pt[], from: Pt, nextIndex: number, toIndex: number): number {
  if (nextIndex > toIndex) return 0
  let total = Math.hypot(points[nextIndex].x - from.x, points[nextIndex].z - from.z)
  for (let i = nextIndex; i < toIndex; i++) total += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].z - points[i].z)
  return total
}

function segmentDistance(a: Pt, b: Pt, p: Pt): number {
  const abx = b.x - a.x
  const abz = b.z - a.z
  const l2 = abx * abx + abz * abz
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / l2)) : 0
  return Math.hypot(p.x - (a.x + abx * t), p.z - (a.z + abz * t))
}

/** Distance from `p` to the nearest point of the polyline segment list. */
export function distanceToRoute(points: readonly Pt[], p: Pt, fromIndex = 0): number {
  let best = Infinity
  for (let i = Math.max(0, fromIndex - 1); i < points.length - 1; i++) best = Math.min(best, segmentDistance(points[i], points[i + 1], p))
  return best
}

// -------------------------------------------------------------------- phases

export type GroundPhase = 'coldDark' | 'pushback' | 'starting' | 'taxi' | 'holdShort' | 'lineUp' | 'takeoff' | 'airborne'

const PHASE_ORDER: readonly GroundPhase[] = ['coldDark', 'pushback', 'starting', 'taxi', 'holdShort', 'lineUp', 'takeoff', 'airborne']
const phaseAtLeast = (p: GroundPhase, q: GroundPhase): boolean => PHASE_ORDER.indexOf(p) >= PHASE_ORDER.indexOf(q)

export interface GroundInputs {
  x: number
  z: number
  headingDeg: number
  /** m/s over the ground. */
  groundSpeed: number
  onGround: boolean
  heightAboveGround: number
  engineRunning: boolean
  /** 0..1 during a start. */
  engineStart: number
  parkingBrake: boolean
  /** Flap lever 0..1. */
  flaps: number
  /** Seconds of simulation time. */
  time: number
  /** The turnaround at the stand, when the aircraft has one: whether it is finished, what is in the way, and whether it is loaded. */
  servicesReady?: boolean
  servicesBlocker?: string | null
  loaded?: boolean
  /** The tug is pushing the aircraft back. */
  pushing?: boolean
  /** The nearest other aircraft ahead on the taxiway, if any. */
  traffic?: { distance: number; hit: boolean } | null
  /** Another aircraft is lined up or rolling on the runway. */
  runwayBusy?: boolean
}

export interface ChecklistItem {
  id: string
  label: string
  done: boolean
}

export interface GroundView {
  phase: GroundPhase | import('./arrivalOps').ArrivalPhase
  /** The latest radio call or prompt. */
  atc: string
  /** A caution about the current taxi, or null. */
  warning: string | null
  checklist: ChecklistItem[]
  /** Guidance to the next waypoint of the route, or null before the engines run and after the line-up. */
  taxi: { distanceToHold: number; bearingRelDeg: number; nextIndex: number } | null
  /** Take-off clearance has been given. */
  cleared: boolean
  /** The turnaround at the stand (bridge, doors, fuel, passengers, loadsheet); null for aircraft without one. */
  services: ServicesView | null
}

/** Faster than this on the taxiway is flagged (m/s, about 16 kt). */
export const TAXI_SPEED_LIMIT = 8.5
/** Within this of a waypoint counts as passing it (m). */
const WAYPOINT_RADIUS = 28
/** Stopped within this of the hold line (m). */
const HOLD_RADIUS = 32
/** Seconds stopped at the hold line before the take-off clearance. */
const CLEARANCE_DELAY = 4
/** Off the route by more than this is flagged on the taxiway (m). */
const OFF_ROUTE = 30

export class GroundOps {
  private _phase: GroundPhase = 'coldDark'
  private atc: string
  private warning: string | null = null
  private cleared = false
  private nextIndex = 1
  private stoppedAt: number | null = null
  private sawEngines = false
  private view_: GroundView

  constructor(
    private readonly route: TaxiRoute,
    private readonly takeoffFlaps: number,
    private readonly hasServices = false,
  ) {
    this.atc = this.say(
      'Tower',
      hasServices
        ? 'cold and dark at the gate. Extend the bridge, refuel and board, close up, then press T for pushback and N to start the engines.'
        : 'cold and dark. Press N to start the engines, K releases the parking brake.',
    )
    this.view_ = this.build(null)
  }

  get phase(): GroundPhase {
    return this._phase
  }

  get view(): GroundView {
    return this.view_
  }

  private get code(): string {
    return getAirport(this.route.airportId).code
  }

  private say(who: 'Ground' | 'Tower', text: string): string {
    return `${this.code} ${who}: ${text}`
  }

  private runwayName(): string {
    return this.route.end.designator
  }

  update(i: GroundInputs): GroundView {
    const route = this.route
    const here: Pt = { x: i.x, z: i.z }
    const rect = route.end.runway.rect

    // Pushback: from the stand, tail-first, before the engines start.
    if (i.pushing && this._phase === 'coldDark') {
      this._phase = 'pushback'
      this.atc = this.say('Ground', 'pushback approved. The tug has the brakes: hands off the controls.')
    } else if (!i.pushing && this._phase === 'pushback') {
      this._phase = 'coldDark'
      this.atc = this.say('Ground', 'pushback complete. Set the parking brake and start engines (N).')
    }

    // Engines: cold and dark until the start begins, then the taxi once they run.
    if (this._phase === 'coldDark' && (i.engineStart > 0 || i.engineRunning)) {
      this._phase = i.engineRunning ? 'taxi' : 'starting'
      if (this._phase === 'starting') this.atc = this.say('Ground', 'engine start approved.')
    }
    if (!i.engineRunning && i.engineStart === 0 && this._phase === 'starting') this._phase = 'coldDark' // aborted
    if (i.engineRunning && !this.sawEngines) {
      this.sawEngines = true
      if (!phaseAtLeast(this._phase, 'taxi')) {
        this._phase = 'taxi'
        this.atc = this.say(
          'Ground',
          `taxi to runway ${this.runwayName()} and hold short. Release the parking brake (K), keep under 15 knots.`,
        )
      }
    }
    if (!i.engineRunning && this.sawEngines && !phaseAtLeast(this._phase, 'takeoff')) {
      // Shut down again on the ground: back to the start.
      this.sawEngines = false
      this._phase = i.engineStart > 0 ? 'starting' : 'coldDark'
      this.nextIndex = Math.max(this.nextIndex, 1)
    }

    this.warning = null
    if (this._phase === 'coldDark' && this.hasServices && i.servicesBlocker) {
      this.warning = `Turnaround not finished: ${i.servicesBlocker}.`
    }
    if (this._phase === 'taxi' || this._phase === 'holdShort') {
      // Progress follows the nearest stretch of the route, so cutting a corner does not leave the guidance behind.
      let bestSeg = -1
      let bestD = Infinity
      for (let sg = Math.max(0, this.nextIndex - 1); sg < route.holdIndex; sg++) {
        const d = segmentDistance(route.points[sg], route.points[sg + 1], here)
        if (d < bestD - 1e-6) {
          bestD = d
          bestSeg = sg
        }
      }
      if (bestSeg + 1 > this.nextIndex && bestD < 60) this.nextIndex = bestSeg + 1
      // Advance past the waypoints we have reached.
      while (this.nextIndex < route.holdIndex && Math.hypot(route.points[this.nextIndex].x - i.x, route.points[this.nextIndex].z - i.z) < WAYPOINT_RADIUS) {
        this.nextIndex++
      }
      if (this._phase === 'taxi') {
        if (i.traffic?.hit) this.warning = 'Too close to the aircraft ahead: stop and hold position.'
        else if (i.traffic && i.traffic.distance < 90 && i.groundSpeed > 3) {
          this.warning = 'Traffic ahead: slow down and keep your distance.'
        } else if (i.groundSpeed > TAXI_SPEED_LIMIT) this.warning = 'Slow down: taxi speed is 15 knots at most.'
        else if (distanceToRoute(route.points, here, this.nextIndex) > OFF_ROUTE && !inRect(rect, i.x, i.z, 20)) {
          this.warning = 'Off the taxiway: return to the green lights.'
        }
        if (inRect(rect, i.x, i.z, 0) && !this.cleared) {
          this.warning = 'Runway incursion: hold short until cleared.'
        }
        const toHold = Math.hypot(route.points[route.holdIndex].x - i.x, route.points[route.holdIndex].z - i.z)
        if (this.nextIndex >= route.holdIndex && toHold < HOLD_RADIUS && i.groundSpeed < 3) {
          this._phase = 'holdShort'
          this.stoppedAt = i.time
          this.atc = this.say('Tower', `runway ${this.runwayName()}, hold short.`)
        }
      }
      if (this._phase === 'holdShort') {
        if (i.groundSpeed < 1.5) {
          if (this.stoppedAt === null) this.stoppedAt = i.time
          if (!this.cleared && i.runwayBusy) {
            this.warning = null
            this.atc = this.say('Tower', `runway ${this.runwayName()}, hold short: traffic on the runway.`)
            this.stoppedAt = i.time
          } else if (!this.cleared && i.time - this.stoppedAt >= CLEARANCE_DELAY) {
            this.cleared = true
            this.atc = this.say('Tower', `runway ${this.runwayName()}, wind calm, cleared for take-off. Line up and go.`)
          }
        } else this.stoppedAt = null
      }
    }

    const onRunway = inRect(rect, i.x, i.z, 0)
    if (this.cleared && onRunway && (this._phase === 'holdShort' || this._phase === 'taxi')) {
      const diff = Math.abs((((i.headingDeg - route.end.headingDeg) % 360) + 540) % 360 - 180)
      if (diff < 25) {
        this._phase = 'lineUp'
        this.atc = this.say('Tower', `lined up runway ${this.runwayName()}: flaps ${this.takeoffFlaps > 0 ? 'for take-off' : 'up'}, throttle up when ready.`)
      }
    }
    if (this._phase === 'lineUp' && (i.groundSpeed > 15 || !i.onGround)) {
      this._phase = 'takeoff'
      this.atc = this.say('Tower', 'rolling. Rotate at your rotation speed.')
    }
    if (phaseAtLeast(this._phase, 'lineUp') && !i.onGround && i.heightAboveGround > 15) {
      if (this._phase !== 'airborne') this.atc = this.say('Tower', 'airborne. Contact departure, good day.')
      this._phase = 'airborne'
    }

    this.view_ = this.build(i)
    return this.view_
  }

  private build(i: GroundInputs | null): GroundView {
    const route = this.route
    const taxiing = this._phase === 'taxi' || this._phase === 'holdShort'
    let taxi: GroundView['taxi'] = null
    if (i && (taxiing || this._phase === 'lineUp') && this.sawEngines) {
      const target = route.points[Math.min(this.nextIndex, route.lineUpIndex)]
      const bearing = headingOf(target.x - i.x, target.z - i.z)
      taxi = {
        distanceToHold: routeDistance(route.points, { x: i.x, z: i.z }, Math.min(this.nextIndex, route.holdIndex), route.holdIndex),
        bearingRelDeg: (((bearing - i.headingDeg) % 360) + 540) % 360 - 180,
        nextIndex: this.nextIndex,
      }
    }
    const phase = this._phase
    return {
      phase,
      atc: this.atc,
      warning: this.warning,
      cleared: this.cleared,
      taxi,
      services: null,
      checklist: [
        ...(this.hasServices
          ? [
              { id: 'loaded', label: 'Fuel and passengers aboard', done: this.sawEngines || (i?.loaded ?? false) },
              { id: 'closed', label: 'Doors closed, bridge retracted', done: this.sawEngines || (i?.servicesReady ?? false) },
            ]
          : []),
        { id: 'engines', label: 'Engines running', done: this.sawEngines && (i?.engineRunning ?? false) },
        { id: 'brake', label: 'Parking brake released', done: this.sawEngines && i !== null && !i.parkingBrake },
        { id: 'flaps', label: 'Flaps set for take-off', done: i !== null && Math.abs(i.flaps - this.takeoffFlaps) < 0.05 },
        { id: 'taxi', label: 'Taxied to the hold-short line', done: phaseAtLeast(phase, 'holdShort') },
        { id: 'clearance', label: 'Take-off clearance received', done: this.cleared },
        { id: 'lineup', label: 'Lined up on the runway', done: phaseAtLeast(phase, 'lineUp') },
      ],
    }
  }
}
