import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Group, MeshStandardMaterial, type Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { QualityProfile } from '../../config/quality'
import type { TerrainSampler } from '../../simulation/types'
import { useGameStore } from '../../state/gameStore'
import { modelScale, trafficModelFor, type TrafficModelId } from './trafficModels'
import { TrafficPlanner, type TrafficPose } from './trafficPlan'

const DEG = Math.PI / 180

interface Plane {
  index: number
  holder: Group
}

function disposeTree(root: Object3D): void {
  root.traverse((o) => {
    const mesh = o as { geometry?: { dispose(): void }; material?: unknown }
    mesh.geometry?.dispose()
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
    for (const m of mats as MeshStandardMaterial[]) {
      m.map?.dispose()
      m.dispose()
    }
  })
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
    const loader = new GLTFLoader()
    const base = `${import.meta.env.BASE_URL}models/traffic/`
    const loaded: Object3D[] = []
    const templates = new Map<TrafficModelId, Object3D>()

    const specs = Array.from({ length: count }, (_, i) => trafficModelFor(i))
    const wanted = [...new Map(specs.map((s) => [s.id, s])).values()]
    void Promise.all(
      wanted.map(async (spec) => {
        try {
          const gltf = await loader.loadAsync(base + spec.file)
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
          if (cancelled) disposeTree(gltf.scene)
          else {
            templates.set(spec.id, gltf.scene)
            loaded.push(gltf.scene)
          }
        } catch (err) {
          console.warn(`Traffic model ${spec.file} failed to load`, err)
        }
      }),
    ).then(() => {
      if (cancelled) return
      const made: Plane[] = []
      specs.forEach((spec, index) => {
        const template = templates.get(spec.id)
        if (!template) return
        const holder = new Group()
        holder.rotation.order = 'YXZ'
        holder.visible = false
        const fit = new Group()
        fit.rotation.y = Math.PI / 2 // the files have their nose along +X
        fit.scale.setScalar(modelScale(spec))
        const inner = template.clone(true) // shares geometry and materials
        inner.position.set(-spec.centreX, -spec.minY, -spec.centreZ)
        fit.add(inner)
        holder.add(fit)
        made.push({ index, holder })
      })
      setPlanes(made)
    })

    return () => {
      cancelled = true
      for (const root of loaded) disposeTree(root)
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
