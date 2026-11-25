import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Group } from 'three'
import type { QualityProfile } from '../../config/quality'
import type { TerrainSampler } from '../../simulation/types'
import { useGameStore } from '../../state/gameStore'
import { instantiateTraffic, loadTrafficTemplate } from './trafficAssets'
import { trafficModelFor } from './trafficModels'
import { TrafficPlanner, type TrafficPose } from './trafficPlan'

const DEG = Math.PI / 180

interface Plane {
  index: number
  holder: Group
}

/**
 * AI airliners flying between the airports (glTF models, positions from
 * TrafficPlanner). They are scenery: no physics and no collision with the
 * player. Count follows the quality profile; aircraft beyond the fog distance
 * are hidden.
 */
export function TrafficFleet({ terrain, profile }: { terrain: TerrainSampler; profile: QualityProfile }) {
  const count = profile.trafficCount
  const planner = useMemo(() => new TrafficPlanner({ seed: 1, heightAt: (x, z) => terrain.heightAt(x, z) }), [terrain])
  const [planes, setPlanes] = useState<Plane[]>([])
  const clock = useRef(0)
  const pose = useRef<TrafficPose>({ visible: false, x: 0, y: 0, z: 0, headingDeg: 0, pitchDeg: 0, bankDeg: 0, onGround: true, speed: 0 })

  useEffect(() => {
    let cancelled = false
    const specs = Array.from({ length: count }, (_, i) => trafficModelFor(i))
    void Promise.all(
      specs.map(async (spec, index) => {
        const template = await loadTrafficTemplate(spec)
        if (!template) return null
        const holder = instantiateTraffic(spec, template)
        holder.rotation.order = 'YXZ'
        holder.visible = false
        return { index, holder }
      }),
    ).then((made) => {
      if (!cancelled) setPlanes(made.filter((m): m is Plane => m !== null))
    })
    return () => {
      cancelled = true
      setPlanes([])
    }
  }, [count])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    // Dev only: lets a script pin an aircraft in front of the camera to inspect it.
    ;(window as unknown as Record<string, unknown>).__flysimTraffic = { planes, planner, time: () => clock.current }
  }, [planes, planner])

  useFrame(({ camera }, dt) => {
    const s = useGameStore.getState()
    if (!s.paused && s.overlay === 'none' && s.screen === 'flight') clock.current += Math.min(dt, 0.1)
    const range2 = profile.fogFar * profile.fogFar
    const p = pose.current
    for (const { index, holder } of planes) {
      if (holder.userData.hold) continue
      planner.poseAt(index, clock.current, p)
      const dx = p.x - camera.position.x
      const dz = p.z - camera.position.z
      if (!p.visible || dx * dx + dz * dz > range2) {
        holder.visible = false
        continue
      }
      holder.visible = true
      holder.position.set(p.x, p.y, p.z)
      holder.rotation.set(p.pitchDeg * DEG, -p.headingDeg * DEG, -p.bankDeg * DEG)
    }
  })

  return (
    <group name="traffic">
      {planes.map((pl) => (
        <primitive key={pl.index} object={pl.holder} />
      ))}
    </group>
  )
}
