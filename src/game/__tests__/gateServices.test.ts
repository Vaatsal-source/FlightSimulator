import { describe, expect, it } from 'vitest'
import { BRIDGE_SECONDS, GateServices, newTurnaround, SERVICE_SECONDS, type ServiceContext } from '../gateServices'
import { defaultLoading } from '../loading'

const PARKED: ServiceContext = { parkingBrake: true, engineRunning: false, groundSpeed: 0 }

function services() {
  return newTurnaround('a320')!
}

function advance(s: GateServices, seconds: number, ctx: ServiceContext = PARKED): boolean {
  let changed = false
  for (let t = 0; t < seconds; t += 0.5) changed = s.update(0.5, ctx) || changed
  return changed
}

/** Bridge docked and doors open: ready to service. */
function docked() {
  const s = services()
  s.command({ type: 'bridge' }, PARKED)
  advance(s, BRIDGE_SECONDS + 1)
  s.command({ type: 'doors' }, PARKED)
  return s
}

describe('jet bridge and doors', () => {
  it('starts away from the aircraft with the doors shut, and a light load', () => {
    const v = services().view
    expect(v.bridge).toBe('retracted')
    expect(v.doorsOpen).toBe(false)
    expect(v.loading.pax).toBe(0)
    expect(v.ready).toBe(true)
    expect(v.sheet.massKg).toBeLessThan(defaultLoading('a320')!.fuelKg + 42_600 + 1)
  })

  it('extends over the bridge time, docks, and only then lets the doors open', () => {
    const s = services()
    s.command({ type: 'doors' }, PARKED)
    expect(s.view.doorsOpen).toBe(false)
    expect(s.view.notice).toContain('No jet bridge')
    s.command({ type: 'bridge' }, PARKED)
    expect(s.view.bridge).toBe('extending')
    advance(s, BRIDGE_SECONDS / 2)
    expect(s.view.bridgeProgress).toBeGreaterThan(0.4)
    expect(s.view.bridgeProgress).toBeLessThan(0.6)
    expect(s.view.bridge).toBe('extending')
    advance(s, BRIDGE_SECONDS)
    expect(s.view.bridge).toBe('docked')
    expect(s.view.bridgeProgress).toBe(1)
    s.command({ type: 'doors' }, PARKED)
    expect(s.view.doorsOpen).toBe(true)
  })

  it('the bridge will not move unless the aircraft is parked: brake set, engines off, stopped', () => {
    for (const ctx of [
      { parkingBrake: false, engineRunning: false, groundSpeed: 0 },
      { parkingBrake: true, engineRunning: true, groundSpeed: 0 },
      { parkingBrake: true, engineRunning: false, groundSpeed: 2 },
    ]) {
      const s = services()
      s.command({ type: 'bridge' }, ctx)
      expect(s.view.bridge).toBe('retracted')
      expect(s.view.notice).toContain('parking brake')
    }
  })

  it('the bridge cannot retract with the doors open; closing them first lets it go', () => {
    const s = docked()
    s.command({ type: 'bridge' }, PARKED)
    expect(s.view.bridge).toBe('docked')
    expect(s.view.notice).toContain('Close the doors')
    s.command({ type: 'doors' }, PARKED)
    s.command({ type: 'bridge' }, PARKED)
    expect(s.view.bridge).toBe('retracting')
    advance(s, BRIDGE_SECONDS + 1)
    expect(s.view.bridge).toBe('retracted')
    expect(s.view.bridgeProgress).toBe(0)
  })
})

describe('refuelling and boarding', () => {
  it('boards through open doors, in about the service time, and the load grows with it', () => {
    const s = docked()
    s.command({ type: 'setPax', pax: 150 }, PARKED)
    const massBefore = s.view.sheet.massKg
    s.command({ type: 'passengers' }, PARKED)
    expect(s.view.paxService).toBe('boarding')
    advance(s, SERVICE_SECONDS * (150 / 180) + 3)
    expect(s.view.loading.pax).toBe(150)
    expect(s.view.paxService).toBe('idle')
    expect(s.view.sheet.massKg - massBefore).toBeCloseTo(150 * 95, 0)
  })

  it('will not board with the doors shut or when already at the target', () => {
    const s = services()
    s.command({ type: 'setPax', pax: 100 }, PARKED)
    s.command({ type: 'passengers' }, PARKED)
    expect(s.view.paxService).toBe('idle')
    expect(s.view.notice).toContain('doors are shut')
    const d = docked()
    d.command({ type: 'passengers' }, PARKED)
    expect(d.view.notice).toContain('already at the target')
  })

  it('deplanes towards a lower target and cannot be cut off by closing the doors mid-way', () => {
    const s = docked()
    s.command({ type: 'setPax', pax: 90 }, PARKED)
    s.command({ type: 'passengers' }, PARKED)
    advance(s, 60)
    expect(s.view.loading.pax).toBe(90)
    s.command({ type: 'setPax', pax: 10 }, PARKED)
    s.command({ type: 'passengers' }, PARKED)
    expect(s.view.paxService).toBe('deplaning')
    advance(s, 5)
    s.command({ type: 'doors' }, PARKED)
    expect(s.view.doorsOpen).toBe(true)
    expect(s.view.notice).toContain('still moving')
    advance(s, 60)
    expect(s.view.loading.pax).toBe(10)
  })

  it('refuels to the chosen amount at a steady rate, only with the aircraft parked and the engines off', () => {
    const s = services()
    const start = s.view.loading.fuelKg
    s.command({ type: 'setFuel', kg: start + 6000 }, PARKED)
    s.command({ type: 'refuel' }, { parkingBrake: true, engineRunning: true, groundSpeed: 0 })
    expect(s.view.refuelling).toBe(false)
    s.command({ type: 'refuel' }, PARKED)
    expect(s.view.refuelling).toBe(true)
    advance(s, 10)
    expect(s.view.loading.fuelKg).toBeGreaterThan(start + 1000)
    expect(s.view.loading.fuelKg).toBeLessThan(start + 3000)
    advance(s, 60)
    expect(s.view.loading.fuelKg).toBe(start + 6000)
    expect(s.view.refuelling).toBe(false)
  })

  it('limits the targets to what the aircraft can carry', () => {
    const s = services()
    s.command({ type: 'setFuel', kg: 1e9 }, PARKED)
    s.command({ type: 'setPax', pax: 9999 }, PARKED)
    expect(s.view.targetFuelKg).toBe(s.view.maxFuel)
    expect(s.view.targetPax).toBe(s.view.maxPax)
    s.command({ type: 'setFuel', kg: -5 }, PARKED)
    expect(s.view.targetFuelKg).toBe(0)
  })

  it('the cabin balance moves the CG without changing the mass', () => {
    const s = docked()
    s.command({ type: 'setPax', pax: 120 }, PARKED)
    s.command({ type: 'passengers' }, PARKED)
    advance(s, 90)
    const even = s.view.sheet
    s.command({ type: 'setBalance', aftShare: 0.9 }, PARKED)
    expect(s.view.sheet.massKg).toBe(even.massKg)
    expect(s.view.sheet.cgPct).toBeGreaterThan(even.cgPct)
  })
})

describe('the aircraft is not ready until the turnaround is finished', () => {
  it('names what is in the way, and clears once everything is stowed', () => {
    const s = docked()
    expect(s.view.ready).toBe(false)
    expect(s.view.blocker).toBe('retract the jet bridge')
    s.command({ type: 'setPax', pax: 60 }, PARKED)
    s.command({ type: 'passengers' }, PARKED)
    s.command({ type: 'doors' }, PARKED) // refused: boarding
    expect(s.view.doorsOpen).toBe(true)
    advance(s, 60)
    s.command({ type: 'doors' }, PARKED)
    expect(s.view.blocker).toBe('retract the jet bridge')
    s.command({ type: 'bridge' }, PARKED)
    advance(s, BRIDGE_SECONDS + 1)
    expect(s.view.ready).toBe(true)
    expect(s.view.blocker).toBeNull()
  })

  it('stops refuelling and boarding if the aircraft starts up', () => {
    const s = docked()
    s.command({ type: 'setFuel', kg: s.view.loading.fuelKg + 5000 }, PARKED)
    s.command({ type: 'refuel' }, PARKED)
    expect(s.view.refuelling).toBe(true)
    advance(s, 2, { parkingBrake: true, engineRunning: true, groundSpeed: 0 })
    expect(s.view.refuelling).toBe(false)
  })

  it('aircraft without a loadsheet have no turnaround', () => {
    expect(newTurnaround('trainer')).toBeNull()
    expect(newTurnaround('f22')).toBeNull()
    expect(() => new GateServices('trainer', { fuelKg: 0, pax: 0, aftShare: 0.5 })).toThrow()
  })
})
