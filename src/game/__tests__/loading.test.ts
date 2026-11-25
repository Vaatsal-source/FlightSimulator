import { describe, expect, it } from 'vitest'
import { AIRCRAFT_IDS } from '../../config/aircraftCatalog'
import { getAircraftConfig } from '../../config/aircraft'
import { groundSpawn, makeAircraft, run } from '../../simulation/__tests__/helpers'
import { computeLoadSheet, defaultLoading, fuelBurnKg, loadLimits, loadSpec } from '../loading'

const LOADED = ['a220', 'a320', 'a350', 'global8000'] as const

describe('weight and balance', () => {
  it.each(LOADED)('%s: the default load makes the type game weight, with the design CG, inside the limits', (id) => {
    const d = defaultLoading(id)!
    const sheet = computeLoadSheet(id, d)!
    expect(Math.abs(sheet.massKg - getAircraftConfig(id).mass)).toBeLessThan(loadSpec(id)!.paxMass)
    expect(sheet.cgShiftM).toBeCloseTo(0, 6)
    expect(sheet.cgPct).toBeCloseTo(loadSpec(id)!.designCgPct, 6)
    expect(sheet.cgInLimits).toBe(true)
    expect(sheet.overweight).toBe(false)
    // At the design weight the speeds are the catalogue's.
    expect(sheet.rotateSpeed).toBeGreaterThan(40)
    expect(d.fuelKg).toBeLessThanOrEqual(loadSpec(id)!.maxFuel)
  })

  it('the trainer and the fighter have no loadsheet', () => {
    expect(loadSpec('trainer')).toBeNull()
    expect(defaultLoading('f22')).toBeNull()
    expect(computeLoadSheet('trainer', { fuelKg: 0, pax: 0, aftShare: 0.5 })).toBeNull()
    expect(loadLimits('f22')).toBeNull()
    expect(AIRCRAFT_IDS.filter((id) => loadSpec(id) !== null)).toEqual(['a220', 'a320', 'a350', 'global8000'])
  })

  it('more weight raises the speeds with the square root of the mass', () => {
    const d = defaultLoading('a320')!
    const heavy = computeLoadSheet('a320', { ...d, fuelKg: d.fuelKg + 8000 })!
    const base = computeLoadSheet('a320', d)!
    expect(heavy.rotateSpeed / base.rotateSpeed).toBeCloseTo(Math.sqrt(heavy.massKg / base.massKg), 6)
    expect(heavy.rotateSpeed).toBeGreaterThan(base.rotateSpeed)
  })

  it('passengers in the aft cabin move the CG aft, forward passengers move it forward', () => {
    const d = defaultLoading('a320')!
    const fwd = computeLoadSheet('a320', { ...d, aftShare: 0.1 })!
    const mid = computeLoadSheet('a320', d)!
    const aft = computeLoadSheet('a320', { ...d, aftShare: 0.9 })!
    expect(fwd.cgPct).toBeLessThan(mid.cgPct)
    expect(aft.cgPct).toBeGreaterThan(mid.cgPct)
    // The mass is unchanged by where they sit.
    expect(aft.massKg).toBe(mid.massKg)
  })

  it('flags an overweight take-off, an out-of-limits CG and a weight above the landing limit', () => {
    const spec = loadSpec('a320')!
    const full = computeLoadSheet('a320', { fuelKg: spec.maxFuel, pax: spec.maxPax, aftShare: 0.5 })!
    expect(full.massKg).toBeGreaterThan(spec.mtow - 1)
    // 42.6 + 19.3 + 180 x 95 = 79.0 t: over the 78 t limit.
    expect(full.overweight).toBe(true)
    expect(full.aboveLanding).toBe(true)
    const tail = computeLoadSheet('a320', { ...defaultLoading('a320')!, aftShare: 1, pax: 180 })!
    const nose = computeLoadSheet('a320', { ...defaultLoading('a320')!, aftShare: 0, pax: 180 })!
    expect(tail.cgPct).toBeGreaterThan(nose.cgPct + 5)
    expect(computeLoadSheet('a320', { fuelKg: 3000, pax: 0, aftShare: 0.5 })!.aboveLanding).toBe(false)
  })

  it('fuel burn follows thrust and time, and never goes negative', () => {
    expect(fuelBurnKg(100_000, 10)).toBeCloseTo(14, 6)
    expect(fuelBurnKg(0, 100)).toBe(0)
    expect(fuelBurnKg(-5, 10)).toBe(0)
  })
})

describe('the load in the flight model', () => {
  it('setLoad changes the mass, scales the inertia and clamps nonsense', () => {
    const sim = makeAircraft('a320', groundSpawn({ throttle: 0 }))
    const base = sim.massKg
    const baseInertia = sim.config.inertia.y
    sim.setLoad({ massKg: base * 1.2, cgShiftM: 0 })
    expect(sim.massKg).toBeCloseTo(base * 1.2, 6)
    expect(sim.config.inertia.y).toBeCloseTo(baseInertia * 1.2, 3)
    sim.setLoad({ massKg: Number.NaN, cgShiftM: Number.NaN })
    expect(sim.massKg).toBe(base)
    sim.setLoad({ massKg: 1, cgShiftM: 0 })
    expect(sim.massKg).toBeGreaterThanOrEqual(0.3 * base)
    sim.setLoad({ massKg: 1e9, cgShiftM: 0 })
    expect(sim.massKg).toBeLessThanOrEqual(2 * base)
  })

  it('a heavier aircraft needs a longer take-off run', () => {
    const roll = (massFactor: number) => {
      const sim = makeAircraft('a320', groundSpawn({ flaps: 1 / 3 }))
      sim.setLoad({ massKg: sim.massKg * massFactor, cgShiftM: 0 })
      let rotate = false
      run(sim, 90, (s) => s.setControls({ throttle: 1, flaps: 1 / 3, pitch: rotate ? 0.35 : 0 }), (s) => {
        if (s.state.airspeed > 75 * Math.sqrt(massFactor)) rotate = true
        return !s.state.onGround
      })
      return Math.hypot(sim.state.position.x, sim.state.position.z)
    }
    expect(roll(1.25)).toBeGreaterThan(roll(1) + 150)
  }, 30000)

  it('an aft CG makes the aircraft less stable: the trim moves and the pitching stiffness falls', () => {
    const sim = makeAircraft('a320', groundSpawn({ throttle: 0 }))
    const stiff = sim.config.aero.cmAlpha
    sim.setLoad({ massKg: sim.massKg, cgShiftM: 1 })
    expect(sim.config.aero.cmAlpha).toBeGreaterThan(stiff)
    sim.setLoad({ massKg: sim.massKg, cgShiftM: -1 })
    expect(sim.config.aero.cmAlpha).toBeLessThan(stiff)
    // The type's own numbers are untouched by the loading.
    sim.setLoad({ massKg: getAircraftConfig('a320').mass, cgShiftM: 0 })
    expect(sim.config.aero.cmAlpha).toBe(getAircraftConfig('a320').aero.cmAlpha)
  })
})
