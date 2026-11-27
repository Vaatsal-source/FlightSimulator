/**
 * The photographic F-22 body (a CC BY-NC-SA 4.0 Sketchfab model, see public/models/f22/LICENSE.txt) fitted over the
 * procedural rig: it replaces the fuselage, wings, fins and canopy, while the rig keeps its animated landing gear,
 * afterburner nozzles and lights. Loaded once and shared; until it arrives (or if it cannot load) the procedural body shows.
 */

import { Group, Mesh, MeshStandardMaterial, type Material, type Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { JetAssembly } from './jetKit'

/** The file's units: 10 per metre, nose along +X. These put its nose and tail where the procedural fuselage has them. */
const SCALE = 0.1
const OFFSET = { y: -0.2, z: 3.55 }
/** Parts of the file that are not wanted: its own landing gear and light cones (the rig animates its own gear). */
const DROP = /landing|hud|instrglass/i

let cache: Promise<Object3D | null> | null = null

function loadBody(): Promise<Object3D | null> {
  cache ??= new GLTFLoader()
    .loadAsync(`${import.meta.env.BASE_URL}models/f22/f22.glb`)
    .then((gltf) => {
      const drop: Object3D[] = []
      gltf.scene.traverse((o) => {
        if (DROP.test(o.name)) drop.push(o)
      })
      for (const o of drop) o.parent?.remove(o)
      gltf.scene.traverse((o) => {
        const mesh = o as Mesh
        if (!mesh.isMesh) return
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const m of mats as Material[]) {
          const s = m as MeshStandardMaterial
          if (s.metalness === undefined || s.transparent) continue
          // No environment map in the scene: a metal would render nearly black. Keep a little of its character.
          s.metalness = Math.min(s.metalness, 0.3)
          s.roughness = Math.max(s.roughness, 0.45)
          if (s.map) {
            s.emissiveMap = s.map
            s.emissive.setScalar(0.22)
          }
        }
      })
      return gltf.scene as Object3D
    })
    .catch((err) => {
      console.warn('F-22 model failed to load; using the procedural body', err)
      return null
    })
  return cache
}

/** Swap the procedural body for the photographic one as soon as it has loaded. */
export function attachPhotoBody(asm: JetAssembly, alsoHide: Object3D[] = []): void {
  const proceduralBody: Object3D[] = [...alsoHide]
  for (const o of asm.root.children) {
    const m = (o as Mesh).material
    if (m === asm.bodyMat || m === asm.glassMat) proceduralBody.push(o)
  }
  const surfaces = [...asm.elevators, ...asm.rudders, ...asm.ailerons.map((a) => a.g), ...asm.flaps.map((f) => f.g), ...asm.spoilers.map((s) => s.g)]
  // A surface is either a deflecting group inside a pivot (hide the pivot) or a group added straight to the root (hide it).
  for (const g of surfaces) proceduralBody.push(g.parent && g.parent !== asm.root ? g.parent : g)

  void loadBody().then((template) => {
    if (!template) return
    const wrap = new Group()
    wrap.name = 'f22-photo-body'
    wrap.scale.setScalar(SCALE)
    wrap.rotation.y = Math.PI / 2
    wrap.position.set(0, OFFSET.y, OFFSET.z)
    const body = template.clone(true)
    body.traverse((o) => {
      const mesh = o as Mesh
      if (mesh.isMesh) mesh.castShadow = asm.shadows
    })
    wrap.add(body)
    asm.root.add(wrap)
    for (const o of proceduralBody) o.visible = false
    // From the cockpit the eye sits inside the airframe: its skin is not drawn there (the deck has its own canopy bows).
    asm.extra.push((_rs, cockpit) => {
      wrap.visible = !cockpit
      for (const o of proceduralBody) o.visible = false
    })
  })
}
