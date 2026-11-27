import { beforeEach, describe, expect, it } from 'vitest'
import { getAircraft } from '../../config/aircraftCatalog'
import { CARRIER_DECK, CARRIER_ID, onCarrierDeck } from '../../config/carrier'
import { getRunwayEnd, guidanceTo, headingVector } from '../../game/airportGeometry'
import { resetAutopilot, useAutopilotStore } from '../../state/autopilotStore'
import { getTerrainSampler } from '../../world/terrain/terrainSampler'
import { FlightSession } from '../FlightSession'

const FRAME = 1 / 60
const DEG = Math.PI / 180
const place = { airportId: CARRIER_ID, runwayEnd: '12' }

describe('aircraft carrier', () => {
  beforeEach(() => resetAutopilot())

  it('is solid, paved ground over its deck and open sea beyond it', () => {
    const t = getTerrainSampler()
    const end = getRunwayEnd(CARRIER_ID, '12')
    const mid = end.runway.rect
    expect(onCarrierDeck(mid.cx, mid.cz)).toBe(true)
    expect(t.heightAt(mid.cx, mid.cz)).toBe(CARRIER_DECK.height)
    expect(t.surfaceAt(mid.cx, mid.cz)).toBe('paved')
    expect(t.heightAt(mid.cx + 400, mid.cz + 400)).toBe(0)
    expect(t.surfaceAt(mid.cx + 400, mid.cz + 400)).toBe('water')
  })

  it('takes only carrier-capable aircraft', () => {
    expect(getAircraft('f22').minDeck).toBeLessThanOrEqual(CARRIER_DECK.length)
    expect(getAircraft('a350').minDeck).toBeUndefined()
  })

  it('an F-22 starts on the deck and rolls without sinking into it', () => {
    const session = new FlightSession({ mode: 'takeoff', aircraft: 'f22', place, onFinish: () => {} })
    session.reset('takeoff', place)
    const s = () => session.physics.state
    session.keyboard.keyDown('KeyR')
    let lowest = Infinity
    for (let t = 0; t < 6; t += FRAME) {
      session.frame(FRAME, false)
      lowest = Math.min(lowest, s().position.y)
    }
    expect(s().crashed).toBe(false)
    // The CG rides on the gear above the deck: never below the deck surface.
    expect(lowest).toBeGreaterThan(CARRIER_DECK.height)
    expect(s().onGround || s().position.y > CARRIER_DECK.height).toBe(true)
  })

  it('catches an F-22 landing in the wire zone and stops it on the deck', () => {
    const session = new FlightSession({ mode: 'freeFlight', aircraft: 'f22', place, onFinish: () => {} })
    session.reset('freeFlight', place)
    const end = getRunwayEnd(CARRIER_ID, '12')
    const d = headingVector(end.headingDeg)
    const back = 6000
    session.physics.reset({
      position: { x: end.threshold.x - d.x * back, y: end.airport.elevation + (back + 300) * Math.tan(3 * DEG) + 20, z: end.threshold.z - d.z * back },
      headingDeg: end.headingDeg,
      pitchDeg: 0,
      airspeed: getAircraft('f22').speeds.approach * 1.2,
      throttle: 0.5,
      flaps: 0,
      onGround: false,
      gearUp: true,
    })
    session.keyboard.reset({ throttle: 0.5, flaps: 0, trim: 0, gear: 0 })
    useAutopilotStore.getState().requestAssist()
    const s = () => session.physics.state
    const key = (c: string, on: boolean) => (on ? session.keyboard.keyDown(c) : session.keyboard.keyUp(c))
    let phase: 'assist' | 'flare' | 'roll' = 'assist'
    for (let t = 0; t < 400 && !s().crashed; t += FRAME) {
      if (phase === 'assist' && useAutopilotStore.getState().assist === null && t > 1) phase = 'flare'
      if (phase === 'flare') {
        const st = s()
        if (st.onGround) phase = 'roll'
        else {
          const target = st.heightAboveGround < 12 ? -0.8 : -2.2
          key('KeyS', st.verticalSpeed < target - 0.2)
          key('KeyW', st.verticalSpeed > target + 0.4 && st.heightAboveGround > 12)
          key('KeyF', st.heightAboveGround < 12)
        }
      }
      if (phase === 'roll') {
        for (const c of ['KeyS', 'KeyW', 'KeyR']) key(c, false)
        key('KeyF', true)
        key('KeyB', true)
        if (s().airspeed < 1) break
      }
      session.frame(FRAME, false)
    }
    const st = s()
    expect(phase).toBe('roll')
    expect(st.crashed).toBe(false)
    expect(st.airspeed).toBeLessThan(1)
    expect(onCarrierDeck(st.position.x, st.position.z)).toBe(true)
    const g = guidanceTo(end, st.position.x, st.position.y, st.position.z)
    expect(-g.distance).toBeLessThan(CARRIER_DECK.length)
  })
})
