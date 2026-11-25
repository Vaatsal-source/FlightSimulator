import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useState } from 'react'
import type { Group } from 'three'
import { getAirport } from '../../config/airports'
import { GroundTraffic as GroundTrafficPlan, type TrafficPose } from '../../game/groundTraffic'
import { useGroundStore } from '../../state/groundStore'
import { getTelemetry } from '../../state/telemetry'
import { instantiateTraffic, loadTrafficTemplate } from './trafficAssets'
import { TRAFFIC_MODELS } from './trafficModels'

const DEG = Math.PI / 180

/**
 * Airliners taxiing to the runway at the player's airport during a gate
 * departure: positions come from the same function the session uses to hold
 * the player behind them and to keep the runway clear.
 */
export function GroundTraffic() {
  const route = useGroundStore((s) => s.route)
  const plan = useMemo(() => (route && route.kind === 'departure' ? new GroundTrafficPlan(route) : null), [route])
  const [planes, setPlanes] = useState<Group[]>([])

  useEffect(() => {
    let cancelled = false
    if (!plan) return
    void Promise.all(
      Array.from({ length: plan.count }, async (_, i) => {
        const spec = TRAFFIC_MODELS[(i + 1) % TRAFFIC_MODELS.length]
        const template = await loadTrafficTemplate(spec)
        if (!template) return null
        const holder = instantiateTraffic(spec, template)
        holder.rotation.order = 'YXZ'
        holder.visible = false
        return holder
      }),
    ).then((made) => {
      if (!cancelled) setPlanes(made.filter((m): m is Group => m !== null))
    })
    return () => {
      cancelled = true
      setPlanes([])
    }
  }, [plan])

  const pose = useMemo<TrafficPose>(
    () => ({ visible: false, x: 0, z: 0, headingDeg: 0, lift: 0, pitchDeg: 0, speed: 0, model: 0, waiting: false, onRunway: false }),
    [],
  )

  useFrame(() => {
    if (!plan || planes.length === 0) return
    const elevation = getAirport(plan.route.airportId).elevation
    const t = getTelemetry().simTime
    planes.forEach((holder, i) => {
      plan.poseAt(i, t, pose)
      holder.visible = pose.visible
      if (!pose.visible) return
      holder.position.set(pose.x, elevation + pose.lift, pose.z)
      holder.rotation.set(pose.pitchDeg * DEG, -pose.headingDeg * DEG, 0)
    })
  })

  return (
    <group name="ground-traffic">
      {planes.map((p, i) => (
        <primitive key={i} object={p} />
      ))}
    </group>
  )
}
