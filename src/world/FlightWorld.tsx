import { QUALITY_PROFILES } from '../config/quality'
import { useMultiplayerStore } from '../state/multiplayerStore'
import { RemoteAircraft } from './remote/RemoteAircraft'
import { AircraftModel } from './aircraft/AircraftModel'
import { Airports } from './airport/Airports'
import { AirportProps } from './airport/AirportProps'
import { Windsocks } from './airport/Windsocks'
import { GroundTraffic } from './traffic/GroundTraffic'
import { JetBridge } from './airport/JetBridge'
import { TaxiRoute } from './airport/TaxiRoute'
import { CameraRig } from './camera/CameraRig'
import { CockpitModel } from './cockpit/CockpitModel'
import { Clouds } from './environment/Clouds'
import { environmentFor } from './environment/constants'
import { Lighting } from './environment/Lighting'
import { Sky } from './environment/Sky'
import { Water } from './environment/Water'
import { Rings } from './rings/Rings'
import { Scenery } from './scenery/Scenery'
import { TerrainSystem } from './terrain/TerrainSystem'
import { TrafficFleet } from './traffic/TrafficFleet'
import type { FlightWorldProps } from './types'

/**
 * The whole 3D scene: sky, lighting, streamed terrain and trees, water,
 * airport, clouds, rings, aircraft and camera. Rendering only: it consumes
 * the physics state.
 *
 * The content is keyed on the quality level, so a quality change unmounts the
 * old subtree (each part disposes its GPU resources in an effect cleanup) and
 * builds a fresh one.
 */
export function FlightWorld(props: FlightWorldProps) {
  return <WorldContent key={props.quality} {...props} />
}

function WorldContent({
  renderState,
  terrain,
  quality,
  cameraMode,
  rings,
  mouseSensitivity,
  timeOfDay,
  weather,
}: FlightWorldProps) {
  const profile = QUALITY_PROFILES[quality]
  const env = environmentFor(timeOfDay, weather)
  // Multiplayer only: the roster is empty in single player, so nothing extra mounts.
  const hasOtherPilots = useMultiplayerStore((s) => s.roster.length > 1)
  return (
    <>
      <fog attach="fog" args={[env.fogColor, profile.fogFar * env.fogScale * 0.25, profile.fogFar * env.fogScale]} />

      {/* The camera rig runs first so everything that follows the camera sees its final pose. */}
      <CameraRig renderState={renderState} terrain={terrain} mode={cameraMode} mouseSensitivity={mouseSensitivity} />
      <Sky timeOfDay={timeOfDay} weather={weather} detail={profile.terrainDetail} />
      <Lighting renderState={renderState} profile={profile} timeOfDay={timeOfDay} weather={weather} />

      <TerrainSystem terrain={terrain} profile={profile} weather={weather} timeOfDay={timeOfDay} />
      <Scenery terrain={terrain} />
      <Water profile={profile} timeOfDay={timeOfDay} weather={weather} />
      <Airports shadows={profile.shadows} />
      <AirportProps />
      <Windsocks />
      <GroundTraffic />
      <TaxiRoute />
      <JetBridge />
      <Clouds profile={profile} timeOfDay={timeOfDay} weather={weather} />
      <TrafficFleet terrain={terrain} profile={profile} />
      {rings && <Rings course={rings} />}
      <AircraftModel renderState={renderState} cameraMode={cameraMode} shadows={profile.shadows} />
      {cameraMode === 'cockpit' && <CockpitModel renderState={renderState} />}
      {hasOtherPilots && <RemoteAircraft terrain={terrain} shadows={profile.shadows} />}
    </>
  )
}
