/**
 * The turnaround at the stand: jet bridge, doors, refuelling and boarding.
 * Each service has real interlocks (doors only open at a docked bridge,
 * boarding only through open doors, nothing moves while the aircraft is being
 * serviced), and the aircraft cannot start or leave until the bridge is
 * retracted, the doors are closed and the trucks have gone. Pure: the session
 * advances it with the simulation clock and feeds the result to the flight
 * model as mass and centre of gravity.
 */

import type { AircraftId } from '../config/aircraftCatalog'
import { computeLoadSheet, defaultLoading, loadLimits, type LoadSheet, type Loading } from './loading'

export type BridgeState = 'retracted' | 'extending' | 'docked' | 'retracting'

export type ServiceCommand =
  | { type: 'bridge' }
  | { type: 'doors' }
  | { type: 'refuel' }
  | { type: 'passengers' }
  | { type: 'setFuel'; kg: number }
  | { type: 'setPax'; pax: number }
  | { type: 'setBalance'; aftShare: number }

/** Seconds for the bridge to extend or retract. */
export const BRIDGE_SECONDS = 14
/** Seconds to load a full tank or a full cabin. */
export const SERVICE_SECONDS = 90

export interface ServicesView {
  bridge: BridgeState
  /** 0 retracted .. 1 docked. */
  bridgeProgress: number
  doorsOpen: boolean
  refuelling: boolean
  /** Passengers moving: 'boarding' towards a higher target, 'deplaning' towards a lower one. */
  paxService: 'idle' | 'boarding' | 'deplaning'
  loading: Loading
  targetFuelKg: number
  targetPax: number
  maxFuel: number
  maxPax: number
  sheet: LoadSheet
  /** The aircraft may start its engines and leave the stand. */
  ready: boolean
  /** Why it may not, or null. */
  blocker: string | null
  /** The last refused command, e.g. "Doors stay closed without a bridge". */
  notice: string | null
}

export interface ServiceContext {
  parkingBrake: boolean
  engineRunning: boolean
  groundSpeed: number
}

export class GateServices {
  private bridge: BridgeState
  private progress: number
  private doorsOpen = false
  private refuelling = false
  private paxMoving = false
  private loading: Loading
  private targetFuel: number
  private targetPax: number
  private paxFraction = 0
  private notice: string | null = null
  private readonly limits: { maxFuel: number; maxPax: number }

  constructor(
    private readonly aircraftId: AircraftId,
    initial: Loading,
    bridge: BridgeState = 'retracted',
  ) {
    const limits = loadLimits(aircraftId)
    if (!limits) throw new Error(`${aircraftId} has no loadsheet`)
    this.limits = limits
    this.loading = { ...initial }
    this.targetFuel = initial.fuelKg
    this.targetPax = initial.pax
    this.bridge = bridge
    this.progress = bridge === 'docked' ? 1 : 0
    this.doorsOpen = bridge === 'docked'
  }

  get currentLoading(): Loading {
    return { ...this.loading }
  }

  private get ready(): boolean {
    return this.blockerText() === null
  }

  private blockerText(): string | null {
    if (this.bridge !== 'retracted') return 'retract the jet bridge'
    if (this.doorsOpen) return 'close the doors'
    if (this.refuelling) return 'finish refuelling'
    if (this.paxMoving) return 'finish boarding'
    return null
  }

  command(c: ServiceCommand, ctx: ServiceContext): void {
    this.notice = null
    const parked = ctx.parkingBrake && !ctx.engineRunning && ctx.groundSpeed < 0.3
    switch (c.type) {
      case 'bridge':
        if (this.bridge === 'retracted' || this.bridge === 'retracting') {
          if (!parked) this.notice = 'Set the parking brake and shut the engines down before the bridge moves.'
          else this.bridge = 'extending'
        } else if (this.doorsOpen) this.notice = 'Close the doors before retracting the bridge.'
        else this.bridge = 'retracting'
        break
      case 'doors':
        if (this.doorsOpen) {
          if (this.paxMoving) this.notice = 'Passengers are still moving: stop boarding first.'
          else this.doorsOpen = false
        } else if (this.bridge !== 'docked') this.notice = 'No jet bridge at the door: extend it first.'
        else this.doorsOpen = true
        break
      case 'refuel':
        if (this.refuelling) this.refuelling = false
        else if (!parked) this.notice = 'The fuel truck needs the aircraft stopped, brake set, engines off.'
        else if (this.loading.fuelKg === this.targetFuel) this.notice = 'The tanks are already at the target: change it first.'
        else this.refuelling = true
        break
      case 'passengers':
        if (this.paxMoving) this.paxMoving = false
        else if (!this.doorsOpen) this.notice = 'The doors are shut: extend the bridge and open them first.'
        else if (Math.round(this.loading.pax) === this.targetPax) this.notice = 'The cabin is already at the target: change it first.'
        else this.paxMoving = true
        break
      case 'setFuel':
        this.targetFuel = Math.max(0, Math.min(this.limits.maxFuel, c.kg))
        break
      case 'setPax':
        this.targetPax = Math.round(Math.max(0, Math.min(this.limits.maxPax, c.pax)))
        break
      case 'setBalance':
        this.loading = { ...this.loading, aftShare: Math.max(0, Math.min(1, c.aftShare)) }
        break
    }
  }

  /** Fuel burnt by the engines. */
  burnFuel(kg: number): void {
    this.loading.fuelKg = Math.max(0, this.loading.fuelKg - kg)
  }

  /** Advance the services by `dt` seconds; true when the load changed. */
  update(dt: number, ctx: ServiceContext): boolean {
    let changed = false
    if (this.bridge === 'extending') {
      this.progress = Math.min(1, this.progress + dt / BRIDGE_SECONDS)
      if (this.progress >= 1) this.bridge = 'docked'
    } else if (this.bridge === 'retracting') {
      this.progress = Math.max(0, this.progress - dt / BRIDGE_SECONDS)
      if (this.progress <= 0) this.bridge = 'retracted'
    }
    // Servicing stops if the aircraft is started or moved.
    if (this.refuelling && (ctx.engineRunning || ctx.groundSpeed > 0.5)) this.refuelling = false
    if (this.refuelling) {
      const rate = this.limits.maxFuel / SERVICE_SECONDS
      const step = Math.min(Math.abs(this.targetFuel - this.loading.fuelKg), rate * dt)
      if (step > 0) {
        this.loading.fuelKg += Math.sign(this.targetFuel - this.loading.fuelKg) * step
        changed = true
      }
      if (Math.abs(this.targetFuel - this.loading.fuelKg) < 1e-6) {
        this.loading.fuelKg = this.targetFuel
        this.refuelling = false
      }
    }
    if (this.paxMoving) {
      const rate = this.limits.maxPax / SERVICE_SECONDS
      this.paxFraction += rate * dt
      const whole = Math.floor(this.paxFraction)
      if (whole > 0) {
        this.paxFraction -= whole
        const dir = Math.sign(this.targetPax - this.loading.pax)
        const next = this.loading.pax + dir * Math.min(whole, Math.abs(this.targetPax - this.loading.pax))
        if (next !== this.loading.pax) changed = true
        this.loading.pax = next
      }
      if (this.loading.pax === this.targetPax) this.paxMoving = false
    }
    return changed
  }

  get view(): ServicesView {
    const direction = this.targetPax >= this.loading.pax ? 'boarding' : 'deplaning'
    return {
      bridge: this.bridge,
      bridgeProgress: this.progress,
      doorsOpen: this.doorsOpen,
      refuelling: this.refuelling,
      paxService: this.paxMoving ? direction : 'idle',
      loading: { ...this.loading },
      targetFuelKg: this.targetFuel,
      targetPax: this.targetPax,
      maxFuel: this.limits.maxFuel,
      maxPax: this.limits.maxPax,
      sheet: computeLoadSheet(this.aircraftId, this.loading)!,
      ready: this.ready,
      blocker: this.blockerText(),
      notice: this.notice,
    }
  }
}

/** Services for an aircraft that has a loadsheet, parked with the bridge away, doors shut and a light load. */
export function newTurnaround(aircraftId: AircraftId): GateServices | null {
  const full = defaultLoading(aircraftId)
  if (!full) return null
  // Arrives nearly empty: the player refuels and boards it.
  return new GateServices(aircraftId, { fuelKg: Math.round(full.fuelKg * 0.35), pax: 0, aftShare: 0.5 })
}
