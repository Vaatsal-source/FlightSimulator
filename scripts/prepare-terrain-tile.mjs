/**
 * Bakes the downloaded "terrain with mountains, rivers and forest" scene (assets-src/terrain-tile, about 1 M triangles and 55 MB)
 * into two small runtime files in public/terrain/:
 *   tile-height.png  16-bit grey height map (the mountain range's relief)
 *   tile-colour.webp 2048 x 2048 colour map (rock, snow, forest, river beds), the scene's own texture
 * plus tile.json with the height range. Run: node scripts/prepare-terrain-tile.mjs [--probe]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import sharp from 'sharp'

const SRC = 'assets-src/terrain-tile/'
const OUT = 'public/terrain/'
const N = 1000 // height grid resolution (the mesh is a ~1013 x 1013 lattice)
const COLOUR = 2048

const gltf = JSON.parse(readFileSync(SRC + 'scene.gltf', 'utf8'))
const bin = readFileSync(SRC + 'scene.bin')

function accessor(i) {
  const a = gltf.accessors[i]
  const v = gltf.bufferViews[a.bufferView]
  const off = (v.byteOffset ?? 0) + (a.byteOffset ?? 0)
  const nc = { VEC2: 2, VEC3: 3, SCALAR: 1 }[a.type]
  const Ctor = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array }[a.componentType]
  const len = a.count * nc
  // Copy to an aligned buffer.
  const copy = new Uint8Array(len * Ctor.BYTES_PER_ELEMENT)
  copy.set(bin.subarray(off, off + copy.length))
  return new Ctor(copy.buffer)
}

const pos = []
const uv = []
for (const m of gltf.meshes.slice(0, 16)) {
  const at = m.primitives[0].attributes
  pos.push(accessor(at.POSITION))
  uv.push(accessor(at.TEXCOORD_0))
}
let count = 0
for (const p of pos) count += p.length / 3
const P = new Float32Array(count * 3)
const UV = new Float32Array(count * 2)
{
  let o = 0
  let q = 0
  for (let k = 0; k < pos.length; k++) {
    P.set(pos[k], o)
    UV.set(uv[k], q)
    o += pos[k].length
    q += uv[k].length
  }
}
let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, minZ = 1e9, maxZ = -1e9
for (let i = 0; i < count; i++) {
  const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2]
  if (x < minX) minX = x
  if (x > maxX) maxX = x
  if (y < minY) minY = y
  if (y > maxY) maxY = y
  if (z < minZ) minZ = z
  if (z > maxZ) maxZ = z
}
console.log({ count, minX, maxX, minY, maxY, minZ, maxZ })
// Is the UV a plain function of x, y?
let worst = 0
for (let i = 0; i < count; i += 997) {
  const u = (P[i * 3] - minX) / (maxX - minX)
  const v = (P[i * 3 + 1] - minY) / (maxY - minY)
  worst = Math.max(worst, Math.abs(u - UV[i * 2]), Math.abs(v - UV[i * 2 + 1]), Math.abs(1 - v - UV[i * 2 + 1]))
}
console.log('uv vs xy mismatch (max over sampled, includes flipped alt):', worst)
if (process.argv.includes('--probe')) process.exit(0)

// ---- height grid: rasterise the real triangles (the vertices are not on a regular lattice, so binning them is noisy)
const h = new Float64Array(N * N).fill(NaN)
function rasterTri(ax, ay, az, bx, by, bz, cx, cy, cz) {
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)))
  const x1 = Math.min(N - 1, Math.ceil(Math.max(ax, bx, cx)))
  const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)))
  const y1 = Math.min(N - 1, Math.ceil(Math.max(ay, by, cy)))
  const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
  if (Math.abs(den) < 1e-12) return
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5
      const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den
      const l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den
      const l3 = 1 - l1 - l2
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue
      h[y * N + x] = l1 * az + l2 * bz + l3 * cz
    }
}
for (const m of gltf.meshes.slice(0, 16)) {
  const at = m.primitives[0].attributes
  const Pm = accessor(at.POSITION)
  const idx = accessor(m.primitives[0].indices)
  const gx = (i) => ((Pm[i * 3] - minX) / (maxX - minX)) * N
  const gy = (i) => ((Pm[i * 3 + 1] - minY) / (maxY - minY)) * N
  for (let t = 0; t < idx.length; t += 3) {
    const i = idx[t], j = idx[t + 1], k = idx[t + 2]
    rasterTri(gx(i), gy(i), Pm[i * 3 + 2], gx(j), gy(j), Pm[j * 3 + 2], gx(k), gy(k), Pm[k * 3 + 2])
  }
}
// Fill any uncovered cell from its neighbours.
let holes = 0
for (let pass = 0; pass < 8; pass++) {
  holes = 0
  const next = Float64Array.from(h)
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      if (!Number.isNaN(h[y * N + x])) continue
      let s = 0, c = 0
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy
        if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue
        const v = h[yy * N + xx]
        if (!Number.isNaN(v)) { s += v; c++ }
      }
      if (c) next[y * N + x] = s / c
      else holes++
    }
  h.set(next)
  if (holes === 0) break
}
let lo = Infinity, hi = -Infinity
for (const v of h) { if (v < lo) lo = v; if (v > hi) hi = v }
console.log('heights', lo, hi, 'holes', holes)

mkdirSync(OUT, { recursive: true })
// 16-bit grey, row 0 = the tile's +Y edge flipped so that image rows run north to south like the world's +Z.
const px = Buffer.alloc(N * N * 2)
for (let y = 0; y < N; y++)
  for (let x = 0; x < N; x++) {
    const v = (h[(N - 1 - y) * N + x] - lo) / (hi - lo)
    px.writeUInt16LE(Math.round(Math.max(0, Math.min(1, v)) * 65535), (y * N + x) * 2)
  }
await sharp(px, { raw: { width: N, height: N, channels: 1, depth: 'ushort' } }).png({ compressionLevel: 9 }).toFile(OUT + 'tile-height.png')

// ---- colour map: the scene's diffuse texture, resized
await sharp(SRC + 'textures/Material_diffuse.png').resize(COLOUR, COLOUR, { kernel: "lanczos3" }).flip().webp({ quality: 86 }).toFile(OUT + 'tile-colour.webp')

// ---- embedded data for the pure height function (physics, terrain worker and shaders all need it synchronously):
// a 256 x 256 relief grid (0..1, 16-bit) and a 128 x 128 forest mask taken from the colour map.
const G = 256
const rel = new Float32Array(G * G)
{
  const k = N / G
  for (let y = 0; y < G; y++)
    for (let x = 0; x < G; x++) {
      let sum = 0, c = 0
      for (let yy = Math.floor(y * k); yy < Math.min(N, Math.ceil((y + 1) * k)); yy++)
        for (let xx = Math.floor(x * k); xx < Math.min(N, Math.ceil((x + 1) * k)); xx++) { sum += h[(N - 1 - yy) * N + xx]; c++ }
      rel[y * G + x] = sum / c
    }
}
const sorted = Float32Array.from(rel).sort()
const p02 = sorted[Math.floor(sorted.length * 0.02)]
const p99 = sorted[Math.floor(sorted.length * 0.995)]
const relBytes = Buffer.alloc(G * G * 2)
for (let i = 0; i < G * G; i++) relBytes.writeUInt16LE(Math.round(Math.max(0, Math.min(1, (rel[i] - p02) / (p99 - p02))) * 65535), i * 2)
const F = 128
const fm = await sharp(OUT + 'tile-colour.webp').resize(F, F, { kernel: 'cubic' }).raw().toBuffer()
const forest = Buffer.alloc(F * F)
for (let i = 0; i < F * F; i++) {
  const r = fm[i * 3], g = fm[i * 3 + 1], b = fm[i * 3 + 2]
  // Forest and meadow are green; rock and snow are grey or white.
  const green = g - Math.max(r, b)
  forest[i] = Math.max(0, Math.min(255, Math.round(green * 14)))
}
writeFileSync(
  'src/world/terrain/tileData.ts',
  `/* Generated by scripts/prepare-terrain-tile.mjs from the CC-BY-4.0 scene "terrain with mountains, rivers and forest" by n-malmberg. Do not edit. */
` +
    `export const TILE_RELIEF_SIZE = ${G}
export const TILE_FOREST_SIZE = ${F}
` +
    `export const TILE_RELIEF_B64 = '${relBytes.toString('base64')}'
export const TILE_FOREST_B64 = '${forest.toString('base64')}'
`,
)
writeFileSync(OUT + 'tile.json', JSON.stringify({ heightMin: lo, heightMax: hi, extentXY: [maxX - minX, maxY - minY], grid: N, colour: COLOUR }, null, 2))
console.log('written to', OUT)
