/**
 * Weight and balance for the airliners: operating empty weight plus fuel plus
 * passengers and their bags give the gross mass; where each of them sits gives
 * the centre of gravity (as % of the mean aerodynamic chord) and, relative to
 * the type's design load, the CG shift the flight model feels. Pure.
 *
 * Figures are published or typical (see aircraftCatalog sources); the arms
 * (metres aft of the design datum) and CG limits are estimates, documented per
 * type below. The design load is the type's game weight (80 % of MTOW).
 */

import { getAircraft, type AircraftId } from '../config/aircraftCatalog'
import { getAircraftConfig } from '../config/aircraft'

export interface LoadSpec {
  /** Operating empty weight, maximum take-off and landing weight (kg). */
  oew: number
  mtow: number
  mlw: number
  /** Usable fuel (kg). */
  maxFuel: number
  maxPax: number
  /** Per passenger with bags (kg). */
  paxMass: number
  /** Mean aerodynamic chord (m) and the CG at the design load (% MAC). */
  mac: number
  designCgPct: number
  /** Certified CG range (% MAC). */
  cgForward: number
  cgAft: number
  /** Arms (m aft of the design datum): empty aircraft, fuel, forward and aft cabin and hold. */
  armOew: number
  armFuel: number
  armCabinFwd: number
  armCabinAft: number
}

const SPECS: Partial<Record<AircraftId, LoadSpec>> = {
  // A320-200: OEW 42.6 t, MTOW 78 t, MLW 66 t, ~19.4 t usable fuel, 180 seats, MAC 4.19 m.
  a320: { oew: 42_600, mtow: 78_000, mlw: 66_000, maxFuel: 19_300, maxPax: 180, paxMass: 95, mac: 4.19, designCgPct: 28, cgForward: 17, cgAft: 37, armOew: 0.6, armFuel: 1.3, armCabinFwd: -5.5, armCabinAft: 6.5 },
  // A220-300: OEW 37.1 t, MTOW 70.9 t, MLW 61.2 t, ~17.5 t fuel, 145 seats, MAC ~3.9 m.
  a220: { oew: 37_080, mtow: 70_900, mlw: 61_235, maxFuel: 17_500, maxPax: 145, paxMass: 95, mac: 3.9, designCgPct: 27, cgForward: 16, cgAft: 36, armOew: 0.5, armFuel: 1.3, armCabinFwd: -5.5, armCabinAft: 6.5 },
  // A350-900: OEW ~142.4 t (the hangar card's 115.7 t is the manufacturer's empty weight), MTOW 283 t, MLW 205 t, ~112.8 t fuel, 325 seats, MAC ~7.4 m.
  a350: { oew: 142_400, mtow: 283_000, mlw: 205_000, maxFuel: 112_800, maxPax: 325, paxMass: 100, mac: 7.4, designCgPct: 29, cgForward: 17, cgAft: 38, armOew: 0.8, armFuel: 2.0, armCabinFwd: -11, armCabinAft: 12 },
  // Global 8000: BOW 28 t, MTOW 52.1 t, MLW 36 t, ~16 t fuel, up to 19 passengers, MAC ~3.9 m.
  global8000: { oew: 28_000, mtow: 52_100, mlw: 36_000, maxFuel: 16_000, maxPax: 19, paxMass: 100, mac: 3.9, designCgPct: 30, cgForward: 18, cgAft: 38, armOew: 0.4, armFuel: 1.0, armCabinFwd: -3.5, armCabinAft: 4.5 },
}

export interface Loading {
  fuelKg: number
  pax: number
  /** Share of the passengers seated in the aft half of the cabin, 0..1. */
  aftShare: number
}

export interface LoadSheet {
  massKg: number
  fuelKg: number
  pax: number
  /** Where the CG sits, % MAC, and metres aft of the design CG. */
  cgPct: number
  cgShiftM: number
  cgInLimits: boolean
  overweight: boolean
  /** Over the landing weight (fine for take-off, fuel must burn off first). */
  aboveLanding: boolean
  /** Rotation and approach speeds for this weight (m/s). */
  rotateSpeed: number
  approachSpeed: number
}

export function loadSpec(id: AircraftId): LoadSpec | null {
  return SPECS[id] ?? null
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

function gross(spec: LoadSpec, l: Loading): number {
  return spec.oew + l.fuelKg + l.pax * spec.paxMass
}

/** The sum of mass x arm, about the design datum. */
function moment(spec: LoadSpec, l: Loading): number {
  const cabinArm = spec.armCabinFwd + (spec.armCabinAft - spec.armCabinFwd) * clamp(l.aftShare, 0, 1)
  return spec.oew * spec.armOew + l.fuelKg * spec.armFuel + l.pax * spec.paxMass * cabinArm
}

/**
 * The load the type is flown at when nothing else is chosen: about three
 * quarters of the seats full, fuel making up the type's game weight.
 */
export function defaultLoading(id: AircraftId): Loading | null {
  const spec = SPECS[id]
  if (!spec) return null
  const target = getAircraftConfig(id).mass
  const pax0 = Math.round(spec.maxPax * 0.75)
  const fuelKg = clamp(target - spec.oew - pax0 * spec.paxMass, 0, spec.maxFuel)
  // When the tanks are full (the A350 is flown at its maximum weight), more passengers make up the rest.
  const pax = clamp(Math.round((target - spec.oew - fuelKg) / spec.paxMass), 0, spec.maxPax)
  return { fuelKg, pax, aftShare: 0.5 }
}

/** CG of the design load, m aft of the datum: the flight model's reference. */
function designArm(id: AircraftId, spec: LoadSpec): number {
  const d = defaultLoading(id)!
  return moment(spec, d) / gross(spec, d)
}

export function computeLoadSheet(id: AircraftId, l: Loading): LoadSheet | null {
  const spec = SPECS[id]
  if (!spec) return null
  const mass = gross(spec, l)
  const shift = moment(spec, l) / mass - designArm(id, spec)
  const cgPct = spec.designCgPct + (shift / spec.mac) * 100
  const sp = getAircraft(id).speeds
  const k = Math.sqrt(mass / getAircraftConfig(id).mass)
  return {
    massKg: mass,
    fuelKg: l.fuelKg,
    pax: l.pax,
    cgPct,
    cgShiftM: shift,
    cgInLimits: cgPct >= spec.cgForward && cgPct <= spec.cgAft,
    overweight: mass > spec.mtow,
    aboveLanding: mass > spec.mlw,
    rotateSpeed: sp.rotate * k,
    approachSpeed: sp.approach * k,
  }
}

/** Fuel flow from thrust: a typical turbofan burns about 14 mg per newton-second. */
export function fuelBurnKg(thrustN: number, seconds: number): number {
  return Math.max(0, thrustN) * 1.4e-5 * seconds
}

/** Passengers and fuel the type can carry; the sliders' limits. */
export function loadLimits(id: AircraftId): { maxFuel: number; maxPax: number } | null {
  const s = SPECS[id]
  return s ? { maxFuel: s.maxFuel, maxPax: s.maxPax } : null
}
