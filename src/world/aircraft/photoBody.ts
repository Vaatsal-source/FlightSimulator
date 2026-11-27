/**
 * Photographic airframes for the airliners and the business jet (Sketchfab models, see public/models/aircraft/LICENSE-*.txt and
 * the README credits), fitted over the procedural rigs: they replace the fuselage, wings, tail and engines, and the rig keeps
 * its lights. Where the model has no landing gear of its own (A350, business jet) the rig's animated gear stays.
 * Loaded once per file and shared; until a model arrives (or if it cannot load) the procedural body shows.
 */

import { Box3, DoubleSide, FrontSide, Group, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, SphereGeometry, Vector3, type Material, type Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { useGameStore } from '../../state/gameStore'
import type { JetAssembly } from './jetKit'

export interface PhotoBodyCfg {
  /** File name under public/models/aircraft, and the higher-detail version used on Medium and High quality. */
  file: string
  hiFile?: string
  /** Turns the model's nose to -Z. */
  rotY: number
  /** Where the nose tip and tail end are in the rig's frame (m): the model is scaled to this length. */
  noseZ: number
  tailZ: number
  /** Body-frame y of the ground contact (the wheel bottoms). */
  groundY: number
  /** The model has its own landing gear (shown always); otherwise the rig's animated gear is kept. */
  modelHasGear: boolean
  /** Without model gear: how far the lowest point of the model sits above the wheel contact (m). */
  clearance: number
  /**
   * The model's gear is split into meshes named gear_nose, gear_ml and gear_mr: how they fold. Each axis is the model's own
   * (before rotY); the sign is the turn of the left main leg and of the nose leg.
   */
  gearFold?: { mainAxis: 'x' | 'z'; mainLeftSign: 1 | -1; noseAxis: 'x' | 'z'; noseSign: 1 | -1 }
}

/** Above this many triangles the body does not cast its own shadow (the shadow pass would draw it all again). */
const SHADOW_TRIANGLES = 50000

const cache = new Map<string, Promise<Object3D | null>>()

function load(file: string): Promise<Object3D | null> {
  let p = cache.get(file)
  if (!p) {
    p = new GLTFLoader()
      .loadAsync(`${import.meta.env.BASE_URL}models/aircraft/${file}`)
      .then((gltf) => {
        gltf.scene.traverse((o) => {
          const mesh = o as Mesh
          if (!mesh.isMesh) return
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          for (const m of mats as Material[]) {
            const s = m as MeshStandardMaterial
            if (s.metalness === undefined) continue
            // No environment map in the scene: keep a metal from rendering nearly black.
            s.metalness = Math.min(s.metalness, 0.3)
            s.roughness = Math.max(s.roughness, 0.45)
            if (s.map) {
              s.emissiveMap = s.map
              s.emissive.setScalar(0.2)
            }
          }
        })
        // Landing gear meshes turn about the top of the leg. They share their vertex buffer with the body, so the
        // hinge comes from the gear's own triangles and nothing in the geometry is moved.
        gltf.scene.traverse((o) => {
          const mesh = o as Mesh
          if (!mesh.isMesh || !mesh.name.startsWith('gear_')) return
          const g = mesh.geometry
          const pos = g.attributes.position
          const idx = g.index
          if (!idx) return
          const b = new Box3()
          const v = new Vector3()
          for (let i = 0; i < idx.count; i++) b.expandByPoint(v.fromBufferAttribute(pos, idx.getX(i)))
          mesh.userData.hinge = new Vector3((b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2)
        })
        let tris = 0
        gltf.scene.traverse((o) => {
          const g = (o as Mesh).geometry
          if (g) tris += (g.index ? g.index.count : g.attributes.position.count) / 3
        })
        gltf.scene.userData.triangles = tris
        return gltf.scene as Object3D
      })
      .catch((err) => {
        console.warn(`Aircraft model ${file} failed to load; using the procedural body`, err)
        return null
      })
    cache.set(file, p)
  }
  return p
}

/**
 * The navigation lights (red left, green right, white tail) and the strobes go where the fitted model really has its wing tips and
 * tail, not where the procedural wing was: a model's span rarely matches the rig's.
 */
function placeNavLights(asm: JetAssembly, wrap: Object3D, length: number): void {
  asm.root.updateMatrixWorld(true)
  const toRoot = new Matrix4().copy(asm.root.matrixWorld).invert()
  const m = new Matrix4()
  const v = new Vector3()
  let left: Vector3 | null = null
  let right: Vector3 | null = null
  let top: Vector3 | null = null
  const tipsL: Vector3[] = []
  const tipsR: Vector3[] = []
  const tailTop: Vector3[] = []
  // Pass 1: the extremes (sideways and up).
  let minX = Infinity, maxX = -Infinity, maxY = -Infinity
  const meshes: Mesh[] = []
  wrap.traverse((o) => {
    const mesh = o as Mesh
    if (mesh.isMesh && !mesh.name.startsWith('gear_')) meshes.push(mesh)
  })
  for (const mesh of meshes) {
    m.multiplyMatrices(toRoot, mesh.matrixWorld)
    const pos = mesh.geometry.attributes.position
    for (let i = 0; i < pos.count; i += 2) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m)
      if (v.x < minX) minX = v.x
      if (v.x > maxX) maxX = v.x
      if (v.y > maxY) maxY = v.y
    }
  }
  // Pass 2: where those extremes are (the middle of the tip's chord, and of the top of the tail).
  const tol = length * 0.004
  for (const mesh of meshes) {
    m.multiplyMatrices(toRoot, mesh.matrixWorld)
    const pos = mesh.geometry.attributes.position
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m)
      if (v.x < minX + tol) tipsL.push(v.clone())
      else if (v.x > maxX - tol) tipsR.push(v.clone())
      if (v.y > maxY - tol * 2) tailTop.push(v.clone())
    }
  }
  const mean = (a: Vector3[]) => a.reduce((s, p) => s.add(p), new Vector3()).multiplyScalar(1 / Math.max(1, a.length))
  if (tipsL.length) left = mean(tipsL)
  if (tipsR.length) right = mean(tipsR)
  if (tailTop.length) top = mean(tailTop)
  if (!left || !right || !top) return

  const r = Math.max(0.09, length * 0.0035)
  const ball = new SphereGeometry(r, 10, 8)
  const strobeBall = new SphereGeometry(r * 1.4, 10, 8)
  const mk = (color: number, at: Vector3, geo = ball): Mesh => {
    const mesh = new Mesh(geo, new MeshBasicMaterial({ color, toneMapped: false, fog: false }))
    mesh.position.copy(at)
    mesh.userData.noBounds = true
    asm.root.add(mesh)
    return mesh
  }
  // Just inside the tip, level with the wing.
  mk(0xff2a1a, left.clone().add(new Vector3(r * 1.2, 0, 0)))
  mk(0x22ff55, right.clone().add(new Vector3(-r * 1.2, 0, 0)))
  mk(0xfff6e8, new Vector3(0, top.y, top.z))
  // The strobes replace the procedural ones: white flashes at the tips and the tail.
  if (asm.lampsMesh) asm.lampsMesh.visible = false
  for (const s of asm.strobes) s.visible = false
  asm.strobes.length = 0
  for (const p of [left.clone().add(new Vector3(r * 1.2, r * 1.5, 0)), right.clone().add(new Vector3(-r * 1.2, r * 1.5, 0)), new Vector3(0, top.y + r * 1.6, top.z)]) {
    asm.strobes.push(mk(0xffffff, p, strobeBall))
  }
}

export function attachTransportBody(asm: JetAssembly, cfg: PhotoBodyCfg): void {
  // Everything procedural except the lights, and (when the model has gear) the gear too.
  const keep = new Set<Object3D>()
  if (asm.lampsMesh) keep.add(asm.lampsMesh)
  for (const s of asm.strobes) keep.add(s)
  if (!cfg.modelHasGear) {
    const gear = [...asm.legs.map((l) => l.group), ...asm.doors.map((d) => d.group)]
    for (const g of gear) g.traverse((o) => keep.add(o))
  }
  const hidden: Object3D[] = []
  asm.root.traverse((o) => {
    const mesh = o as Mesh
    if (mesh.isMesh && !keep.has(mesh)) hidden.push(mesh)
  })

  const quality = useGameStore.getState().settings.quality
  void load(quality !== 'low' && cfg.hiFile ? cfg.hiFile : cfg.file).then((template) => {
    if (!template) return
    const wrap = new Group()
    wrap.name = `photo-body-${cfg.file}`
    const inner = new Group()
    inner.rotation.y = cfg.rotY
    inner.add(template.clone(true))
    wrap.add(inner)
    // Scale to the rig's length, then put the nose, the middle and the wheels where the rig has them.
    const box = new Box3()
    const size = new Vector3()
    wrap.updateMatrixWorld(true)
    box.setFromObject(wrap).getSize(size)
    const s = (cfg.tailZ - cfg.noseZ) / size.z
    wrap.scale.setScalar(s)
    wrap.updateMatrixWorld(true)
    box.setFromObject(wrap)
    const cx = (box.min.x + box.max.x) / 2
    wrap.position.set(-cx, (cfg.modelHasGear ? cfg.groundY : cfg.groundY + cfg.clearance) - box.min.y, cfg.noseZ - box.min.z)
    const heavy = (template.userData.triangles as number) > SHADOW_TRIANGLES
    const pivots: { mesh: Mesh; kind: 'nose' | 'ml' | 'mr' }[] = []
    wrap.traverse((o) => {
      const mesh = o as Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = asm.shadows && !heavy
      if (mesh.name.startsWith('gear_') && mesh.userData.hinge) pivots.push({ mesh, kind: mesh.name.slice(5, 7) === 'no' ? 'nose' : mesh.name.slice(5, 7) === 'ml' ? 'ml' : 'mr' })
    })
    // Each gear mesh hangs from a pivot at its hinge, which is what turns and shrinks.
    const gearParts: { mesh: Object3D; kind: 'nose' | 'ml' | 'mr' }[] = []
    for (const { mesh, kind } of pivots) {
      const hinge = mesh.userData.hinge as Vector3
      const pivot = new Group()
      pivot.position.copy(hinge)
      mesh.parent?.add(pivot)
      pivot.add(mesh)
      mesh.position.set(-hinge.x, -hinge.y, -hinge.z)
      gearParts.push({ mesh: pivot, kind })
    }
    // A heavy body casts its shadow through the rig's own simple hull instead (drawn invisibly, shadow pass only).
    if (heavy && asm.shadows) {
      const size = (m: Mesh) => m.geometry.index?.count ?? m.geometry.attributes.position.count
      const hull = (hidden as Mesh[]).filter((o) => o.geometry && o.material === asm.bodyMat).sort((a, b) => size(b) - size(a))[0]
      if (hull) {
        const proxy = new Mesh(hull.geometry, new MeshBasicMaterial({ colorWrite: false, depthWrite: false }))
        proxy.castShadow = true
        proxy.frustumCulled = false
        asm.root.add(proxy)
      }
    }
    asm.root.add(wrap)
    wrap.updateMatrixWorld(true)
    placeNavLights(asm, wrap, cfg.tailZ - cfg.noseZ)
    // The eye sits inside the airframe in the cockpit view; the deck draws its own interior.
    const fold = cfg.gearFold
    // From the cockpit the eye is inside the fuselage: outside faces only, so the wings and engines show through the side windows.
    const skins: MeshStandardMaterial[] = []
    wrap.traverse((o) => {
      const mesh = o as Mesh
      if (mesh.isMesh && !Array.isArray(mesh.material)) skins.push(mesh.material as MeshStandardMaterial)
    })
    asm.extra.push((rs, cockpit) => {
      for (const s of skins) if (s.side !== (cockpit ? FrontSide : DoubleSide)) s.side = cockpit ? FrontSide : DoubleSide
      for (const o of hidden) o.visible = false
      if (!fold) return
      // Gear: t = 0 down, 1 stowed. The leg shrinks towards its hinge while it swings up and in (or back).
      const t = 1 - Math.min(1, Math.max(0, rs.gearPosition))
      for (const { mesh, kind } of gearParts) {
        mesh.scale.setScalar(1 - 0.85 * t)
        mesh.visible = t < 0.98
        mesh.rotation.set(0, 0, 0)
        const angle = (Math.PI / 2) * 0.95 * t
        if (kind === 'nose') mesh.rotation[fold.noseAxis] = fold.noseSign * angle
        else mesh.rotation[fold.mainAxis] = (kind === 'ml' ? fold.mainLeftSign : -fold.mainLeftSign) * angle
      }
    })
    for (const o of hidden) o.visible = false
  })
}
