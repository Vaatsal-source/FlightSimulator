import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useState } from 'react'
import { PMREMGenerator, Quaternion, Vector3 } from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { getAircraft } from '../../config/aircraftCatalog'
import type { AircraftRenderState } from '../../simulation/types'
import { useAutopilotStore } from '../../state/autopilotStore'
import { useGameStore } from '../../state/gameStore'
import { getTelemetry } from '../../state/telemetry'
import { buildCockpit, type Cockpit } from './buildCockpit'
import type { PanelState } from './canvasKit'

const _q = new Quaternion()
const _eye = new Vector3()

/**
 * The 3D flight deck, drawn only in the cockpit view. It is rigid with the
 * aircraft: each frame it takes the aircraft's position and orientation, so
 * the pilot's head (see CameraRig) moves against it.
 */
export function CockpitModel({ renderState }: { renderState: AircraftRenderState }) {
  const id = renderState.aircraftId
  const info = useMemo(() => getAircraft(id), [id])
  // Built in an effect, not in render: React StrictMode runs effect cleanups
  // (which dispose the deck) before re-running the effect, so each run needs a fresh one.
  const gl = useThree((st) => st.gl)
  const [cockpit, setCockpit] = useState<Cockpit | null>(null)
  useEffect(() => {
    // Soft, even interior light (a studio-style environment) so the panels have shape instead of one flat tone.
    const pmrem = new PMREMGenerator(gl)
    const room = new RoomEnvironment()
    const env = pmrem.fromScene(room, 0.04)
    const built = buildCockpit(id, { envMap: env.texture })
    setCockpit(built)
    return () => {
      built.dispose()
      env.dispose()
      room.dispose()
      pmrem.dispose()
      setCockpit(null)
    }
  }, [id, gl])
  const panel = useMemo<PanelState>(
    () => ({
      t: getTelemetry(),
      units: 'imperial',
      speeds: info.speeds,
      engines: info.engines,
      ap: { ap: false, athr: false, vertical: 'ALT', targets: { speed: 0, headingDeg: 0, altitude: 0, verticalSpeed: 0 } },
    }),
    [info],
  )

  useFrame(() => {
    if (!cockpit) return
    const rs = renderState
    _q.set(rs.orientation.x, rs.orientation.y, rs.orientation.z, rs.orientation.w)
    const e = info.geometry.eyePoint
    _eye.set(e.x, e.y, e.z).applyQuaternion(_q)
    cockpit.root.position.set(rs.position.x + _eye.x, rs.position.y + _eye.y, rs.position.z + _eye.z)
    cockpit.root.quaternion.copy(_q)

    const t = getTelemetry()
    const ap = useAutopilotStore.getState()
    panel.t = t
    panel.units = useGameStore.getState().settings.units
    panel.ap.ap = ap.ap
    panel.ap.athr = ap.athr
    panel.ap.vertical = ap.annunciation
    panel.ap.targets = ap.targets
    cockpit.update(panel, { pitch: t.stick.pitch, roll: t.stick.roll, yaw: t.stick.yaw, throttle: t.throttle })
  })

  return cockpit ? <primitive object={cockpit.root} /> : null
}
