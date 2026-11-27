// Builds public/models/f22/cockpit.glb from the user-generated "F-16 inspired" cockpit in assets-src/f16-cockpit-bundle:
// the 392 separate parts are merged by material (about 14 draw calls), and everything that must be live is removed so
// the game can draw it dynamically: display symbology, HUD symbols and combiner, gauge needles, the control stick and the throttle.
// Run: node scripts/prepare-fighter-cockpit.mjs
import fs from 'node:fs'
import { NodeIO } from '@gltf-transform/core'
import { dedup, flatten, join, prune } from '@gltf-transform/functions'

const REMOVE = [
  /display (status line|vertical display trace|horizontal display trace|lower data block|key indicator)/i,
  /^HUD (combiner glass|flight path marker|pitch ladder)/i,
  /needle$/i, // the needle, not the hub
  /^Control stick/i,
  /^Throttle (grip|lever)/i,
  /^Canopy transverse bow/i, // it crosses the view ahead of the pilot
]

const io = new NodeIO()
const doc = await io.read('assets-src/f16-cockpit-bundle/f16_inspired_cockpit.glb')
let removed = 0
for (const node of doc.getRoot().listNodes()) {
  if (REMOVE.some((re) => re.test(node.getName()))) {
    node.dispose()
    removed++
  }
}
console.log('removed', removed, 'parts')
await doc.transform(dedup(), flatten(), join({ keepMeshes: false, keepNamed: false }), prune())
fs.mkdirSync('public/models/f22', { recursive: true })
await io.write('public/models/f22/cockpit.glb', doc)
let tris = 0
for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3
console.log('meshes', doc.getRoot().listMeshes().length, 'materials', doc.getRoot().listMaterials().length, 'tris', tris, (fs.statSync('public/models/f22/cockpit.glb').size / 1024).toFixed(0) + ' kB')
