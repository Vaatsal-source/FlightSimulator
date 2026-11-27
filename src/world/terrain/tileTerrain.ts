/**
 * The baked mountain tile (CC-BY-4.0, "terrain with mountains, rivers and forest" by n-malmberg; see scripts/prepare-terrain-tile.mjs):
 * a 20 km square in the south-east highlands whose relief, valleys and forest cover come from that scene. Pure TypeScript with
 * synchronous data, because the physics sampler, the terrain worker and the tree placement all need the same numbers.
 */

import { TILE_FOREST_B64, TILE_FOREST_SIZE, TILE_RELIEF_B64, TILE_RELIEF_SIZE } from './tileData'
import { smoothstep } from './noise'

export const TILE = {
  /** Centre of the tile (m, world frame). */
  cx: 19000,
  cz: 20500,
  /** Half the side length (m). */
  half: 10000,
  /** Width of the soft edge, in which the tile blends into the procedural terrain (m). */
  fade: 3500,
  /** Peak relief it adds (m). */
  amplitude: 820,
} as const

function decode(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

let relief: Uint16Array | null = null
let forest: Uint8Array | null = null

function reliefGrid(): Uint16Array {
  if (!relief) {
    const bytes = decode(TILE_RELIEF_B64)
    relief = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1)
  }
  return relief
}
function forestGrid(): Uint8Array {
  forest ??= decode(TILE_FOREST_B64)
  return forest
}

/** 0 outside the tile, rising to 1 over TILE.fade from its edge. */
export function tileWeight(x: number, z: number): number {
  const dx = TILE.half - Math.abs(x - TILE.cx)
  const dz = TILE.half - Math.abs(z - TILE.cz)
  const d = dx < dz ? dx : dz
  if (d <= 0) return 0
  return smoothstep(0, TILE.fade, d)
}

function sample<T extends ArrayLike<number>>(grid: T, size: number, x: number, z: number, scale: number): number {
  const fx = ((x - (TILE.cx - TILE.half)) / (2 * TILE.half)) * size - 0.5
  const fz = ((z - (TILE.cz - TILE.half)) / (2 * TILE.half)) * size - 0.5
  const i = Math.max(0, Math.min(size - 2, Math.floor(fx)))
  const j = Math.max(0, Math.min(size - 2, Math.floor(fz)))
  const u = Math.max(0, Math.min(1, fx - i))
  const v = Math.max(0, Math.min(1, fz - j))
  const a = grid[j * size + i]
  const b = grid[j * size + i + 1]
  const c = grid[(j + 1) * size + i]
  const d = grid[(j + 1) * size + i + 1]
  return (a + (b - a) * u + (c - a + (a - b - c + d) * u) * v) * scale
}

/** The scene's relief at (x, z), 0..1 (valleys low, crests high). */
export function tileRelief01(x: number, z: number): number {
  return sample(reliefGrid(), TILE_RELIEF_SIZE, x, z, 1 / 65535)
}

/** Forest cover 0..1 from the scene's colour map (0 on rock and snow). */
export function tileForest(x: number, z: number): number {
  return sample(forestGrid(), TILE_FOREST_SIZE, x, z, 1 / 255)
}
