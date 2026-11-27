// Builds the web aircraft carrier from the Sketchfab download in assets-src/carrier ("Gerald R Ford aircraft Carrier" by waelXcm, CC-BY-4.0):
// 316 nodes, 158 meshes, 116 k triangles and 60 MB of textures become a few joined meshes (one per material), simplified, with
// compact base-colour textures: public/models/carrier/carrier.glb. Run: node scripts/prepare-carrier.mjs [--probe]
import fs from 'node:fs'
import { NodeIO } from '@gltf-transform/core'
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, flatten, join, prune, simplify, textureCompress, weld } from '@gltf-transform/functions'
import { MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'

const TRIS = 70000

/** Bake each mesh node's transform into its vertices and reset the node, so every axis downstream is the model's own. */
const bakeTransforms = () => (doc) => {
  const seen = new Set()
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh()
    if (!mesh) continue
    const m = node.getWorldMatrix()
    if (m.every((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) < 1e-9)) continue
    const v = [0, 0, 0]
    for (const prim of mesh.listPrimitives()) {
      for (const sem of ['POSITION', 'NORMAL']) {
        const acc = prim.getAttribute(sem)
        if (!acc || seen.has(acc)) continue
        seen.add(acc)
        for (let i = 0; i < acc.getCount(); i++) {
          acc.getElement(i, v)
          const x = v[0], y = v[1], z = v[2], w = sem === 'POSITION' ? 1 : 0
          v[0] = m[0] * x + m[4] * y + m[8] * z + m[12] * w
          v[1] = m[1] * x + m[5] * y + m[9] * z + m[13] * w
          v[2] = m[2] * x + m[6] * y + m[10] * z + m[14] * w
          if (sem === 'NORMAL') { const l = Math.hypot(v[0], v[1], v[2]) || 1; v[0] /= l; v[1] /= l; v[2] /= l }
          acc.setElement(i, v)
        }
      }
    }
    node.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  }
}


await MeshoptSimplifier.ready
const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS)
const doc = await io.read('assets-src/carrier/scene.gltf')

const bounds = (label) => {
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh()
    if (!mesh) continue
    const m = node.getWorldMatrix()
    let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9], tris = 0
    for (const p of mesh.listPrimitives()) {
      const pos = p.getAttribute('POSITION')
      tris += (p.getIndices()?.getCount() ?? 0) / 3
      const v = [0, 0, 0]
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v)
        const x = m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12]
        const y = m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13]
        const z = m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]
        lo = [Math.min(lo[0], x), Math.min(lo[1], y), Math.min(lo[2], z)]
        hi = [Math.max(hi[0], x), Math.max(hi[1], y), Math.max(hi[2], z)]
      }
    }
    if (tris > 300 || /deck|bridge|island/.test(node.getName())) console.log(label, node.getName().slice(0, 34).padEnd(34), tris, lo.map((n) => n.toFixed(1)).join(','), '|', hi.map((n) => n.toFixed(1)).join(','))
  }
}
await doc.transform(flatten())
if (process.argv.includes('--probe')) {
  bounds('w')
  process.exit(0)
}

const REAL_LENGTH = 333 // m, the real ship
const KING = 1.8 // "king sized": this much bigger than the real one
const before = doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + (p.getIndices()?.getCount() ?? 0) / 3, 0), 0)

// Colour only: the normal and metal/rough maps are about 40 MB of the 60 and add little at sea-level viewing distances.
for (const mat of doc.getRoot().listMaterials()) {
  mat.setNormalTexture(null)
  mat.setMetallicRoughnessTexture(null)
  mat.setMetallicFactor(0.25)
  mat.setRoughnessFactor(0.7)
  mat.setDoubleSided(false)
}
await doc.transform(
  bakeTransforms(),
  dedup(),
  join({ keepMeshes: false, keepNamed: false }),
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: TRIS / before, error: 0.004, lockBorder: true }),
  prune(),
  textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [2048, 2048], quality: 84 }),
)

// Deck measurements in the model's own units, from the deck mesh: its top and the length of the ship.
let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]
const all = (fn) => {
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh()
    if (!mesh) continue
    for (const p of mesh.listPrimitives()) fn(p.getAttribute('POSITION'), p)
  }
}
all((pos) => {
  const v = [0, 0, 0]
  for (let i = 0; i < pos.getCount(); i++) {
    pos.getElement(i, v)
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[k]); hi[k] = Math.max(hi[k], v[k]) }
  }
})
console.log('model bounds', lo.map((n) => n.toFixed(3)), hi.map((n) => n.toFixed(3)))
const unit = (REAL_LENGTH / (hi[2] - lo[2])) * KING // metres per model unit
const DECK_X0 = Number(process.env.DECK_X0 ?? -0.62) // runway lane across the deck, clear of the island
const DECK_X1 = Number(process.env.DECK_X1 ?? 1.42)
const WATERLINE = lo[1] + 0.44 // the real draft is about 12 m: 0.44 units
const cx = (DECK_X0 + DECK_X1) / 2
const midZ = (lo[2] + hi[2]) / 2
// Move the model so that the origin is the waterline under the middle of the landing lane, and scale it to metres.
all((pos) => {
  const v = [0, 0, 0]
  for (let i = 0; i < pos.getCount(); i++) {
    pos.getElement(i, v)
    pos.setElement(i, [(v[0] - cx) * unit, (v[1] - WATERLINE) * unit, (v[2] - midZ) * unit])
  }
})
// The deck's top: the highest y among the vertices of the deck-coloured mesh is the island, so use the most common high level instead.
const ys = new Map()
all((pos, p) => {
  const v = [0, 0, 0]
  for (let i = 0; i < pos.getCount(); i += 3) {
    pos.getElement(i, v)
    if (v[0] > (DECK_X0 - cx) * unit && v[0] < (DECK_X1 - cx) * unit && Math.abs(v[2]) < 200) {
      const k = Math.round(v[1] * 10) / 10
      ys.set(k, (ys.get(k) ?? 0) + 1)
    }
  }
})
const top = [...ys.entries()].filter(([y]) => y > 15).sort((a, b) => b[1] - a[1])[0]
console.log('most common level above 15 m in the lane:', top)
fs.mkdirSync('public/models/carrier', { recursive: true })
await io.write('public/models/carrier/carrier.glb', doc)
const bytes = fs.statSync('public/models/carrier/carrier.glb').size
const after = doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + (p.getIndices()?.getCount() ?? 0) / 3, 0), 0)
fs.writeFileSync(
  'public/models/carrier/carrier.json',
  JSON.stringify({ unitMetres: unit, lengthM: (hi[2] - lo[2]) * unit, beamM: (hi[0] - lo[0]) * unit, laneHalfWidthM: ((DECK_X1 - DECK_X0) / 2) * unit, laneHalfLengthM: 0, deckTopM: top?.[0] ?? null, halfLengthM: ((hi[2] - lo[2]) * unit) / 2 }, null, 2),
)
fs.copyFileSync('assets-src/carrier/license.txt', 'public/models/carrier/LICENSE.txt')
console.log({ trisBefore: before, trisAfter: after, mb: (bytes / 1e6).toFixed(2) })
