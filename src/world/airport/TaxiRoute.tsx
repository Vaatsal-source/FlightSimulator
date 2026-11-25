import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { CircleGeometry, InstancedMesh, MeshBasicMaterial, Object3D } from 'three'
import { getAirport } from '../../config/airports'
import { useGroundStore } from '../../state/groundStore'
import { getTelemetry } from '../../state/telemetry'
import { centrelineLights, LIGHT_HEIGHT, stopBarLights } from './taxiLights'

/**
 * Gate departure: green taxi lights from the stand to the runway, and a red
 * stop bar at the hold-short line. Hidden once the take-off roll starts.
 */
export function TaxiRoute() {
  const route = useGroundStore((s) => s.route)

  const res = useMemo(() => {
    if (!route) return null
    const y = getAirport(route.airportId).elevation + LIGHT_HEIGHT
    const geo = new CircleGeometry(1.1, 12)
    geo.rotateX(-Math.PI / 2)
    const green = new MeshBasicMaterial({ color: 0x35ff7a, toneMapped: false, fog: false })
    const red = new MeshBasicMaterial({ color: 0xff3b30, toneMapped: false, fog: false })
    const line = centrelineLights(route)
    const bar = stopBarLights(route)
    const d = new Object3D()
    const make = (pts: { x: number; z: number }[], mat: MeshBasicMaterial) => {
      const mesh = new InstancedMesh(geo, mat, Math.max(1, pts.length))
      mesh.frustumCulled = false
      pts.forEach((p, i) => {
        d.position.set(p.x, y, p.z)
        d.updateMatrix()
        mesh.setMatrixAt(i, d.matrix)
      })
      mesh.instanceMatrix.needsUpdate = true
      return mesh
    }
    return { geo, green, red, line: make(line, green), bar: make(bar, red) }
  }, [route])

  useEffect(
    () => () => {
      if (!res) return
      res.geo.dispose()
      res.green.dispose()
      res.red.dispose()
      res.line.dispose()
      res.bar.dispose()
    },
    [res],
  )

  useFrame(() => {
    if (!res) return
    const g = getTelemetry().ground
    const phase = g?.phase
    const arrival = route?.kind === 'arrival'
    const show = phase !== undefined && (arrival ? phase === 'vacating' || phase === 'taxiIn' || phase === 'parking' : phase !== 'takeoff' && phase !== 'airborne')
    res.line.visible = show
    // The stop bar belongs to departures, and goes dark once the tower has cleared the take-off.
    res.bar.visible = show && !arrival && g?.cleared !== true
  })

  if (!res) return null
  return (
    <group name="taxi-route">
      <primitive object={res.line} />
      <primitive object={res.bar} />
    </group>
  )
}
