/** Where the gate-departure taxi lights go (pure, so the geometry can be tested). */

import type { TaxiRoute as Route } from '../../game/groundOps'

/** Spacing of the green centreline lights (m). */
export const SPACING = 14
export const STOP_BAR_HALF_WIDTH = 13
export const STOP_BAR_SPACING = 3.5
export const LIGHT_HEIGHT = 0.12

/** Positions of the centreline lights along the route, from the stand to the line-up point. */
export function centrelineLights(route: Route): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = []
  let carry = 0
  for (let i = 0; i < route.points.length - 1; i++) {
    const a = route.points[i]
    const b = route.points[i + 1]
    const len = Math.hypot(b.x - a.x, b.z - a.z)
    for (let s = carry; s < len; s += SPACING) {
      out.push({ x: a.x + ((b.x - a.x) * s) / len, z: a.z + ((b.z - a.z) * s) / len })
      carry = s + SPACING - len
    }
  }
  return out
}

/** Positions of the red stop-bar lights across the connector at the hold-short line. */
export function stopBarLights(route: Route): { x: number; z: number }[] {
  const hold = route.points[route.holdIndex]
  const before = route.points[route.holdIndex - 1]
  // Across the connector: perpendicular to the direction of travel into the hold point.
  const dx = hold.x - before.x
  const dz = hold.z - before.z
  const l = Math.hypot(dx, dz) || 1
  const px = -dz / l
  const pz = dx / l
  const out: { x: number; z: number }[] = []
  // An even row from edge to edge, so it is centred on the hold line whatever the spacing.
  const n = Math.round((2 * STOP_BAR_HALF_WIDTH) / STOP_BAR_SPACING)
  for (let i = 0; i <= n; i++) {
    const t = -STOP_BAR_HALF_WIDTH + (i * 2 * STOP_BAR_HALF_WIDTH) / n
    out.push({ x: hold.x + px * t, z: hold.z + pz * t })
  }
  return out
}
