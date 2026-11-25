/**
 * Details for the open country: villages with a main street, roads between
 * them, wind-turbine farms on the high ground and radio masts on the hills.
 * Pure and deterministic; the terrain is only used to find land, slope and
 * height. Kept out of the airports (and their approach corridors) and off the
 * coast.
 */

import { AIRPORTS } from '../../config/airports'
import { WORLD } from '../../config/world'
import type { TerrainSampler } from '../../simulation/types'
import { treesExcludedAt } from '../terrain/treePlacement'

export interface House {
  x: number
  z: number
  w: number
  d: number
  h: number
  ridge: number
  /** Not used for rotation of the mesh (houses are axis-aligned); kept for the street direction. */
  color: [number, number, number]
}

export interface Village {
  x: number
  z: number
  houses: House[]
  /** The big building (church / hall / silo) at the centre, if any. */
  landmark: { x: number; z: number; r: number; h: number } | null
}

export interface Road {
  a: number
  b: number
  pts: { x: number; z: number }[]
}

export interface Turbine {
  x: number
  z: number
}

export interface Mast {
  x: number
  z: number
  h: number
}

export interface SceneryPlan {
  villages: Village[]
  roads: Road[]
  turbines: Turbine[]
  masts: Mast[]
}

/** Tower and rotor of the turbines (m). */
export const TURBINE = { towerH: 62, hubR: 1.8, bladeLen: 34 }

function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const WALLS: [number, number, number][] = [
  [1, 0.96, 0.86],
  [1, 0.84, 0.68],
  [0.95, 0.95, 0.98],
  [1, 0.7, 0.58],
  [1, 0.97, 0.78],
]

/** Keep this far from every airport centre (m); the big fields are kilometres across. */
const AIRPORT_CLEAR = 4200
const CELL = 4000
const MAX_ROAD = 9000
const ROAD_STEP = 50

/** Land, above the beach, and not steep around a point. */
function buildable(t: TerrainSampler, x: number, z: number, maxSlope: number): boolean {
  const h = t.heightAt(x, z)
  if (!(h > 6) || h > 700) return false
  const r = 45
  for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r]] as const) {
    if (Math.abs(t.heightAt(x + dx, z + dz) - h) / r > maxSlope) return false
  }
  return true
}

function farFromAirports(x: number, z: number, clear: number): boolean {
  for (const a of AIRPORTS) if (Math.hypot(x - a.center.x, z - a.center.z) < clear) return false
  return true
}

function clearOfRestrictions(x: number, z: number, r: number): boolean {
  if (treesExcludedAt(x, z)) return false
  for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r]] as const) if (treesExcludedAt(x + dx, z + dz)) return false
  return true
}

function planVillage(rand: () => number, x: number, z: number): Village {
  const theta = rand() * Math.PI
  const ux = Math.cos(theta)
  const uz = Math.sin(theta)
  const houses: House[] = []
  const rows = 2 + Math.floor(rand() * 3)
  const perRow = 3 + Math.floor(rand() * 4)
  for (let side = -1; side <= 1; side += 2) {
    for (let k = -perRow; k <= perRow; k++) {
      if (rand() < 0.22) continue
      // Along the street (u) and out to the side (v).
      const u = k * (20 + rand() * 6)
      for (let r = 0; r < rows; r++) {
        if (r > 0 && rand() < 0.55) continue
        const v = side * (13 + r * 24 + rand() * 4)
        houses.push({
          x: x + ux * u - uz * v,
          z: z + uz * u + ux * v,
          w: 8 + rand() * 5,
          d: 9 + rand() * 6,
          h: 3.4 + rand() * 2.6,
          ridge: 1.6 + rand() * 1.4,
          color: WALLS[Math.floor(rand() * WALLS.length)],
        })
      }
    }
  }
  const landmark = rand() < 0.7 ? { x: x + uz * 26, z: z - ux * 26, r: 3 + rand() * 1.5, h: 14 + rand() * 10 } : null
  return { x, z, houses, landmark }
}

export function planScenery(terrain: TerrainSampler): SceneryPlan {
  const rand = rng(WORLD.seed ^ 0x5eed)
  const half = WORLD.islandRadius - 2500
  const villages: Village[] = []

  for (let gx = -half; gx < half; gx += CELL) {
    for (let gz = -half; gz < half; gz += CELL) {
      const x = gx + rand() * CELL
      const z = gz + rand() * CELL
      const keep = rand() < 0.4
      if (!keep || Math.hypot(x, z) > half) continue
      if (!farFromAirports(x, z, AIRPORT_CLEAR) || !clearOfRestrictions(x, z, 420)) continue
      if (!buildable(terrain, x, z, 0.06)) continue
      const v = planVillage(rand, x, z)
      // Drop any house that ends up on water, a slope or a restricted zone.
      v.houses = v.houses.filter((h) => buildable(terrain, h.x, h.z, 0.12) && !treesExcludedAt(h.x, h.z))
      if (v.houses.length >= 5) villages.push(v)
    }
  }

  // Roads: every village to its two nearest neighbours (each pair once), over land only.
  const roads: Road[] = []
  const seen = new Set<string>()
  villages.forEach((va, a) => {
    const order = villages
      .map((vb, b) => ({ b, d: Math.hypot(vb.x - va.x, vb.z - va.z) }))
      .filter((o) => o.b !== a && o.d < MAX_ROAD)
      .sort((p, q) => p.d - q.d)
      .slice(0, 2)
    for (const { b, d } of order) {
      const key = a < b ? `${a}-${b}` : `${b}-${a}`
      if (seen.has(key)) continue
      seen.add(key)
      const vb = villages[b]
      const n = Math.max(2, Math.ceil(d / ROAD_STEP))
      const nx = -(vb.z - va.z) / d
      const nz = (vb.x - va.x) / d
      const wob = (rand() - 0.5) * 2
      const pts: { x: number; z: number }[] = []
      let ok = true
      for (let i = 0; i <= n && ok; i++) {
        const f = i / n
        const bend = Math.sin(f * Math.PI) * 140 * wob + Math.sin(f * 11 + a) * 12 * Math.sin(f * Math.PI)
        const x = va.x + (vb.x - va.x) * f + nx * bend
        const z = va.z + (vb.z - va.z) * f + nz * bend
        const h = terrain.heightAt(x, z)
        // Avoid water, the beach, steep ground and anything that belongs to an airport.
        if (!(h > 3) || h > 900 || treesExcludedAt(x, z) || !farFromAirports(x, z, 3000)) ok = false
        else pts.push({ x, z })
      }
      if (ok) roads.push({ a, b, pts })
    }
  })

  // Wind farms on high ground: a few rows of turbines.
  const turbines: Turbine[] = []
  let farms = 0
  for (let tries = 0; tries < 900 && farms < 7; tries++) {
    const x = (rand() * 2 - 1) * half
    const z = (rand() * 2 - 1) * half
    if (Math.hypot(x, z) > half) continue
    if (!farFromAirports(x, z, AIRPORT_CLEAR) || !clearOfRestrictions(x, z, 900)) continue
    const h = terrain.heightAt(x, z)
    if (h < 90 || h > 650 || !buildable(terrain, x, z, 0.18)) continue
    const dir = rand() * Math.PI
    const n = 5 + Math.floor(rand() * 4)
    const row: Turbine[] = []
    for (let i = 0; i < n; i++) {
      const tx = x + Math.cos(dir) * i * 250
      const tz = z + Math.sin(dir) * i * 250
      if (buildable(terrain, tx, tz, 0.22) && clearOfRestrictions(tx, tz, 100) && farFromAirports(tx, tz, AIRPORT_CLEAR)) row.push({ x: tx, z: tz })
    }
    if (row.length >= 3) {
      turbines.push(...row)
      farms++
    }
  }

  // Radio masts on prominent hills.
  const masts: Mast[] = []
  for (let tries = 0; tries < 1200 && masts.length < 8; tries++) {
    const x = (rand() * 2 - 1) * half
    const z = (rand() * 2 - 1) * half
    if (Math.hypot(x, z) > half) continue
    if (!farFromAirports(x, z, AIRPORT_CLEAR) || !clearOfRestrictions(x, z, 600)) continue
    const h = terrain.heightAt(x, z)
    if (h < 200 || h > 1200) continue
    if (masts.some((m) => Math.hypot(m.x - x, m.z - z) < 6000)) continue
    masts.push({ x, z, h: 70 + rand() * 50 })
  }
  return { villages, roads, turbines, masts }
}
