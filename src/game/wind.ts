/**
 * The wind the sky blows: a strength setting, a direction that depends on the
 * airport (so there is usually some crosswind), and slow gusts. Pure.
 * Directions are where the wind comes FROM, in degrees clockwise from north;
 * the vector is where the air moves TO in the world frame (+X east, +Z south).
 */

export type WindSetting = 'calm' | 'light' | 'moderate' | 'strong'

export const WIND_SETTINGS: readonly WindSetting[] = ['calm', 'light', 'moderate', 'strong']

/** Mean speed of each setting (m/s): about 0, 9, 18 and 30 knots. */
export const WIND_SPEED: Record<WindSetting, number> = { calm: 0, light: 4.5, moderate: 9, strong: 15 }

const KT = 1 / 0.514444

export interface WindState {
  /** The velocity of the air over the ground (m/s). */
  x: number
  z: number
  /** Speed (m/s) and the direction it blows from (deg). */
  speed: number
  fromDeg: number
}

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const norm360 = (d: number): number => ((d % 360) + 360) % 360

/** The prevailing direction at an airport: 20 to 60 degrees off its runway, on a side that depends on the airport. */
export function prevailingFrom(airportId: string, runwayHeadingDeg: number): number {
  const h = hash(airportId)
  const offset = 20 + (h % 41)
  const side = (h >> 8) % 2 === 0 ? 1 : -1
  return norm360(runwayHeadingDeg + side * offset)
}

/** The wind at `timeS` seconds into the flight. */
export function windFor(setting: WindSetting, airportId: string, runwayHeadingDeg: number, timeS: number): WindState {
  const base = WIND_SPEED[setting]
  const from0 = prevailingFrom(airportId, runwayHeadingDeg)
  if (base === 0) return { x: 0, z: 0, speed: 0, fromDeg: from0 }
  // Slow gusts and a slowly veering direction.
  const gust = 1 + 0.16 * Math.sin(timeS * 0.37 + 1.3) + 0.1 * Math.sin(timeS * 0.91 + 0.4)
  const speed = base * gust
  const fromDeg = norm360(from0 + 6 * Math.sin(timeS * 0.05 + 0.7))
  const r = (fromDeg * Math.PI) / 180
  return { x: -speed * Math.sin(r), z: speed * Math.cos(r), speed, fromDeg }
}

/** Components of a wind on a heading (m/s): headwind positive, crosswind positive from the right. */
export function windComponents(w: WindState, headingDeg: number): { headwind: number; crosswind: number } {
  const rel = ((w.fromDeg - headingDeg) * Math.PI) / 180
  return { headwind: w.speed * Math.cos(rel), crosswind: w.speed * Math.sin(rel) }
}

/** "270 at 12 knots", or "calm". */
export function windText(w: WindState): string {
  if (w.speed < 0.5) return 'calm'
  return `${String(Math.round(w.fromDeg / 10) * 10 % 360 || 360).padStart(3, '0')} at ${Math.round(w.speed * KT)} knots`
}
