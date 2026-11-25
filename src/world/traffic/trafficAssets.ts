/**
 * The glTF airliners, loaded once and shared: by the AI traffic in the sky and
 * by the aircraft parked at the gates. The templates live for the session.
 */

import { Group, MeshStandardMaterial, type Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { modelScale, type TrafficModelSpec } from './trafficModels'

const cache = new Map<string, Promise<Object3D | null>>()

/** The loaded model, or null when the file cannot be read (the game still runs without traffic). */
export function loadTrafficTemplate(spec: TrafficModelSpec): Promise<Object3D | null> {
  let p = cache.get(spec.id)
  if (!p) {
    p = new GLTFLoader()
      .loadAsync(`${import.meta.env.BASE_URL}models/traffic/${spec.file}`)
      .then((gltf) => {
        // Without an environment map a metallic material renders almost black.
        gltf.scene.traverse((o) => {
          const m = (o as { material?: MeshStandardMaterial }).material
          if (m && 'metalness' in m) {
            m.metalness = Math.min(m.metalness, 0.15)
            m.roughness = Math.max(m.roughness, 0.55)
            // Stand-in for sky light bouncing off the ground and clouds: a fill from the livery itself.
            if (m.map) {
              m.emissiveMap = m.map
              m.emissive.setScalar(0.4)
            }
          }
        })
        return gltf.scene as Object3D
      })
      .catch((err) => {
        console.warn(`Traffic model ${spec.file} failed to load`, err)
        return null
      })
    cache.set(spec.id, p)
  }
  return p
}

/** A placeable copy: origin on the ground under the middle of the aircraft, nose along -Z, real size. Shares geometry and materials. */
export function instantiateTraffic(spec: TrafficModelSpec, template: Object3D): Group {
  const holder = new Group()
  const fit = new Group()
  fit.rotation.y = Math.PI / 2 // the files have their nose along +X
  fit.scale.setScalar(modelScale(spec))
  const inner = template.clone(true)
  inner.position.set(-spec.centreX, -spec.minY, -spec.centreZ)
  fit.add(inner)
  holder.add(fit)
  return holder
}
