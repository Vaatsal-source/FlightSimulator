/** Where the parts of a jet bridge are for a given extension (pure, so it can be tested). */

export interface BridgePose {
  /** Yaw of the bridge axis about its rotunda (rad, three.js rotation.y). */
  yaw: number
  /** Length from the rotunda to the end of the cab's floor (m). */
  length: number
  /** Centres and lengths of the telescoping sections along the axis (m from the rotunda). */
  sections: { centre: number; length: number; scale: number }[]
  /** Where the cab sits along the axis. */
  cabAt: number
}

/** The retracted bridge is this fraction of its docked length, and swung this far away from the aircraft. */
export const RETRACTED_FRACTION = 0.5
export const PARKED_SWING = 0.5

const ease = (t: number): number => t * t * (3 - 2 * t)

/**
 * Pose of the bridge: `dir` is the unit vector (x, z) from the rotunda towards
 * the aircraft's door, `progress` 0 (retracted, swung away) .. 1 (docked).
 */
export function bridgePose(dir: { x: number; z: number }, dockedLength: number, progress: number): BridgePose {
  const p = ease(Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0)))
  const length = dockedLength * (RETRACTED_FRACTION + (1 - RETRACTED_FRACTION) * p)
  // three.js: rotation.y = theta maps +X to (cos theta, 0, -sin theta).
  const yaw = Math.atan2(-dir.z, dir.x) + PARKED_SWING * (1 - p)
  const n = 3
  const sections = Array.from({ length: n }, (_, i) => ({
    // Each section is a little longer than its share so they overlap like a telescope.
    centre: ((i + 0.5) * length) / n,
    length: (length / n) * 1.1,
    scale: 1 - i * 0.07,
  }))
  return { yaw, length, sections, cabAt: length }
}
