/**
 * One flight: physics + keyboard + challenge + render/telemetry publishing.
 * Owns the fixed-timestep loop; the R3F driver calls frame() once per frame.
 * Owned by the orchestrator.
 */

import { AutopilotController } from '../autopilot/Autopilot'
import { LandingAssist } from '../autopilot/landingAssist'
import { getAircraft } from '../config/aircraftCatalog'
import { AP_MIN_HEIGHT } from '../autopilot/tuning'
import type { AutopilotTargets, TargetField } from '../autopilot/types'
import { getAircraftConfig } from '../config/aircraft'
import type { AircraftId } from '../config/aircraftCatalog'
import { GRAVITY } from '../simulation/atmosphere'
import { approachGuidance, getRunwayEnd, nearestAirport } from '../game/airportGeometry'
import { createChallenge, type Challenge } from '../game/challenges'
import { newTurnaround, type GateServices } from '../game/gateServices'
import { ArrivalOps, planArrivalRoute } from '../game/arrivalOps'
import { AIRPORTS } from '../config/airports'
import { GroundTraffic, type TrafficPose } from '../game/groundTraffic'
import { PUSH_DISTANCE, Pushback, pushbackTarget } from '../game/pushback'
import { windFor, type WindSetting, type WindState } from '../game/wind'
import { GateServices as ServicesClass } from '../game/gateServices'
import { GroundOps, planTaxiRoute, type GroundInputs, type GroundView } from '../game/groundOps'
import { computeLoadSheet, defaultLoading, fuelBurnKg, type Loading } from '../game/loading'
import { atMultiplayerStart, HOME_PLACE, spawnFor, type FlightPlace } from '../game/spawns'
import { safePitchAtHeight, techniqueFor, type Technique } from '../game/technique'
import { RING_COURSE } from '../game/courses'
import { LESSON_MODES, type FlightResult, type GameMode, type RingCourseView } from '../game/types'
import { KeyboardControls } from '../input/keyboard'
import { AircraftPhysics } from '../simulation/AircraftPhysics'
import { FixedTimestep } from '../simulation/FixedTimestep'
import { interpolatePose } from '../simulation/interpolate'
import type { AircraftRenderState, ControlInputs, FlightModel, SpawnState, TerrainSampler } from '../simulation/types'
import { clearDialed, resetAutopilot, useAutopilotStore } from '../state/autopilotStore'
import { useGroundStore } from '../state/groundStore'
import { publishTelemetry, resetTelemetry, type NavInfo } from '../state/telemetry'
import { getTerrainSampler } from '../world/terrain/terrainSampler'

const TELEMETRY_INTERVAL = 1 / 30
/** Real seconds between the flight being decided and the results screen. */
const RESULT_DELAY = { success: 1.2, failure: 2.5 } as const
const RAD2DEG = 180 / Math.PI
/** Stick input (from the keys) that takes over from the autopilot. */
const PILOT_OVERRIDE = 0.15
/** Throttle lever movement away from the autothrust's setting that disconnects it. */
const THROTTLE_OVERRIDE = 0.015
/** Change in the aircraft's state worth re-publishing to a disengaged target (SI). */
const TARGET_SYNC_EPS: Record<TargetField, number> = { speed: 0.25, headingDeg: 0.5, altitude: 1, verticalSpeed: 0.1 }

export interface FlightSessionOptions {
  mode: GameMode
  /** Ground the physics collides with; defaults to the mesh at default quality. */
  terrain?: TerrainSampler
  /** Airport and runway end for the start (and the landing target). Defaults to the home field. */
  place?: FlightPlace
  /** Aircraft type for this session (fixed for its lifetime). Default 'trainer'. */
  aircraft?: AircraftId
  /** Multiplayer: start mid-runway (further back for aircraft that need it) instead of at its end. */
  multiplayerStart?: boolean
  onFinish(result: FlightResult): void
}

export class FlightSession {
  /**
   * Stable sampler handed to the physics. It forwards to the sampler of the
   * currently drawn mesh, which setTerrain() swaps when the quality changes.
   */
  readonly terrain: TerrainSampler = {
    heightAt: (x, z) => this.terrainTarget.heightAt(x, z),
    surfaceAt: (x, z) => this.terrainTarget.surfaceAt(x, z),
  }
  private terrainTarget: TerrainSampler
  readonly physics: FlightModel
  readonly keyboard = new KeyboardControls()
  /** Stable object handed to the ring renderer; the ring challenge mutates nextIndex. */
  readonly ringView: RingCourseView = { rings: RING_COURSE, nextIndex: 0 }
  readonly renderState: AircraftRenderState

  private readonly timestep: FixedTimestep
  private readonly onFinish: (result: FlightResult) => void
  readonly aircraftId: AircraftId
  private multiplayerStart: boolean
  /**
   * The F-22 manoeuvres routinely past the angle where its stall flags trip,
   * so it gets no stall warning or horn (its flight controls protect it).
   */
  readonly stallAlerts: boolean
  private readonly technique: Technique
  /** Flare assist stick per m/s of sink beyond the allowance. */
  private readonly flareAssistGain: number
  private assistsSetting = true
  private landed = false
  private flared = false
  private lastTouchdown: { sink: number; simTime: number } | null = null
  /** A lesson's approach phase (approach autothrust and flare assist), as of the last step. */
  private approachPhase = false
  private autothrustIntegral = 0
  private autothrustBase = 0.4
  private readonly autopilot: AutopilotController
  private readonly landingAssist: LandingAssist
  /** Landing-assist key presses already handled, and the throttle the assist last set. */
  private assistRequestsSeen = 0
  private assistThrottle = 0
  private apActive = false
  private athrActive = false
  private athrThrottle = 0
  private apDisconnectCount = 0
  /** Gate departure: the ground-operations state machine, null in other modes. */
  private groundOps: { update(i: GroundInputs & { servicesDone?: boolean }): GroundView; readonly view: GroundView } | null = null
  private parkingBrake = false
  /** The turnaround at the stand (gate departure), and otherwise the plain load the aircraft flies with. */
  private services: GateServices | null = null
  private loading: Loading | null = null
  /** The tug at work (gate departure), and the route it leaves towards. */
  private pushback: Pushback | null = null
  private gateRoute: import('../game/groundOps').TaxiRoute | null = null
  private pushTogglesSeen = 0
  private traffic: GroundTraffic | null = null
  private readonly trafficScratch: TrafficPose = { visible: false, x: 0, z: 0, headingDeg: 0, lift: 0, pitchDeg: 0, speed: 0, model: 0, waiting: false, onRunway: false }
  private windSetting: WindSetting = 'calm'
  private windNow: WindState = { x: 0, z: 0, speed: 0, fromDeg: 0 }
  private burnAccum = 0
  private outOfFuel = false
  private loadDirty = false
  private engineTogglesSeen = 0
  private parkingTogglesSeen = 0
  private mode: GameMode
  private place: FlightPlace
  private challenge: Challenge
  private telemetryClock = 0
  private resultDelay: number | null = null
  private reported = false

  constructor(options: FlightSessionOptions) {
    this.terrainTarget = options.terrain ?? getTerrainSampler()
    this.mode = options.mode
    this.place = options.place ?? HOME_PLACE
    this.aircraftId = options.aircraft ?? 'trainer'
    this.multiplayerStart = options.multiplayerStart ?? false
    this.stallAlerts = this.aircraftId !== 'f22'
    this.technique = techniqueFor(this.aircraftId)
    // A direct-law stick moves the elevator, a fly-by-wire stick asks for load factor (about
    // 1 g extra at full stick with the gear down): enough to arrest the excess sink in ~1.5 s.
    this.flareAssistGain = getAircraftConfig(this.aircraftId).fbw ? 1 / (GRAVITY * 1.5) : 0.6
    this.onFinish = options.onFinish
    this.autopilot = new AutopilotController(this.aircraftId)
    this.landingAssist = new LandingAssist(this.aircraftId)
    this.physics = new AircraftPhysics({
      terrain: this.terrain,
      spawn: this.spawnAt(this.mode, this.place),
      aircraft: this.aircraftId,
    })
    this.timestep = new FixedTimestep({ dt: this.physics.fixedDt })
    this.challenge = createChallenge(this.mode, this.ringView, this.place, this.aircraftId)
    const s = this.physics.state
    this.renderState = {
      position: { ...s.position },
      orientation: { ...s.orientation },
      velocity: { ...s.velocity },
      surfaces: { ...s.surfaces },
      engineRpm: s.engine.rpm,
      aircraftId: this.aircraftId,
      n1: s.engine.n1,
      afterburner: s.engine.afterburner,
      gearPosition: s.gearPosition,
      speedbrakePosition: s.speedbrakePosition,
      thrustVector: s.thrustVector,
      airspeed: s.airspeed,
      onGround: s.onGround,
      crashed: s.crashed,
      frozen: false,
      teleportId: 0,
    }
    this.syncKeyboard()
  }

  get currentMode(): GameMode {
    return this.mode
  }

  /** Multiplayer: whether the next reset() uses the multiplayer start. */
  setMultiplayerStart(on: boolean): void {
    this.multiplayerStart = on
  }

  /** The spawn for `mode` at `place`, moved to the multiplayer start when online. */
  private spawnAt(mode: GameMode, place: FlightPlace): SpawnState {
    const spawn = spawnFor(mode, place, this.aircraftId)
    return this.multiplayerStart ? atMultiplayerStart(spawn, place, this.aircraftId) : spawn
  }

  /** Collide with the mesh that is actually drawn (call when the quality changes). */
  setTerrain(terrain: TerrainSampler): void {
    this.terrainTarget = terrain
  }

  /** The wind strength; takes effect immediately (its direction follows the airport). */
  setWindSetting(setting: WindSetting): void {
    this.windSetting = setting
    this.applyWind(this.physics.state.simTime)
  }

  /** Feed the wind at `timeS` to the physics. */
  private applyWind(timeS: number): void {
    const airport = AIRPORTS.find((a) => a.id === this.place.airportId) ?? AIRPORTS[0]
    this.windNow = windFor(this.windSetting, airport.id, airport.runways[0].headingDeg, timeS)
    this.physics.setWind(this.windNow.x, this.windNow.z)
  }

  /** Back to the spawn of `mode` at `place` with no leftover state. */
  reset(mode: GameMode = this.mode, place: FlightPlace = this.place): void {
    this.mode = mode
    this.place = place
    // Wind first, so an airborne spawn keeps its airspeed.
    this.applyWind(0)
    this.physics.reset(this.spawnAt(mode, place))
    this.timestep.reset()
    this.challenge = createChallenge(mode, this.ringView, place, this.aircraftId)
    this.syncKeyboard()
    this.telemetryClock = 0
    this.resultDelay = null
    this.reported = false
    this.landed = false
    this.flared = false
    this.lastTouchdown = null
    this.approachPhase = false
    this.autothrustIntegral = 0
    this.autothrustBase = this.physics.state.controls.throttle
    this.autopilot.reset()
    this.apActive = false
    this.athrActive = false
    this.landingAssist.cancel()
    resetAutopilot()
    this.assistRequestsSeen = useAutopilotStore.getState().assistRequests
    this.engineTogglesSeen = this.keyboard.engineToggles
    this.parkingTogglesSeen = this.keyboard.parkingBrakeToggles
    this.pushTogglesSeen = this.keyboard.pushbackToggles
    this.pushback = null
    this.gateRoute = null
    this.traffic = null
    if (mode === 'gate') {
      const route = planTaxiRoute(place, this.aircraftId)
      this.gateRoute = route
      this.traffic = new GroundTraffic(route)
      this.services = newTurnaround(this.aircraftId)
      this.groundOps = new GroundOps(route, getAircraft(this.aircraftId).takeoffFlaps, this.services !== null)
      this.parkingBrake = true
      useGroundStore.getState().setRoute(route)
    } else if (mode === 'arrival') {
      const route = planArrivalRoute(place, this.aircraftId)
      const full = defaultLoading(this.aircraftId)
      // Arrives loaded; the passengers come off at the gate.
      this.services = full ? new ServicesClass(this.aircraftId, full) : null
      this.groundOps = new ArrivalOps(route, this.services !== null)
      this.parkingBrake = false
      useGroundStore.getState().setRoute(route)
    } else {
      this.services = null
      this.groundOps = null
      this.parkingBrake = false
      useGroundStore.getState().setRoute(null)
    }
    this.loading = this.services ? null : defaultLoading(this.aircraftId)
    this.burnAccum = 0
    this.outOfFuel = false
    this.applyLoad()
    this.renderState.teleportId++
    this.syncRenderState(1)
    this.publish()
  }

  /** Called once per rendered frame. While frozen (paused, results) nothing advances. */
  frame(frameDt: number, frozen: boolean): void {
    this.renderState.frozen = frozen
    if (frozen) return
    const alpha = this.timestep.advance(frameDt, this.stepOnce)
    this.syncRenderState(alpha)

    this.telemetryClock += frameDt
    if (this.telemetryClock >= TELEMETRY_INTERVAL) {
      this.telemetryClock %= TELEMETRY_INTERVAL
      this.publish()
    }

    const result = this.challenge.result
    if (result && !this.reported) {
      this.resultDelay ??= RESULT_DELAY[result.outcome]
      this.resultDelay -= frameDt
      if (this.resultDelay <= 0) {
        this.reported = true
        this.publish()
        this.onFinish(result)
      }
    }
  }

  dispose(): void {
    this.keyboard.releaseAll()
    useGroundStore.getState().setRoute(null)
    resetTelemetry()
    resetAutopilot()
  }

  /** Autopilot disconnections so far (each one sounds the disconnect warning). */
  get apDisconnects(): number {
    return this.apDisconnectCount
  }

  /** Completed lesson steps so far (0 outside Flight School). */
  get lessonStep(): number {
    return this.challenge.lessonView?.stepCounter ?? 0
  }

  /** Flight assists from settings; lessons always have them. */
  setAssists(on: boolean): void {
    this.assistsSetting = on
  }

  private get assistsActive(): boolean {
    return this.assistsSetting || LESSON_MODES.includes(this.mode)
  }

  /**
   * Tail-strike guard: on the ground and in the first metres of climb, ease
   * the stick back toward neutral as the predicted pitch (half a second
   * ahead) nears the safe pitch for the current wheel height, and push the
   * nose down past it. The tail clears more with every metre of climb.
   */
  private applyTailStrikeGuard(controls: ControlInputs): void {
    const s = this.physics.state
    const h = s.onGround ? 0 : s.heightAboveGround
    if (h > 12) return
    // Judge clearance at the wheel height expected 0.6 s from now (descending closes it).
    const limit = safePitchAtHeight(this.technique, h + Math.min(0, s.verticalSpeed) * 0.6)
    const predicted = s.pitchDeg + s.angularVelocity.x * RAD2DEG * 0.5
    const allowed = (limit - predicted) * 0.35
    if (controls.pitch > allowed) controls.pitch = Math.max(-1, allowed)
  }

  /**
   * Lesson approach flare assist: near the runway, add a little nose-up when
   * sinking faster than 2 m/s, and ignore back pressure once the descent has
   * stopped so the aircraft cannot balloon and drop in. The pilot still flies
   * the flare; this only trims the extremes.
   */
  private applyFlareAssist(controls: ControlInputs): void {
    const s = this.physics.state
    const h = s.heightAboveGround
    if (!this.approachPhase) return
    // On the runway the aircraft's derotation law lowers the nose (AircraftPhysics).
    if (s.onGround) return
    if (h > this.technique.flareHeight) return
    // Sink rate allowed for this height: about 2.4 m/s at the flare height, 0.8 m/s at the runway.
    const allowed = -(0.8 + (1.6 * h) / this.technique.flareHeight)
    if (s.verticalSpeed > -0.3) controls.pitch = Math.min(controls.pitch, 0)
    else if (s.verticalSpeed < allowed) {
      controls.pitch = Math.max(controls.pitch, Math.min(1, (allowed - s.verticalSpeed) * this.flareAssistGain))
    }
  }

  /**
   * Lesson approach autothrust: hold the approach speed with the throttle
   * (as airliners do on final), then close it at flare height. The keyboard
   * lever follows, so the pilot takes over seamlessly on the ground.
   */
  private applyApproachAutothrust(controls: ControlInputs, dt: number): void {
    const s = this.physics.state
    if (!this.approachPhase || s.onGround || this.landed) {
      if (s.onGround) this.landed = true
      return
    }
    const t = this.technique
    if (this.flared || s.heightAboveGround < t.flareHeight) {
      // Once the flare starts the throttle stays closed, even if the aircraft floats back up.
      this.flared = true
      controls.throttle = 0
    } else {
      const error = t.approachSpeed - s.airspeed
      this.autothrustIntegral = Math.max(-0.5, Math.min(0.5, this.autothrustIntegral + error * dt * 0.01))
      controls.throttle = Math.max(0, Math.min(1, this.autothrustBase + error * 0.08 + this.autothrustIntegral))
    }
    this.keyboard.setThrottle(controls.throttle)
  }

  /**
   * Autopilot and autothrust from the panel selections. Engaging is refused on
   * (or just above) the ground; the stick keys, the throttle keys, a stall or
   * touching down disconnect them, with the reason shown on the panel.
   */
  private applyAutopilot(controls: ControlInputs, dt: number): void {
    const store = useAutopilotStore.getState()
    const s = this.physics.state
    let ap = store.ap
    let athr = store.athr
    let message = store.message
    if (ap && !this.apActive && (s.onGround || s.heightAboveGround < AP_MIN_HEIGHT)) {
      ap = false
      message = 'AP needs 100 ft above the ground'
    }
    if (athr && !this.athrActive && s.onGround) {
      athr = false
      message = 'A/THR is not available on the ground'
    }
    if (ap && this.apActive) {
      const reason =
        Math.abs(controls.pitch) > PILOT_OVERRIDE || Math.abs(controls.roll) > PILOT_OVERRIDE
          ? 'pilot input'
          : s.onGround || s.crashed
            ? 'on the ground'
            : s.stalled
              ? 'stall'
              : null
      if (reason) {
        ap = false
        message = `AP OFF: ${reason}`
      }
    }
    if (athr && this.athrActive) {
      if (Math.abs(controls.throttle - this.athrThrottle) > THROTTLE_OVERRIDE) {
        athr = false
        message = 'A/THR OFF: throttle moved'
      } else if (s.onGround || s.crashed) {
        athr = false
        message = 'A/THR OFF: on the ground'
      }
    }
    if (ap !== store.ap || athr !== store.athr || message !== store.message) {
      useAutopilotStore.setState({ ap, athr, message })
    }
    if (this.apActive && !ap) {
      this.apDisconnectCount++
      clearDialed(['headingDeg', 'altitude', 'verticalSpeed'])
      // Let go trimmed: the stick the autopilot was holding (last applied) moves into the trim.
      this.handOverTrimmed(s.controls.pitch, s.controls.trim)
    }
    if (this.athrActive && !athr) clearDialed(['speed'])
    this.apActive = ap
    this.athrActive = athr

    const out = this.autopilot.apply(s, { ap, athr, vertical: store.vertical, targets: store.targets }, controls, dt)
    if (ap && (out.vertical !== store.vertical || out.annunciation !== store.annunciation)) {
      useAutopilotStore.setState({ vertical: out.vertical, annunciation: out.annunciation })
    }
    if (athr) {
      this.keyboard.setThrottle(controls.throttle)
      this.athrThrottle = controls.throttle
    }
  }

  /**
   * Hand over trimmed when an automatic system lets go of the stick: on the
   * trainer the stick it held moves into the trim lever, so the elevator stays
   * put; a fly-by-wire jet holds its path and bank by itself with the stick neutral.
   */
  private handOverTrimmed(stick: number, trim: number): void {
    const cfg = getAircraftConfig(this.aircraftId)
    if (cfg.fbw) return
    this.keyboard.setTrim(trim + (stick * cfg.surfaces.elevatorMax) / cfg.surfaces.trimRange)
  }

  /**
   * Disengaged holds keep their target on what the aircraft is doing, so
   * engaging holds the current speed, heading and altitude. A target the
   * pilot has dialled stays put.
   */
  private syncAutopilotTargets(): void {
    const store = useAutopilotStore.getState()
    const s = this.physics.state
    const current: AutopilotTargets = {
      speed: s.airspeed,
      headingDeg: s.headingDeg,
      altitude: s.altitude,
      verticalSpeed: s.verticalSpeed,
    }
    const following: Record<TargetField, boolean> = {
      speed: !store.athr,
      headingDeg: !store.ap,
      altitude: !store.ap,
      verticalSpeed: !store.ap || store.vertical !== 'VS',
    }
    let next: AutopilotTargets | null = null
    for (const field of Object.keys(current) as TargetField[]) {
      if (!following[field] || store.dialed[field]) continue
      if (Math.abs(current[field] - store.targets[field]) < TARGET_SYNC_EPS[field]) continue
      next ??= { ...store.targets }
      next[field] = current[field]
    }
    if (next) useAutopilotStore.setState({ targets: next })
  }

  /** A press of the landing-assist key: engage it on the runway ahead, or cancel it. */
  private handleAssistRequest(): void {
    const store = useAutopilotStore.getState()
    if (store.assistRequests === this.assistRequestsSeen) return
    this.assistRequestsSeen = store.assistRequests
    if (this.landingAssist.active) {
      this.stopAssist('Landing assist off')
      return
    }
    const s = this.physics.state
    // The runway the pilot chose wins whenever it is the one ahead.
    const refusal = this.landingAssist.engage(s, getRunwayEnd(this.place.airportId, this.place.runwayEnd))
    if (refusal) {
      useAutopilotStore.setState({ message: refusal })
      return
    }
    // The assist flies the stick and throttle itself; the autopilot and autothrust drop out.
    useAutopilotStore.setState({ ap: false, athr: false, message: null, assist: this.landingAssist.view })
    this.apActive = false
    this.athrActive = false
    this.assistThrottle = s.controls.throttle
    // Landing configuration: gear down and landing flaps, left set when it hands over.
    this.keyboard.setGear(1)
    this.keyboard.setFlaps(getAircraft(this.aircraftId).landingFlaps)
  }

  /**
   * Let go of the controls: the stick the assist last held (by default, the
   * one applied on the previous step) moves into the trim, and the speed brake
   * switch is left in.
   */
  private stopAssist(message: string, held: { pitch: number; trim: number } = this.physics.state.controls): void {
    this.handOverTrimmed(held.pitch, held.trim)
    this.keyboard.setSpeedbrake(0)
    this.landingAssist.cancel()
    this.apDisconnectCount++
    useAutopilotStore.setState({ assist: null, message })
  }

  /**
   * Landing assist: lines up with the runway and the glide path, then lets go
   * with the aircraft trimmed and the levers where it left them. The stick or
   * throttle keys, or touching the ground, cancel it.
   */
  private applyLandingAssist(controls: ControlInputs, dt: number): void {
    const s = this.physics.state
    if (Math.abs(controls.pitch) > PILOT_OVERRIDE || Math.abs(controls.roll) > PILOT_OVERRIDE) {
      this.stopAssist('Landing assist off: pilot input')
      return
    }
    if (Math.abs(controls.throttle - this.assistThrottle) > THROTTLE_OVERRIDE) {
      this.stopAssist('Landing assist off: throttle moved')
      return
    }
    if (s.onGround || s.crashed) {
      this.stopAssist('Landing assist off: on the ground')
      return
    }
    const runway = this.landingAssist.view?.runway ?? ''
    // Keep asking for the landing configuration: gear and flaps refused while too fast come
    // out once the speed is down (the keyboard levers follow what the aircraft accepted).
    controls.gear = 1
    controls.flaps = getAircraft(this.aircraftId).landingFlaps
    this.keyboard.setGear(1)
    this.keyboard.setFlaps(controls.flaps)
    const event = this.landingAssist.update(s, controls, dt)
    this.keyboard.setThrottle(controls.throttle)
    this.assistThrottle = controls.throttle
    if (event === 'goAround') {
      useAutopilotStore.setState({ message: 'Unstable approach: going around' })
    } else if (event === 'stable') {
      this.stopAssist(`Stable at 100 ft on ${runway}: flare and land, you have control`, controls)
    } else if (event === 'goAroundDone') {
      this.stopAssist('Go-around complete: you have control. Press 0 to try again', controls)
    }
  }

  private readonly stepOnce = (dt: number): void => {
    const controls = this.keyboard.update(dt)
    this.handleGroundKeys()
    this.runServices(dt)
    if (this.parkingBrake) controls.brakes = 1
    this.handleAssistRequest()
    if (this.landingAssist.active) this.applyLandingAssist(controls, dt)
    else this.applyAutopilot(controls, dt)
    const approach = this.challenge.approachAssists === true
    if (approach && !this.approachPhase) {
      // Entering the approach (from the start of a landing lesson, or after a circuit's
      // final turn): the approach autothrust starts from the throttle the pilot has set.
      this.landed = false
      this.flared = false
      this.autothrustIntegral = 0
      this.autothrustBase = this.physics.state.controls.throttle
    }
    this.approachPhase = approach
    this.applyFlareAssist(controls)
    // The tail-strike guard has the final say over pitch.
    if (this.assistsActive) this.applyTailStrikeGuard(controls)
    // The landing assist runs its own autothrust; the lesson's would fight it.
    if (!this.landingAssist.active) this.applyApproachAutothrust(controls, dt)
    if (this.pushback) {
      const cmd = this.pushback.update(dt, this.physics.state.headingDeg)
      this.physics.setTug(cmd.speed, cmd.yawRate)
      controls.brakes = 0
      controls.throttle = 0
      if (this.pushback.done) this.endPushback()
    }
    this.physics.setControls(controls)
    this.applyWind(this.physics.state.simTime)
    this.physics.step()
    const prev = this.physics.previousState
    if (this.physics.state.onGround && !prev.onGround) {
      this.lastTouchdown = { sink: Math.max(0, -prev.verticalSpeed), simTime: this.physics.state.simTime }
    }
    this.keyboard.syncGear(this.physics.state.controls.gear)
    this.challenge.update(this.physics.state, dt)
  }

  /** N starts or stops the engines (a shutdown only when stopped on the ground), K toggles the parking brake. */
  private handleGroundKeys(): void {
    const kb = this.keyboard
    if (kb.engineToggles !== this.engineTogglesSeen) {
      this.engineTogglesSeen = kb.engineToggles
      const s = this.physics.state
      const blocked = this.services !== null && !this.services.view.ready
      if (this.physics.engineStartProgress > 0) this.physics.stopEngines()
      else if (!s.engine.running) {
        // No fuel, no start; and not with the bridge attached or the doors open.
        if (!blocked && !this.outOfFuel && this.pushback === null) this.physics.startEngines()
      } else if (s.onGround && s.groundSpeed < 3) this.physics.stopEngines()
    }
    if (kb.pushbackToggles !== this.pushTogglesSeen) {
      this.pushTogglesSeen = kb.pushbackToggles
      if (this.pushback) this.endPushback()
      else this.beginPushback()
    }
    if (kb.parkingBrakeToggles !== this.parkingTogglesSeen) {
      this.parkingTogglesSeen = kb.parkingBrakeToggles
      // The brake stays on until the turnaround is finished.
      if (!(this.parkingBrake && this.services !== null && !this.services.view.ready)) this.parkingBrake = !this.parkingBrake
    }
  }

  /** The tug starts: only from the stand with the turnaround finished and the engines off. */
  private beginPushback(): void {
    const s = this.physics.state
    const route = this.gateRoute
    if (!route || this.groundOps?.view.phase !== 'coldDark' || s.engine.running || this.physics.engineStartProgress > 0) return
    if (this.services !== null && !this.services.view.ready) return
    const h = (s.headingDeg * Math.PI) / 180
    const from = { x: s.position.x - Math.sin(h) * PUSH_DISTANCE, z: s.position.z + Math.cos(h) * PUSH_DISTANCE }
    this.pushback = new Pushback(pushbackTarget(s.headingDeg, from, route.points[2]))
    this.parkingBrake = false
  }

  private endPushback(): void {
    this.pushback = null
    this.physics.setTug(0)
    this.parkingBrake = true
  }

  /** The turnaround's clock and commands, and the fuel the engines burn. */
  private runServices(dt: number): void {
    const s = this.physics.state
    if (this.services) {
      const ctx = { parkingBrake: this.parkingBrake, engineRunning: s.engine.running, groundSpeed: s.groundSpeed }
      for (const cmd of useGroundStore.getState().drain()) this.services.command(cmd, ctx)
      if (this.services.update(dt, ctx)) this.loadDirty = true
      if (!this.services.view.ready) this.parkingBrake = true
    }
    if (s.engine.running) {
      this.burnAccum += fuelBurnKg(s.engine.thrust, dt)
      if (this.burnAccum >= 1) {
        this.burnFuel(this.burnAccum)
        this.burnAccum = 0
      }
    }
  }

  private burnFuel(kg: number): void {
    if (this.services) this.services.burnFuel(kg)
    else if (this.loading) this.loading = { ...this.loading, fuelKg: Math.max(0, this.loading.fuelKg - kg) }
    else return
    this.loadDirty = true
    const left = this.services ? this.services.currentLoading.fuelKg : (this.loading?.fuelKg ?? 1)
    if (left <= 0 && !this.outOfFuel) {
      this.outOfFuel = true
      this.physics.stopEngines()
    }
  }

  /** Mass and CG of the current load into the flight model. */
  private applyLoad(): void {
    const l = this.services ? this.services.currentLoading : this.loading
    if (!l) return
    const sheet = computeLoadSheet(this.aircraftId, l)
    if (sheet) this.physics.setLoad({ massKg: sheet.massKg, cgShiftM: sheet.cgShiftM })
    this.loadDirty = false
  }

  private syncKeyboard(): void {
    const c = this.physics.state.controls
    this.keyboard.reset({ throttle: c.throttle, flaps: c.flaps, trim: c.trim, gear: c.gear, speedbrake: c.speedbrake })
  }

  private syncRenderState(alpha: number): void {
    const s = this.physics.state
    const r = this.renderState
    // A crashed aircraft no longer steps, so interpolating would jitter.
    interpolatePose(this.physics.previousState, s, s.crashed ? 1 : alpha, r)
    r.velocity.x = s.velocity.x
    r.velocity.y = s.velocity.y
    r.velocity.z = s.velocity.z
    r.surfaces.elevator = s.surfaces.elevator
    r.surfaces.aileron = s.surfaces.aileron
    r.surfaces.rudder = s.surfaces.rudder
    r.surfaces.flaps = s.surfaces.flaps
    r.engineRpm = s.engine.rpm
    r.n1 = s.engine.n1
    r.afterburner = s.engine.afterburner
    r.gearPosition = s.gearPosition
    r.speedbrakePosition = s.speedbrakePosition
    r.thrustVector = s.thrustVector
    r.airspeed = s.airspeed
    r.onGround = s.onGround
    r.crashed = s.crashed
  }

  private publish(): void {
    const s = this.physics.state
    if (this.loadDirty) this.applyLoad()
    this.syncAutopilotTargets()
    if (this.landingAssist.active) useAutopilotStore.setState({ assist: this.landingAssist.view })
    publishTelemetry({
      airspeed: s.airspeed,
      groundSpeed: s.groundSpeed,
      altitude: s.altitude,
      heightAboveGround: s.heightAboveGround,
      verticalSpeed: s.verticalSpeed,
      headingDeg: s.headingDeg,
      pitchDeg: s.pitchDeg,
      bankDeg: s.bankDeg,
      angleOfAttackDeg: s.angleOfAttack * RAD2DEG,
      sideslipDeg: s.sideslip * RAD2DEG,
      gForce: s.gForce,
      throttle: s.controls.throttle,
      rpm: s.engine.rpm,
      engineRunning: s.engine.running,
      flaps: s.controls.flaps,
      flapsDeg: s.surfaces.flaps * RAD2DEG,
      brakes: s.controls.brakes,
      trim: s.controls.trim,
      stick: { pitch: s.controls.pitch, roll: s.controls.roll, yaw: s.controls.yaw },
      stallWarning: this.stallAlerts && s.stallWarning,
      stalled: this.stallAlerts && s.stalled,
      onGround: s.onGround,
      crashed: s.crashed,
      crashReason: s.crashReason,
      simTime: s.simTime,
      position: { ...s.position },
      challenge: this.challenge.progress,
      nav: this.navInfo(),
      aircraftId: this.aircraftId,
      mach: s.mach,
      n1: s.engine.n1,
      afterburner: s.engine.afterburner,
      gearPosition: s.gearPosition,
      gearLever: s.controls.gear,
      speedbrake: s.speedbrakePosition,
      reverse: s.controls.reverse,
      lesson: this.challenge.lessonView ?? null,
      touchdown: this.lastTouchdown,
      engineStart: this.physics.engineStartProgress,
      parkingBrake: this.parkingBrake,
      loading: this.loadingView(),
      wind: { fromDeg: this.windNow.fromDeg, speed: this.windNow.speed },
      ground: this.groundOps
        ? this.withServices(this.groundOps.update({
            x: s.position.x,
            z: s.position.z,
            headingDeg: s.headingDeg,
            groundSpeed: s.groundSpeed,
            onGround: s.onGround,
            heightAboveGround: s.heightAboveGround,
            engineRunning: s.engine.running,
            engineStart: this.physics.engineStartProgress,
            parkingBrake: this.parkingBrake,
            flaps: s.controls.flaps,
            time: s.simTime,
            servicesReady: this.services?.view.ready,
            servicesBlocker: this.services?.view.blocker,
            pushing: this.pushback !== null,
            traffic: this.traffic ? this.traffic.nearestAhead(s.simTime, s.position, s.headingDeg, this.trafficScratch) : null,
            runwayBusy: this.traffic ? this.traffic.runwayBusy(s.simTime, this.trafficScratch) : false,
            loaded: this.services ? this.services.view.loading.pax > 0 && this.services.view.loading.fuelKg >= 1500 : undefined,
            servicesDone: this.services ? this.services.view.ready && this.services.view.loading.pax === 0 : undefined,
          }))
        : null,
    })
  }

  private withServices(view: import('../game/groundOps').GroundView): import('../game/groundOps').GroundView {
    return { ...view, services: this.services ? this.services.view : null }
  }

  private loadingView(): import('../state/telemetry').LoadingView | null {
    const l = this.services ? this.services.currentLoading : this.loading
    if (!l) return null
    const sheet = computeLoadSheet(this.aircraftId, l)
    if (!sheet) return null
    return {
      massKg: sheet.massKg,
      fuelKg: sheet.fuelKg,
      pax: sheet.pax,
      cgPct: sheet.cgPct,
      cgInLimits: sheet.cgInLimits,
      overweight: sheet.overweight,
      rotateSpeed: sheet.rotateSpeed,
      approachSpeed: sheet.approachSpeed,
    }
  }

  private navInfo(): NavInfo {
    const s = this.physics.state
    const { x, y, z } = s.position
    const near = nearestAirport(x, z)
    const app = s.onGround ? null : approachGuidance(x, y, z, s.headingDeg)
    return {
      nearest: {
        code: near.airport.code,
        name: near.airport.name,
        distance: near.distance,
        bearingDeg: near.bearingDeg,
      },
      approach: app && {
        code: app.end.airport.code,
        runway: app.end.designator,
        distance: app.distance,
        lateral: app.lateral,
        vertical: app.vertical,
      },
    }
  }
}
