import { describe, expect, it } from 'vitest'
import { AIRPORTS } from '../../config/airports'
import { getTelemetry } from '../../state/telemetry'
import { FlightSession } from '../FlightSession'

const FRAME = 1 / 60

function gateSession(aircraft: 'trainer' | 'a320') {
  const airport = AIRPORTS.find((a) => a.class === 'international')!
  const session = new FlightSession({ mode: 'gate', aircraft, onFinish: () => {} })
  session.reset('gate', { airportId: airport.id, runwayEnd: airport.runways[0].headingDeg === 90 ? '09R' : '36' })
  return session
}

function run(session: FlightSession, seconds: number) {
  for (let t = 0; t < seconds; t += FRAME) session.frame(FRAME, false)
}

describe('pushback', () => {
  it('pushes the aircraft tail-first off the stand, then stops with the brake set', () => {
    const session = gateSession('trainer')
    run(session, 1)
    const s = session.physics.state
    const start = { x: s.position.x, z: s.position.z, heading: s.headingDeg }
    session.keyboard.keyDown('KeyT')
    session.keyboard.keyUp('KeyT')
    run(session, 5)
    expect(getTelemetry().ground?.phase).toBe('pushback')
    run(session, 90)
    const moved = Math.hypot(s.position.x - start.x, s.position.z - start.z)
    expect(moved).toBeGreaterThan(40)
    expect(moved).toBeLessThan(130)
    expect(getTelemetry().ground?.phase).toBe('coldDark')
    expect(getTelemetry().parkingBrake).toBe(true)
    expect(s.groundSpeed).toBeLessThan(0.2)
    expect(s.crashed).toBe(false)
    // Backwards: the displacement points away from the nose.
    const h = (start.heading * Math.PI) / 180
    const along = (s.position.x - start.x) * Math.sin(h) + (s.position.z - start.z) * -Math.cos(h)
    expect(along).toBeLessThan(-30)
  })

  it('can be called off with a second press', () => {
    const session = gateSession('trainer')
    run(session, 1)
    session.keyboard.keyDown('KeyT')
    session.keyboard.keyUp('KeyT')
    run(session, 3)
    expect(getTelemetry().ground?.phase).toBe('pushback')
    session.keyboard.keyDown('KeyT')
    session.keyboard.keyUp('KeyT')
    run(session, 3)
    expect(getTelemetry().ground?.phase).toBe('coldDark')
    expect(getTelemetry().parkingBrake).toBe(true)
  })
})
