// Builds compact web models for the player aircraft from the Sketchfab downloads in assets-src/aircraft:
//   public/models/aircraft/<id>.glb  plus the licence text.
// The two heavy ones (A220, A320: 580k to 730k triangles, 60 to 100 flat-coloured materials) are flattened,
// their colours merged into one palette texture, joined into one mesh and simplified. The A220 also gets smooth
// normals and a livery (vertex colours); the A320 and A220 have their landing gear split into separate meshes
// (gear_nose, gear_ml, gear_mr) so the game can retract them.
// Run: node scripts/prepare-aircraft.mjs [id]
import fs from 'node:fs'
import { NodeIO } from '@gltf-transform/core'
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, flatten, join, palette, prune, simplify, textureCompress, weld } from '@gltf-transform/functions'
import { MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'

const MODELS = {
  a220: {
    dir: 'airbus_a220-300',
    tris: 70000,
    hiTris: 130000,
    palette: true,
    error: 0.3,
    flatNormals: true,
    // The model is a plain grey fuselage: make it white before the colours are merged.
    recolour: { from: [0.371, 0.366, 0.381], to: [0.9, 0.91, 0.93], tol: 0.035 },
    // Model space: length along z (nose at -z), lateral x, up y. Gear is split out by region.
    livery: { zmin: -73.1, zmax: -52.6, y0: 0.1, y1: 6.6, cx: 48.9 },
    gear: {
      nose: (x, y, z) => y < 0.75 && Math.abs(x - 48.9) < 1.0 && z < -70 && z > -73.6,
      main: (x, y, z) => y < 0.9 && Math.abs(x - 48.9) < 3.4 && z > -67.5 && z < -62.5,
      mainSide: (x) => (x < 48.9 ? 'l' : 'r'),
    },
    texture: 1024,
  },
  a320: {
    dir: 'airbus_a320-200',
    tris: 60000,
    hiTris: 130000,
    palette: true,
    // Model space: length along x (nose at -x), span z, up y. Nacelle bottoms are also low, so the gear is cut by region.
    gear: {
      nose: (x, y, z) => y < 10.5 && x < -36 && x > -62 && Math.abs(z) < 6,
      main: (x, y, z) => y < 10.5 && x > 2 && x < 24 && Math.abs(z) < 23,
      mainSide: (_x, _y, z) => (z < 0 ? 'l' : 'r'),
    },
    texture: 1024,
  },
  a350: { dir: 'airbus_a350-1000', tris: 0, palette: false, texture: 2048 },
  // The Learjet is painted black: lighten its dark body textures to white (keeping a quarter of their detail). Very dark ones are tires and trim.
  global8000: { dir: 'bombardier_learjet_60', tris: 0, palette: false, texture: 1024, whiten: { minMean: 10, maxMean: 110, base: 196, gain: 0.25, flat: ['material08'] } },
}

await MeshoptSimplifier.ready
const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS)
const only = process.argv[2]

/** A vertex of a node's mesh in world space. */
const world = (node, pos, i, out) => {
  const m = node.getWorldMatrix()
  pos.getElement(i, out)
  const x = out[0], y = out[1], z = out[2]
  out[0] = m[0] * x + m[4] * y + m[8] * z + m[12]
  out[1] = m[1] * x + m[5] * y + m[9] * z + m[13]
  out[2] = m[2] * x + m[6] * y + m[10] * z + m[14]
}

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

/** Smooth normals on an indexed mesh: the average of the faces that share each vertex. */
const smoothNormals = () => (doc) => {
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION')
      const idx = prim.getIndices()
      if (!pos || !idx) continue
      const n = new Float32Array(pos.getCount() * 3)
      const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0]
      for (let i = 0; i < idx.getCount(); i += 3) {
        const i0 = idx.getScalar(i), i1 = idx.getScalar(i + 1), i2 = idx.getScalar(i + 2)
        pos.getElement(i0, a); pos.getElement(i1, b); pos.getElement(i2, c)
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx // area-weighted
        for (const k of [i0, i1, i2]) { n[k * 3] += nx; n[k * 3 + 1] += ny; n[k * 3 + 2] += nz }
      }
      for (let k = 0; k < n.length; k += 3) {
        const l = Math.hypot(n[k], n[k + 1], n[k + 2]) || 1
        n[k] /= l; n[k + 1] /= l; n[k + 2] /= l
      }
      prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(n).setBuffer(pos.getBuffer()))
    }
  }
}

/** Livery as vertex colours (they multiply the palette colours: the body is white, so these show as they are). */
const livery = (cfg) => (doc) => {
  const { zmin, zmax, y0, y1, cx } = cfg
  const L = zmax - zmin, H = y1 - y0
  const BLUE = [0.04, 0.2, 0.46], GREY = [0.62, 0.65, 0.7], DARK = [0.2, 0.22, 0.26]
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh()
    if (!mesh) continue
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION')
      const col = new Float32Array(pos.getCount() * 4)
      const v = [0, 0, 0]
      for (let i = 0; i < pos.getCount(); i++) {
        world(node, pos, i, v)
        const u = (v[2] - zmin) / L, h = (v[1] - y0) / H, lat = Math.abs(v[0] - cx) / 9.5
        let c = [1, 1, 1]
        if (u > 0.78 && h > 0.5 && lat < 0.1) c = BLUE // vertical fin
        else if (lat > 0.93) c = BLUE // wingtips
        else if (u < 0.05) c = DARK // radome
        else if (u > 0.1 && u < 0.93 && lat > 0.07 && lat < 0.2 && h > 0.31 && h < 0.37) c = BLUE // cheat line
        else if (u > 0.15 && u < 0.86 && lat < 0.13 && h < 0.26) c = GREY // belly
        col.set([c[0], c[1], c[2], 1], i * 4)
      }
      prim.setAttribute('COLOR_0', doc.createAccessor().setType('VEC4').setArray(col).setBuffer(pos.getBuffer()))
    }
  }
}

/** Move the triangles of the landing gear into their own meshes (same vertices, their own index lists). */
const splitGear = (gear) => (doc) => {
  const scene = doc.getRoot().listScenes()[0]
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh()
    if (!mesh || mesh.getName().startsWith('gear')) continue
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION'), idx = prim.getIndices()
      if (!idx) continue
      const groups = { nose: [], ml: [], mr: [] }
      const rest = []
      const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0]
      for (let i = 0; i < idx.getCount(); i += 3) {
        const t = [idx.getScalar(i), idx.getScalar(i + 1), idx.getScalar(i + 2)]
        world(node, pos, t[0], a); world(node, pos, t[1], b); world(node, pos, t[2], c)
        const x = (a[0] + b[0] + c[0]) / 3, y = (a[1] + b[1] + c[1]) / 3, z = (a[2] + b[2] + c[2]) / 3
        if (gear.nose(x, y, z)) groups.nose.push(...t)
        else if (gear.main(x, y, z)) groups['m' + gear.mainSide(x, y, z)].push(...t)
        else rest.push(...t)
      }
      prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(rest)).setBuffer(pos.getBuffer()))
      for (const [name, list] of Object.entries(groups)) {
        if (!list.length) continue
        const g = doc
          .createPrimitive()
          .setMaterial(prim.getMaterial())
          .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(list)).setBuffer(pos.getBuffer()))
        for (const sem of prim.listSemantics()) g.setAttribute(sem, prim.getAttribute(sem))
        const m = doc.createMesh('gear_' + name).addPrimitive(g)
        const nd = doc.createNode('gear_' + name).setMesh(m).setMatrix(node.getWorldMatrix())
        scene.addChild(nd)
        console.log('  gear', name, list.length / 3, 'triangles')
      }
    }
  }
}

for (const [modelId, baseCfg] of Object.entries(MODELS)) {
 for (const hi of baseCfg.hiTris ? [false, true] : [false]) {
  if (only && only !== modelId) continue
  const id = modelId + (hi ? '-hi' : '')
  const cfg = hi ? { ...baseCfg, tris: baseCfg.hiTris, noSecondPass: true } : baseCfg
  const doc = await io.read(`assets-src/aircraft/${cfg.dir}/scene.gltf`)
  const count = () => {
    let n = 0
    for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) n += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3
    return n
  }
  const before = count()
  // Specular, transmission and clearcoat make every pixel dearer for no visible gain on a small model.
  for (const ext of doc.getRoot().listExtensionsUsed()) if (/specular|transmission|clearcoat/i.test(ext.extensionName)) ext.dispose()

  if (cfg.whiten) {
    const { minMean, maxMean, base, gain } = cfg.whiten
    const done = new Set()
    for (const tex of doc.getRoot().listTextures()) {
      if (done.has(tex)) continue
      done.add(tex)
      const buf = Buffer.from(tex.getImage())
      const stats = await sharp(buf).stats()
      const mean = (stats.channels[0].mean + stats.channels[1].mean + stats.channels[2].mean) / 3
      if (mean < minMean || mean > maxMean) continue
      const out = await sharp(buf).removeAlpha().linear(gain, base).jpeg({ quality: 90 }).toBuffer()
      tex.setImage(new Uint8Array(out)).setMimeType('image/jpeg')
    }
  }

  if (cfg.whiten?.flat) {
    for (const mat of doc.getRoot().listMaterials()) if (cfg.whiten.flat.includes(mat.getName())) mat.setBaseColorFactor([0.8, 0.82, 0.85, 1])
  }

  if (cfg.recolour) {
    const { from, to, tol } = cfg.recolour
    for (const mat of doc.getRoot().listMaterials()) {
      const f = mat.getBaseColorFactor()
      if (Math.abs(f[0] - from[0]) < tol && Math.abs(f[1] - from[1]) < tol && Math.abs(f[2] - from[2]) < tol) mat.setBaseColorFactor([to[0], to[1], to[2], f[3]])
    }
  }

  // Flat-shaded models give every triangle its own vertices, so nothing welds and nothing can be simplified:
  // drop the normals, let the vertices weld, and compute smooth normals afterwards.
  const dropNormals = () => (d) => {
    for (const m of d.getRoot().listMeshes()) for (const p of m.listPrimitives()) p.setAttribute('NORMAL', null)
  }
  const steps = [dedup(), flatten()]
  if (cfg.flatNormals) steps.push(dropNormals())
  if (cfg.palette) steps.push(palette({ min: 2 }))
  steps.push(join({ keepMeshes: false, keepNamed: false }), weld())
  if (cfg.gear) steps.push(bakeTransforms())
  if (cfg.tris) steps.push(simplify({ simplifier: MeshoptSimplifier, ratio: cfg.tris / before, error: cfg.error ?? 0.005, lockBorder: false }))
  // A second pass takes what the first could not (the welded mesh has new collapse candidates).
  if (cfg.tris && cfg.flatNormals && !cfg.noSecondPass) steps.push(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: 0.75, error: cfg.error ?? 0.005, lockBorder: false }))
  if (cfg.flatNormals) steps.push(smoothNormals())
  if (cfg.livery) steps.push(livery(cfg.livery))
  if (cfg.gear) steps.push(splitGear(cfg.gear))
  steps.push(prune(), textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [cfg.texture, cfg.texture], quality: 88 }))
  await doc.transform(...steps)

  fs.mkdirSync('public/models/aircraft', { recursive: true })
  const out = `public/models/aircraft/${id}.glb`
  await io.write(out, doc)
  fs.copyFileSync(`assets-src/aircraft/${cfg.dir}/license.txt`, `public/models/aircraft/LICENSE-${modelId}.txt`)
  const root = doc.getRoot()
  console.log(id, 'tris', before, '->', count(), 'meshes', root.listMeshes().length, 'materials', root.listMaterials().length, (fs.statSync(out).size / 1048576).toFixed(1) + ' MB')
 }
}
