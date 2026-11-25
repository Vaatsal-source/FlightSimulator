/**
 * Small 2D-canvas helpers shared by the cockpit screens, plus the data the
 * screens read. Everything draws from telemetry; nothing here owns state.
 */

import type { AutopilotTargets } from '../../autopilot/types'
import type { AircraftSpeeds } from '../../config/aircraftCatalog'
import type { Units } from '../../state/gameStore'
import type { TelemetrySnapshot } from '../../state/telemetry'

export type Ctx = CanvasRenderingContext2D

/** Everything a screen needs for one redraw. */
export interface PanelState {
  t: TelemetrySnapshot
  units: Units
  speeds: AircraftSpeeds
  engines: number
  ap: {
    ap: boolean
    athr: boolean
    /** Vertical-mode annunciation, e.g. 'ALT'. */
    vertical: string
    targets: AutopilotTargets
  }
}

export const COL = {
  bg: '#05070b',
  panel: 'rgba(8,10,16,0.78)',
  white: '#f2f4f8',
  dim: '#8b93a3',
  green: '#3cf07a',
  amber: '#ffb52e',
  red: '#ff4b3e',
  cyan: '#4fd8ff',
  magenta: '#ff6bf0',
  sky: '#2e7fd8',
  skyLow: '#6db4f0',
  ground: '#7b5233',
  groundLow: '#4f3320',
  yellow: '#ffd23a',
} as const

export const FONT = "'Consolas','DejaVu Sans Mono','Menlo',monospace"

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
export const fin = (v: number): number => (Number.isFinite(v) ? v : 0)
export const rad = (deg: number): number => (deg * Math.PI) / 180

interface TextOpts {
  size?: number
  color?: string
  align?: CanvasTextAlign
  base?: CanvasTextBaseline
  bold?: boolean
}

export function txt(ctx: Ctx, s: string, x: number, y: number, o: TextOpts = {}): void {
  ctx.font = `${o.bold === false ? '' : 'bold '}${o.size ?? 20}px ${FONT}`
  ctx.fillStyle = o.color ?? COL.white
  ctx.textAlign = o.align ?? 'left'
  ctx.textBaseline = o.base ?? 'middle'
  ctx.fillText(s, x, y)
}

export function line(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, color: string, width = 2): void {
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
}

/** Point on a circle; deg 0 = top, clockwise (matches the 2D instrument overlay). */
export function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = rad(deg)
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)]
}

/** Arc between two compass-style angles (0 = top, clockwise). */
export function arc(ctx: Ctx, cx: number, cy: number, r: number, from: number, to: number, color: string, width: number): void {
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.beginPath()
  ctx.arc(cx, cy, r, rad(from - 90), rad(to - 90))
  ctx.stroke()
}

export function pad3(deg: number): string {
  return String(Math.round(((deg % 360) + 360) % 360) % 360).padStart(3, '0')
}

export function signed(v: number): string {
  return `${v < 0 ? '-' : v > 0 ? '+' : ''}${Math.abs(Math.round(v))}`
}
