import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import type { Group } from 'three'
import type { QualityProfile } from '../../config/quality'
import type { TerrainSampler } from '../../simulation/types'
import type { TimeOfDay, Weather } from '../types'
import { TerrainStreamer } from './terrainStreamer'
import { TerrainTrees } from './TerrainTrees'
import { createTerrainMaterial } from './terrainMaterial'

/**
 * Streamed, level-of-detail terrain of the 100 km world plus its trees.
 * The finest level (within at least 1.5 km of the camera) is exactly the
 * WORLD.physicsGridStep grid that `terrain` (the shared sampler) describes,
 * so the ground drawn near the aircraft is the ground physics collides with.
 * Chunk geometry is built in Web Workers; see terrainStreamer.ts.
 */
export function TerrainSystem({
  terrain,
  profile,
  weather = 'clear',
  timeOfDay = 'noon',
}: {
  terrain: TerrainSampler
  profile: QualityProfile
  weather?: Weather
  timeOfDay?: TimeOfDay
}) {
  const { terrainViewDistance, terrainLodBias, shadows } = profile
  const material = useMemo(() => createTerrainMaterial(profile.terrainDetail), [profile.terrainDetail])
  const root = useRef<Group>(null)
  const streamer = useRef<TerrainStreamer | null>(null)

  // Created in an effect (not a memo) so StrictMode's mount / unmount / mount
  // cycle gets a fresh streamer with live workers.
  useEffect(() => {
    const s = new TerrainStreamer({
      material,
      viewDistance: terrainViewDistance,
      lodBias: terrainLodBias,
      receiveShadow: shadows,
    })
    streamer.current = s
    const group = root.current
    group?.add(s.group)
    return () => {
      group?.remove(s.group)
      s.dispose()
      if (streamer.current === s) streamer.current = null
    }
  }, [material, terrainViewDistance, terrainLodBias, shadows])

  useEffect(() => () => material.dispose(), [material])

  // Default priority (0): runs after the camera rig, which is mounted earlier.
  // Cloud shadows need a sun and clouds: strong on a clear day, soft under overcast, none in fog or at night.
  // Off: the old ground look has no cloud shadows (and skipping them saves two noise lookups per pixel).
  void weather
  void timeOfDay
  const shade = 0
  useFrame(({ camera, clock }) => {
    streamer.current?.update(camera.position.x, camera.position.y, camera.position.z)
    const live = material.userData.live as { uTime: { value: number }; uCloudShade: { value: number } } | undefined
    if (live) {
      live.uTime.value = clock.elapsedTime
      live.uCloudShade.value = shade
    }
  })

  return (
    <group ref={root} name="terrain-system">
      <TerrainTrees terrain={terrain} profile={profile} />
    </group>
  )
}
