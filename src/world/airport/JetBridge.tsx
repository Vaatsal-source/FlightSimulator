import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial } from 'three'
import { getAirport } from '../../config/airports'
import { useGroundStore } from '../../state/groundStore'
import { getTelemetry } from '../../state/telemetry'
import { bridgePose } from './bridgeGeometry'

const TUNNEL_W = 2.9
const TUNNEL_H = 2.7

/**
 * The jet bridge at the player's stand: a rotunda on the terminal pod, three
 * telescoping sections and a cab. Its extension and swing follow the real
 * turnaround state, so it docks at the aircraft's door when the player asks.
 */
export function JetBridge() {
  const route = useGroundStore((s) => s.route)

  const res = useMemo(() => {
    if (!route) return null
    const { base, dir, length, floorY } = route.bridge
    const ground = getAirport(route.airportId).elevation
    const grey = new MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.6, metalness: 0.1 })
    const dark = new MeshStandardMaterial({ color: 0x2a3340, roughness: 0.4, metalness: 0.1 })
    const stripe = new MeshStandardMaterial({ color: 0xe0b44a, roughness: 0.6 })
    const pod = new MeshStandardMaterial({ color: 0xb8c0ca, roughness: 0.8 })
    const light = new MeshStandardMaterial({ color: 0x35ff7a, emissive: 0x35ff7a, emissiveIntensity: 1.5 })
    const geos: BoxGeometry[] = []
    const box = (w: number, h: number, d: number) => {
      const g = new BoxGeometry(w, h, d)
      geos.push(g)
      return g
    }
    const root = new Group()
    root.position.set(base.x, ground, base.z)

    // Terminal pod behind the rotunda (away from the aircraft), and the rotunda itself.
    const podGroup = new Group()
    const ang = Math.atan2(-dir.z, dir.x)
    podGroup.rotation.y = ang
    podGroup.position.set(0, 0, 0)
    const podMesh = new Mesh(box(11, floorY + 4.6, 17), pod)
    podMesh.position.set(-6.8, (floorY + 4.6) / 2, 0)
    podMesh.castShadow = true
    const glass = new Mesh(box(0.2, 2.2, 15), dark)
    glass.position.set(-1.25, floorY + 1.8, 0)
    podGroup.add(podMesh, glass)
    const rotundaGeo = new CylinderGeometry(2.3, 2.3, 3.2, 20)
    const rotunda = new Mesh(rotundaGeo, grey)
    rotunda.position.set(0, floorY + 1.6, 0)
    root.add(podGroup, rotunda)

    // The swinging, extending part.
    const arm = new Group()
    arm.position.set(0, floorY + 1.4, 0)
    const sections = [0, 1, 2].map((i) => {
      const m = new Mesh(box(1, TUNNEL_H * (1 - i * 0.04), TUNNEL_W * (1 - i * 0.07)), grey)
      m.castShadow = true
      const window = new Mesh(box(1.01, 0.5, (TUNNEL_W * (1 - i * 0.07)) + 0.02), dark)
      window.position.set(0, 0.35, 0)
      m.add(window)
      arm.add(m)
      return m
    })
    const cab = new Mesh(box(3.4, 3.0, 3.6), grey)
    const cabStripe = new Mesh(box(3.41, 0.25, 3.62), stripe)
    cabStripe.position.set(0, -0.9, 0)
    const bellows = new Mesh(box(0.9, 2.6, 3.0), dark)
    bellows.position.set(2.1, 0, 0)
    const status = new Mesh(new BoxGeometry(0.3, 0.3, 0.3), light)
    status.position.set(0.2, 1.7, 1.4)
    cab.add(cabStripe, bellows, status)
    arm.add(cab)
    // The support column under the cab.
    const column = new Mesh(box(0.5, floorY + 0.4, 0.5), dark)
    const bogie = new Mesh(box(2.2, 0.5, 0.9), dark)
    arm.add(column, bogie)
    root.add(arm)

    return { root, arm, sections, cab, column, bogie, status, light, geos, mats: [grey, dark, stripe, pod, light], rotundaGeo, floorY, length, dir }
  }, [route])

  useEffect(
    () => () => {
      if (!res) return
      for (const g of res.geos) g.dispose()
      res.rotundaGeo.dispose()
      for (const m of res.mats) m.dispose()
    },
    [res],
  )

  useFrame(() => {
    if (!res) return
    const sv = getTelemetry().ground?.services
    const pose = bridgePose(res.dir, res.length, sv?.bridgeProgress ?? 0)
    res.arm.rotation.y = pose.yaw
    res.sections.forEach((m, i) => {
      const s = pose.sections[i]
      m.scale.set(s.length, 1, 1)
      m.position.set(s.centre, 0, 0)
    })
    res.cab.position.set(pose.cabAt + 1.0, 0, 0)
    res.column.position.set(pose.cabAt - 0.2, -(res.floorY + 1.4) / 2 - 0.4, 0)
    res.bogie.position.set(pose.cabAt - 0.2, -(res.floorY + 1.4) + 0.2, 0)
    // Green once docked with the doors open, amber while moving.
    const docked = sv?.bridge === 'docked'
    res.light.color.set(docked ? 0x35ff7a : 0xffb52e)
    res.light.emissive.set(docked ? 0x35ff7a : 0xffb52e)
  })

  if (!res) return null
  return <primitive object={res.root} />
}
