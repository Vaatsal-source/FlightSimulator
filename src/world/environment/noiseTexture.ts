/**
 * A tileable value-noise texture, baked once on the CPU. The terrain and sky shaders used to compute value noise per pixel
 * (four hashes and a bilinear mix, several times over); one filtered texture read does the same job for a fraction of the GPU
 * time, which matters most on integrated graphics.
 */

import { DataTexture, LinearFilter, RedFormat, RepeatWrapping, UnsignedByteType } from 'three'

/** Lattice cells across one tile; the texture repeats every NOISE_CELLS noise units. */
export const NOISE_CELLS = 256
const TEXELS_PER_CELL = 4

function hash(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2147483647)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967295
}

/** The tile's bytes: smoothstep-interpolated value noise on a wrapping NOISE_CELLS x NOISE_CELLS lattice. Pure, so it can be tested. */
export function bakeNoise(cells = NOISE_CELLS, texelsPerCell = TEXELS_PER_CELL, seed = 7): Uint8Array {
  const size = cells * texelsPerCell
  const lattice = new Float32Array(cells * cells)
  for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) lattice[y * cells + x] = hash(x, y, seed)
  const out = new Uint8Array(size * size)
  const smooth = (t: number) => t * t * (3 - 2 * t)
  for (let ty = 0; ty < size; ty++) {
    const fy = ty / texelsPerCell
    const y0 = Math.floor(fy)
    const v = smooth(fy - y0)
    const y1 = (y0 + 1) % cells
    for (let tx = 0; tx < size; tx++) {
      const fx = tx / texelsPerCell
      const x0 = Math.floor(fx)
      const u = smooth(fx - x0)
      const x1 = (x0 + 1) % cells
      const a = lattice[y0 * cells + x0]
      const b = lattice[y0 * cells + x1]
      const c = lattice[y1 * cells + x0]
      const d = lattice[y1 * cells + x1]
      out[ty * size + tx] = Math.round((a + (b - a) * u + (c + (d - c) * u - (a + (b - a) * u)) * v) * 255)
    }
  }
  return out
}

let shared: DataTexture | null = null

/** The one shared noise texture (never disposed: it lives as long as the page). */
export function getNoiseTexture(): DataTexture {
  if (!shared) {
    const size = NOISE_CELLS * TEXELS_PER_CELL
    shared = new DataTexture(bakeNoise(), size, size, RedFormat, UnsignedByteType)
    shared.wrapS = shared.wrapT = RepeatWrapping
    shared.magFilter = shared.minFilter = LinearFilter
    shared.generateMipmaps = false
    shared.needsUpdate = true
  }
  return shared
}

/** GLSL for the shaders: `tNoise(p)` has the same 0..1 range and one-unit lattice as the hash-based function it replaces. */
export const NOISE_GLSL = /* glsl */ `
uniform sampler2D uNoiseTex;
float tNoise(vec2 p) {
  return texture2D(uNoiseTex, p * ${(1 / NOISE_CELLS).toFixed(8)}).r;
}
`
