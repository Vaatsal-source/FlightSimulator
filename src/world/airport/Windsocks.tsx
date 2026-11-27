import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { CylinderGeometry, DoubleSide, Group, Mesh, MeshStandardMaterial } from 'three'
import { AIRPORTS, type AirportDef } from '../../config/airports'
import { getTelemetry } from '../../state/telemetry'
import { buildAirportPlan } from './plan'

const DEG = Math.PI / 180
const SHOW_RANGE = 6000
const BANDS = 5
const BAND_LEN = 1.1

interface Sock {
  airport: AirportDef
  root: Group
  /** Turns to point downwind. */
  yaw: Group
  /** Lifts the tail: hangs down in calm air, flies level in a stiff wind. */
  tilt: Group
  /** Current smoothed state. */
  heading: number
  lift: number
}

/** One windsock on its pole at the field's windsock position. */
function buildSock(a: AirportDef, geos: CylinderGeometry[], mats: MeshStandardMaterial[], pole: Mesh): Sock {
  const plan = buildAirportPlan(a)
  const root = new Group()
  root.position.set(a.center.x, a.elevation, a.center.z)
  root.rotation.y = -a.runways[0].headingDeg * DEG
  const stand = new Group()
  stand.position.set(plan.windsock.x, 0, plan.windsock.z)
  root.add(stand)
  const p = pole.clone()
  p.position.y = 4
  stand.add(p)
  const yaw = new Group()
  yaw.position.y = 7.8
  stand.add(yaw)
  const tilt = new Group()
  yaw.add(tilt)
  geos.forEach((g, i) => {
    const m = new Mesh(g, mats[i % 2])
    m.rotation.z = -Math.PI / 2 // cone axis along +x
    m.position.x = BAND_LEN * (i + 0.5)
    tilt.add(m)
  })
  return { airport: a, root, yaw, tilt, heading: 0, lift: 0 }
}

/** An animated windsock at every airfield, flying in the simulated wind. */
export function Windsocks() {
  const camera = useThree((s) => s.camera)
  const { socks, disposables } = useMemo(() => {
    const geos: CylinderGeometry[] = []
    for (let i = 0; i < BANDS; i++) {
      const r0 = 0.62 - i * 0.09
      const r1 = r0 - 0.09
      geos.push(new CylinderGeometry(r1, r0, BAND_LEN, 10, 1, true))
    }
    const mats = [
      new MeshStandardMaterial({ color: 0xff6a1a, side: DoubleSide, roughness: 0.9 }),
      new MeshStandardMaterial({ color: 0xf4f4f4, side: DoubleSide, roughness: 0.9 }),
    ]
    const poleGeo = new CylinderGeometry(0.12, 0.18, 8, 8)
    const poleMat = new MeshStandardMaterial({ color: 0xd9d9d9, roughness: 0.6 })
    const pole = new Mesh(poleGeo, poleMat)
    return {
      socks: AIRPORTS.filter((a) => a.class !== 'carrier').map((a) => buildSock(a, geos, mats, pole)),
      disposables: [...geos, ...mats, poleGeo, poleMat],
    }
  }, [])

  useEffect(() => () => disposables.forEach((d) => d.dispose()), [disposables])

  useFrame((_, dt) => {
    const w = getTelemetry().wind
    // The air moves towards fromDeg + 180; world +x east, +z south.
    const toward = (w.fromDeg + 180) * DEG
    const dx = Math.sin(toward)
    const dz = -Math.cos(toward)
    const worldYaw = Math.atan2(-dz, dx)
    const target = Math.min(1, w.speed / 5)
    const k = 1 - Math.exp(-dt * 1.8)
    const p = camera.position
    for (const s of socks) {
      const ddx = s.airport.center.x - p.x
      const ddz = s.airport.center.z - p.z
      s.root.visible = ddx * ddx + ddz * ddz < SHOW_RANGE * SHOW_RANGE
      if (!s.root.visible) continue
      // Shortest-way blend of the heading.
      let diff = worldYaw - s.heading
      diff = Math.atan2(Math.sin(diff), Math.cos(diff))
      s.heading += diff * k
      s.lift += (target - s.lift) * k
      s.yaw.rotation.y = s.heading - s.root.rotation.y
      s.tilt.rotation.z = -(1 - s.lift) * 1.35
    }
  })

  return (
    <group name="windsocks">
      {socks.map((s) => (
        <primitive key={s.airport.id} object={s.root} />
      ))}
    </group>
  )
}
