/**
 * Which flight deck each aircraft gets. The deck is built around the pilot's
 * eye point (config/aircraftCatalog), so everything here is eye-relative.
 */

import type { AircraftId } from '../../config/aircraftCatalog'

export type CockpitStyle = 'light' | 'airliner' | 'fighter'
export type ControlKind = 'yoke' | 'sidestick' | 'centrestick'

export interface CockpitSpec {
  style: CockpitStyle
  control: ControlKind
}

const SPECS: Record<AircraftId, CockpitSpec> = {
  trainer: { style: 'light', control: 'yoke' },
  f22: { style: 'fighter', control: 'centrestick' },
  a220: { style: 'airliner', control: 'sidestick' },
  a320: { style: 'airliner', control: 'sidestick' },
  a350: { style: 'airliner', control: 'sidestick' },
  global8000: { style: 'airliner', control: 'yoke' },
}

export function cockpitSpecFor(id: AircraftId): CockpitSpec {
  return SPECS[id]
}

/** Screen size (px) of each live texture. */
export const TEXTURE_SIZE = {
  pfd: { w: 512, h: 512 },
  eicas: { w: 512, h: 256 },
  mcp: { w: 768, h: 96 },
  gauges: { w: 1024, h: 680 },
  hud: { w: 512, h: 512 },
  mfd: { w: 256, h: 256 },
} as const
