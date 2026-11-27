/**
 * The fighter flight deck's body: a low-triangle F-16-inspired cockpit (user-generated, about 16k triangles) merged into a dozen
 * meshes by scripts/prepare-fighter-cockpit.mjs, with all of its static symbology, the stick and the throttle taken out so
 * the game can draw them live. Loaded once and shared; until it arrives (or if it cannot load) the box-built deck shows.
 */

import { BoxGeometry, DoubleSide, Group, Mesh as ThreeMesh, MeshBasicMaterial, MeshStandardMaterial as StdMat, SphereGeometry, TorusGeometry, type Material, type Mesh, type MeshStandardMaterial, type Object3D, type Texture } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

/**
 * Where the pilot's eye is in the model's own frame (metres, +Y up, the pilot faces -Z). The model puts its HUD well above its
 * seat, so the eye is level with the HUD, which also clears the view over the glare-shield.
 */
export const FIGHTER = {
  eye: [0, 1.8, 0.85] as const,
  /** The instrument panel leans back this much (rotation about X, radians). */
  tilt: -0.4276,
  /** Centres of the displays on the panel, and of the HUD (model frame). */
  hud: [0, 1.74, -0.57] as const,
  mfdLeft: [-0.37, 1.075, -0.924] as const,
  mfdRight: [0.37, 1.075, -0.924] as const,
  tactical: [0, 0.78, -0.789] as const,
  gauges: [
    [-0.48, 1.362, -1.055],
    [-0.16, 1.362, -1.055],
    [0.16, 1.362, -1.055],
    [0.48, 1.362, -1.055],
  ] as const,
  stick: [0.125, 0.5, 0.34] as const,
  throttle: [
    [-0.55, 1.08, -0.16],
    [-0.51, 1.08, -0.16],
  ] as const,
}

let cache: Promise<Object3D | null> | null = null

function load(): Promise<Object3D | null> {
  cache ??= new GLTFLoader()
    .loadAsync(`${import.meta.env.BASE_URL}models/f22/cockpit.glb`)
    .then((gltf) => gltf.scene as Object3D)
    .catch((err) => {
      console.warn('Fighter cockpit model failed to load; the box-built deck stays', err)
      return null
    })
  return cache
}

export interface FighterModelHandle {
  dispose(): void
}

/** Add the model to `parent` (its origin at the pilot's eye) as soon as it has loaded, then call `onReady`. */
export function attachFighterModel(parent: Group, envMap: Texture | null, isDisposed: () => boolean, onReady: () => void): FighterModelHandle {
  let group: Group | null = null
  const own: Material[] = []
  const extra: { dispose(): void }[] = []
  void load().then((template) => {
    if (!template || isDisposed()) return
    const g = new Group()
    g.name = 'fighter-cockpit-model'
    g.position.set(-FIGHTER.eye[0], -FIGHTER.eye[1], -FIGHTER.eye[2])
    const body = template.clone(true)
    body.traverse((o) => {
      const mesh = o as Mesh
      if (!mesh.isMesh) return
      mesh.frustumCulled = false
      // Own copies of the materials, so the shared model is never changed and these can be disposed with the deck.
      const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((m) => {
        const s = (m as MeshStandardMaterial).clone()
        own.push(s)
        if (s.envMapIntensity !== undefined && !s.emissiveMap && s.emissive.getHex() === 0) {
          // The same soft interior light as the other decks, so the panels have shape; and darker than the raw colours,
          // which are meant for a dim cabin, not for a sun-lit scene.
          s.envMap = envMap
          s.envMapIntensity = 0.3
          s.color.multiplyScalar(0.55)
          if (!envMap) {
            s.emissive.copy(s.color)
            s.emissiveIntensity = 0.3
          }
        }
        return s as Material
      })
      mesh.material = Array.isArray(mesh.material) ? mats : mats[0]
    })
    g.add(body)
    // The canopy: a faint glass bubble round the pilot (the eye is inside it) and the frame bows behind and beside him. There is no
    // bow ahead: from this eye point it would cross the view.
    const glass = new SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2)
    const glassMat = new MeshBasicMaterial({ color: 0xa9d0ff, transparent: true, opacity: 0.035, side: DoubleSide, depthWrite: false, toneMapped: false, fog: false })
    const bubble = new ThreeMesh(glass, glassMat)
    bubble.scale.set(0.72, 1.05, 1.6)
    bubble.position.set(0, 0.95, 0.2)
    bubble.renderOrder = 4
    bubble.frustumCulled = false
    g.add(bubble)
    const bowGeo = new TorusGeometry(1, 0.011, 8, 40, Math.PI)
    const bowMat = new StdMat({ color: 0x2a2f33, roughness: 0.5, metalness: 0.6 })
    own.push(bowMat)
    // The windscreen's top frame well ahead of the eye (high enough to sit above the HUD), then bows behind the pilot.
    const bows: [number, number, number][] = [[-0.25, 0.62, 1.25], [1.2, 0.69, 0.93], [1.6, 0.59, 0.68], [2.0, 0.49, 0.43]]
    for (const [z, sx, sy] of bows) {
      const bow = new ThreeMesh(bowGeo, bowMat)
      bow.scale.set(sx, sy, 1)
      bow.position.set(0, 1.0, z)
      bow.frustumCulled = false
      g.add(bow)
    }
    // A seat back and headrest, so that looking behind shows a seat rather than the empty tub; low enough to see over.
    const seatGeo = new BoxGeometry(1, 1, 1)
    const seatMat = new StdMat({ color: 0x23272b, roughness: 0.85, metalness: 0.1 })
    own.push(seatMat)
    for (const [x, y, z, w, h, d] of [[0, 0.95, 1.18, 0.6, 1.0, 0.16], [0, 1.58, 1.16, 0.3, 0.26, 0.12]] as const) {
      const m = new ThreeMesh(seatGeo, seatMat)
      m.position.set(x, y, z)
      m.scale.set(w, h, d)
      m.frustumCulled = false
      g.add(m)
    }
    extra.push(seatGeo)
    extra.push(glass, glassMat, bowGeo)
    parent.add(g)
    group = g
    onReady()
  })
  return {
    dispose() {
      group?.removeFromParent()
      group = null
      for (const m of own) m.dispose()
      own.length = 0
      for (const e of extra) e.dispose()
      extra.length = 0
    },
  }
}
