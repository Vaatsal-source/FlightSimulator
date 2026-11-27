import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { TerrainSampler } from '../../simulation/types'
import { getTelemetry } from '../../state/telemetry'
import { MeshBuilder } from '../airport/meshBuilder'
import { planScenery, TURBINE, type Road, type Village } from './sceneryPlan'

/** Villages, roads and turbines are only drawn within this range of the camera (m). */
const VILLAGE_RANGE = 9000
const ROAD_RANGE = 8000
const TURBINE_RANGE = 14000
const DEG = Math.PI / 180

function villageGeometry(v: Village, terrain: TerrainSampler): BufferGeometry {
  const b = new MeshBuilder()
  for (const h of v.houses) {
    const y = terrain.heightAt(h.x, h.z) - 0.4
    // A garden plot and a bare yard around each house: they tie the buildings to the ground.
    b.quad(h.x, y + 1.0, h.z, h.w + 14, h.d + 14, 0, [0.36, 0.5, 0.26])
    b.quad(h.x, y + 1.05, h.z, h.w + 5, h.d + 5, 0, [0.58, 0.52, 0.42])
    b.gable(h.x, h.z, h.w, h.d, y, h.h + 0.4, h.ridge, h.color)
  }
  if (v.landmark) {
    const l = v.landmark
    const y = terrain.heightAt(l.x, l.z) - 0.4
    b.cyl(l.x, l.z, l.r, y, l.h, [0.82, 0.8, 0.76], 10)
    b.gable(l.x, l.z, l.r * 2.4, l.r * 2.4, y + l.h, 0.5, l.r * 1.6, [0.7, 0.3, 0.26])
  }
  return b.build()
}

/** A ribbon draped over the ground along the road's points. */
function roadGeometry(r: Road, terrain: TerrainSampler): BufferGeometry {
  const half = 3
  const pos: number[] = []
  const col: number[] = []
  const nor: number[] = []
  const idx: number[] = []
  const pts = r.pts
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const q = pts[Math.min(pts.length - 1, i + 1)]
    const o = pts[Math.max(0, i - 1)]
    let dx = q.x - o.x
    let dz = q.z - o.z
    const l = Math.hypot(dx, dz) || 1
    dx /= l
    dz /= l
    for (const s of [-1, 1]) {
      const x = p.x - dz * half * s
      const z = p.z + dx * half * s
      // Above the terrain mesh, which is coarser than the sampler between its vertices.
      pos.push(x, terrain.heightAt(x, z) + 0.9, z)
      nor.push(0, 1, 0)
      col.push(0.34, 0.33, 0.32)
    }
    if (i > 0) {
      const k = i * 2
      idx.push(k - 2, k - 1, k, k - 1, k + 1, k)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3))
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3))
  g.setIndex(idx)
  g.computeBoundingSphere()
  return g
}

interface Built {
  villages: { mesh: Mesh; x: number; z: number }[]
  roads: { mesh: Mesh; x: number; z: number }[]
  towers: Mesh | null
  rotors: InstancedMesh | null
  turbinePos: { x: number; y: number; z: number }[]
  masts: Mesh | null
  beacons: InstancedMesh | null
  disposables: { dispose(): void }[]
}

function build(terrain: TerrainSampler): Built {
  const plan = planScenery(terrain)
  const disposables: { dispose(): void }[] = []
  const wallMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 })
  const roadMat = new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 })
  disposables.push(wallMat, roadMat)

  const villages = plan.villages.map((v) => {
    const geo = villageGeometry(v, terrain)
    disposables.push(geo)
    const mesh = new Mesh(geo, wallMat)
    mesh.name = 'village'
    return { mesh, x: v.x, z: v.z }
  })
  const roads = plan.roads.map((r) => {
    const geo = roadGeometry(r, terrain)
    disposables.push(geo)
    const mesh = new Mesh(geo, roadMat)
    mesh.name = 'road'
    const mid = r.pts[Math.floor(r.pts.length / 2)]
    return { mesh, x: mid.x, z: mid.z }
  })

  // Turbines: all the towers in one mesh, all the rotors instanced.
  const tb = new MeshBuilder()
  const turbinePos: Built['turbinePos'] = []
  for (const t of plan.turbines) {
    const y = terrain.heightAt(t.x, t.z)
    tb.cyl(t.x, t.z, 2.1, y - 1, TURBINE.towerH + 1, [0.92, 0.93, 0.94], 12)
    tb.box(t.x, t.z, 3.2, 7.5, y + TURBINE.towerH - 1.5, 3.2, [0.86, 0.87, 0.9])
    turbinePos.push({ x: t.x, y: y + TURBINE.towerH + 0.5, z: t.z })
  }
  let towers: Mesh | null = null
  let rotors: InstancedMesh | null = null
  if (turbinePos.length > 0) {
    const geo = tb.build()
    disposables.push(geo)
    towers = new Mesh(geo, wallMat)
    towers.frustumCulled = false
    towers.name = 'turbine-towers'
    const parts: BufferGeometry[] = []
    for (let i = 0; i < 3; i++) {
      const blade = new BoxGeometry(1.6, TURBINE.bladeLen, 0.5)
      blade.translate(0, TURBINE.bladeLen / 2 + TURBINE.hubR, 0)
      blade.rotateZ((i * 120 * Math.PI) / 180)
      parts.push(blade)
    }
    const hub = new BoxGeometry(2.4, 2.4, 3.2)
    parts.push(hub)
    const rotorGeo = mergeGeometries(parts, false)
    for (const p of parts) p.dispose()
    const rotorMat = new MeshStandardMaterial({ color: 0xf2f3f4, roughness: 0.6, metalness: 0 })
    disposables.push(rotorGeo, rotorMat)
    rotors = new InstancedMesh(rotorGeo, rotorMat, turbinePos.length)
    rotors.frustumCulled = false
    rotors.name = 'turbine-rotors'
  }

  // Masts with a red light.
  const mb = new MeshBuilder()
  for (const m of plan.masts) {
    const y = terrain.heightAt(m.x, m.z)
    mb.box(m.x, m.z, 2.4, 2.4, y - 1, m.h + 1, [0.8, 0.8, 0.82])
    mb.box(m.x, m.z, 6, 0.6, y + m.h * 0.7, 0.6, [0.7, 0.7, 0.72])
    mb.box(m.x, m.z, 0.6, 6, y + m.h * 0.45, 0.6, [0.7, 0.7, 0.72])
  }
  let masts: Mesh | null = null
  let beacons: InstancedMesh | null = null
  if (plan.masts.length > 0) {
    const geo = mb.build()
    disposables.push(geo)
    masts = new Mesh(geo, wallMat)
    masts.frustumCulled = false
    masts.name = 'masts'
    const lamp = new BoxGeometry(1.6, 1.6, 1.6)
    const lampMat = new MeshBasicMaterial({ color: 0xff3a2a, toneMapped: false, fog: false })
    disposables.push(lamp, lampMat)
    beacons = new InstancedMesh(lamp, lampMat, plan.masts.length)
    beacons.frustumCulled = false
    const d = new Object3D()
    plan.masts.forEach((m, i) => {
      d.position.set(m.x, terrain.heightAt(m.x, m.z) + m.h + 1, m.z)
      d.updateMatrix()
      beacons!.setMatrixAt(i, d.matrix)
    })
    beacons.name = 'mast-beacons'
  }
  return { villages, roads, towers, rotors, turbinePos, masts, beacons, disposables }
}

/** Villages, roads, wind farms and radio masts across the open country. */
export function Scenery({ terrain }: { terrain: TerrainSampler }) {
  const camera = useThree((s) => s.camera)
  const built = useMemo(() => build(terrain), [terrain])
  useEffect(() => () => built.disposables.forEach((d) => d.dispose()), [built])

  const tmp = useMemo(() => new Object3D(), [])

  useFrame(({ clock }) => {
    const p = camera.position
    const near = (x: number, z: number, r: number): boolean => {
      const dx = x - p.x
      const dz = z - p.z
      return dx * dx + dz * dz < r * r
    }
    for (const v of built.villages) v.mesh.visible = near(v.x, v.z, VILLAGE_RANGE)
    for (const r of built.roads) r.mesh.visible = near(r.x, r.z, ROAD_RANGE)
    if (built.rotors) {
      // Rotors turn to face the wind and spin faster in a stronger one.
      const w = getTelemetry().wind
      const yaw = Math.PI - w.fromDeg * DEG
      const spin = clock.elapsedTime * (0.5 + Math.min(w.speed, 14) * 0.07)
      let any = false
      built.turbinePos.forEach((t, i) => {
        if (!near(t.x, t.z, TURBINE_RANGE)) {
          tmp.scale.set(0, 0, 0)
        } else {
          any = true
          tmp.scale.set(1, 1, 1)
        }
        tmp.position.set(t.x, t.y, t.z)
        tmp.rotation.set(0, yaw, 0)
        tmp.rotateZ(spin + i * 0.9)
        tmp.updateMatrix()
        built.rotors!.setMatrixAt(i, tmp.matrix)
      })
      built.rotors.instanceMatrix.needsUpdate = any || built.rotors.instanceMatrix.needsUpdate
    }
    if (built.beacons) {
      // A slow red flash.
      built.beacons.visible = Math.floor(clock.elapsedTime * 0.9) % 2 === 0
    }
  })

  return (
    <group name="scenery">
      {built.villages.map((v, i) => (
        <primitive key={`v${i}`} object={v.mesh} />
      ))}
      {built.roads.map((r, i) => (
        <primitive key={`r${i}`} object={r.mesh} />
      ))}
      {built.towers && <primitive object={built.towers} />}
      {built.rotors && <primitive object={built.rotors} />}
      {built.masts && <primitive object={built.masts} />}
      {built.beacons && <primitive object={built.beacons} />}
    </group>
  )
}

