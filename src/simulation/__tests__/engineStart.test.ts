import { describe, expect, it } from 'vitest'
import type { AircraftId } from '../../config/aircraftCatalog'
import { groundSpawn, makeAircraft, run } from './helpers'

const JET_START_S = 30
const PISTON_START_S = 3

function parked(id: AircraftId) {
  return makeAircraft(id, groundSpawn({ engineRunning: false, throttle: 0 }))
}

describe('engine start and shutdown', () => {
  it.each(['a320', 'f22', 'trainer'] as AircraftId[])('%s: a cold engine makes no thrust, whatever the throttle', (id) => {
    const sim = parked(id)
    run(sim, 5, (s) => s.setControls({ throttle: 1, brakes: 1 }))
    expect(sim.state.engine.running).toBe(false)
    expect(sim.state.engine.thrust).toBe(0)
    expect(sim.engineStartProgress).toBe(0)
  })

  it('a jet starts over about 30 s: progress and N1 rise steadily, no thrust until it lights', () => {
    const sim = parked('a320')
    sim.startEngines()
    let last = 0
    let lastN1 = 0
    run(sim, 14, (s) => s.setControls({ throttle: 0.5, brakes: 1 }), (s) => {
      expect(s.engineStartProgress).toBeGreaterThanOrEqual(last)
      expect(s.state.engine.n1).toBeGreaterThanOrEqual(lastN1 - 1e-9)
      last = s.engineStartProgress
      lastN1 = s.state.engine.n1
      return false
    })
    expect(sim.state.engine.running).toBe(false)
    expect(sim.engineStartProgress).toBeGreaterThan(0.4)
    expect(sim.engineStartProgress).toBeLessThan(0.55)
    expect(sim.state.engine.thrust).toBe(0)
    expect(sim.state.engine.n1).toBeGreaterThan(0.05)

    run(sim, JET_START_S, (s) => s.setControls({ throttle: 0, brakes: 1 }), (s) => s.state.engine.running)
    expect(sim.state.engine.running).toBe(true)
    expect(sim.engineStartProgress).toBe(0)
    run(sim, 40, (s) => s.setControls({ throttle: 0, brakes: 1 }))
    expect(sim.state.engine.thrust).toBeGreaterThan(0)
    expect(sim.state.engine.n1).toBeGreaterThan(0.15)
    expect(sim.state.crashed).toBe(false)
  }, 30000)

  it('a piston engine catches within a few seconds', () => {
    const sim = parked('trainer')
    sim.startEngines()
    const steps = run(sim, PISTON_START_S + 1, (s) => s.setControls({ throttle: 0.1, brakes: 1 }), (s) => s.state.engine.running)
    expect(sim.state.engine.running).toBe(true)
    expect(steps * sim.fixedDt).toBeGreaterThan(PISTON_START_S - 0.2)
    expect(steps * sim.fixedDt).toBeLessThan(PISTON_START_S + 0.5)
  })

  it('the start request is ignored while running, and a shutdown stops the engine and spools it down', () => {
    const sim = makeAircraft('a320', groundSpawn({ throttle: 0 }))
    expect(sim.state.engine.running).toBe(true)
    sim.startEngines()
    run(sim, 2, (s) => s.setControls({ throttle: 0, brakes: 1 }))
    expect(sim.engineStartProgress).toBe(0)

    run(sim, 20, (s) => s.setControls({ throttle: 0, brakes: 1 }))
    expect(sim.state.engine.thrust).toBeGreaterThan(0)
    sim.stopEngines()
    expect(sim.state.engine.running).toBe(false)
    run(sim, 60, (s) => s.setControls({ throttle: 0, brakes: 1 }))
    expect(sim.state.engine.thrust).toBeLessThan(1)
    expect(sim.state.engine.n1).toBeLessThan(0.1)
  }, 30000)

  it('a shutdown during a start aborts it', () => {
    const sim = parked('a320')
    sim.startEngines()
    run(sim, 10, (s) => s.setControls({ brakes: 1 }))
    expect(sim.engineStartProgress).toBeGreaterThan(0.2)
    sim.stopEngines()
    expect(sim.engineStartProgress).toBe(0)
    run(sim, 40, (s) => s.setControls({ brakes: 1 }))
    expect(sim.state.engine.running).toBe(false)
  })

  it('a crashed aircraft cannot start, and a reset clears a start in progress', () => {
    const sim = parked('a320')
    sim.startEngines()
    run(sim, 5, (s) => s.setControls({ brakes: 1 }))
    sim.forceCrash('test')
    sim.startEngines()
    expect(sim.state.engine.running).toBe(false)
    sim.reset(groundSpawn({ engineRunning: false }))
    expect(sim.engineStartProgress).toBe(0)
    run(sim, 60, (s) => s.setControls({ brakes: 1 }))
    expect(sim.state.engine.running).toBe(false)
  }, 30000)
})
