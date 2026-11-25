import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { Color, Group, InstancedMesh, MeshStandardMaterial, Object3D, type BufferGeometry } from 'three'
import { AIRPORTS, type AirportDef } from '../../config/airports'
import { instantiateTraffic, loadTrafficTemplate } from '../traffic/trafficAssets'
import { TRAFFIC_MODELS } from '../traffic/trafficModels'
import { buildAirportPlan } from './plan'
import type { Prop, PropKind } from './airportDetail'
import { vehicleGeometry } from './vehicleGeometry'

const DEG = Math.PI / 180
/** Props and parked aircraft are drawn within this distance of the camera (m). */
const SHOW_RANGE = 9000

interface AirportDressing {
  airport: AirportDef
  group: Group
  /** Aircraft parked at the gates (loaded in the background). */
  parked: Group[]
  dispose(): void
}

/** The local frame of an airport's plan, as a group: origin at the field, rotated like the runway. */
function frameGroup(a: AirportDef): Group {
  const g = new Group()
  g.position.set(a.center.x, a.elevation, a.center.z)
  g.rotation.y = -a.runways[0].headingDeg * DEG
  return g
}

function buildDressing(a: AirportDef, material: MeshStandardMaterial, geoms: Map<PropKind, BufferGeometry>): AirportDressing {
  const plan = buildAirportPlan(a)
  const group = frameGroup(a)
  const byKind = new Map<PropKind, Prop[]>()
  for (const p of plan.detail.props) {
    const list = byKind.get(p.kind)
    if (list) list.push(p)
    else byKind.set(p.kind, [p])
  }
  const d = new Object3D()
  const meshes: InstancedMesh[] = []
  for (const [kind, list] of byKind) {
    let geo = geoms.get(kind)
    if (!geo) {
      geo = vehicleGeometry(kind)
      geoms.set(kind, geo)
    }
    const mesh = new InstancedMesh(geo, material, list.length)
    const c = new Color()
    list.forEach((p, i) => {
      d.position.set(p.x, 0, p.z)
      d.rotation.set(0, p.rotY, 0)
      d.updateMatrix()
      mesh.setMatrixAt(i, d.matrix)
      mesh.setColorAt(i, c.set(p.tint ?? 0xffffff))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.name = `props-${kind}`
    mesh.computeBoundingSphere()
    group.add(mesh)
    meshes.push(mesh)
  }

  // Aircraft at the gates: the real airliner models, nose to the terminal-side apron edge.
  const parked: Group[] = []
  let cancelled = false
  for (const slot of plan.detail.parked) {
    const spec = TRAFFIC_MODELS[slot.model % 4]
    void loadTrafficTemplate(spec).then((template) => {
      if (cancelled || !template) return
      const plane = instantiateTraffic(spec, template)
      plane.position.set(slot.x, 0, slot.z)
      plane.rotation.y = Math.PI // nose along +z: towards decreasing 'along'
      group.add(plane)
      parked.push(plane)
    })
  }
  return {
    airport: a,
    group,
    parked,
    dispose() {
      cancelled = true
      for (const m of meshes) m.dispose()
    },
  }
}

/**
 * Ground vehicles, cars and the aircraft parked at the gates, for every
 * airport that has gates. Each airport's dressing is only drawn while the
 * camera is within a few kilometres of it.
 */
export function AirportProps() {
  const camera = useThree((s) => s.camera)
  const { dressings, material, geoms } = useMemo(() => {
    const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.1 })
    const geoms = new Map<PropKind, BufferGeometry>()
    const dressings = AIRPORTS.filter((a) => a.class !== 'short').map((a) => buildDressing(a, material, geoms))
    return { dressings, material, geoms }
  }, [])

  useEffect(
    () => () => {
      for (const d of dressings) d.dispose()
      material.dispose()
      for (const g of geoms.values()) g.dispose()
    },
    [dressings, material, geoms],
  )

  useFrame(() => {
    const p = camera.position
    for (const d of dressings) {
      const dx = d.airport.center.x - p.x
      const dz = d.airport.center.z - p.z
      d.group.visible = dx * dx + dz * dz < SHOW_RANGE * SHOW_RANGE
    }
  })

  return (
    <group name="airport-props">
      {dressings.map((d) => (
        <primitive key={d.airport.id} object={d.group} />
      ))}
    </group>
  )
}
