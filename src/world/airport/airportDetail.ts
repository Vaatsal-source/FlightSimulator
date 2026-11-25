/**
 * The architecture and clutter of an airport, as pure data in the airport's
 * local frame (x = across, right of the primary runway's heading; z = -along):
 * glass curtain walls, roof plant, a landside canopy, a car park, tower and
 * hangar details, fuel tanks, apron floodlights, stand and hold-short
 * markings, ground vehicles, cars and the slots where aircraft are parked.
 * Deterministic per airport.
 */

import type { AirportDef } from '../../config/airports'
import { airportFrame, airportLayout, airportRunways, toLocal } from '../../game/airportGeometry'
import { mulberry32 } from '../util/random'
import type { BuildingPlacement, LightPlacement, Rgb } from './plan'

/** Distance between gates along the apron (m). */
export const GATE_PITCH = 75

export interface DetailBox {
  cx: number
  cz: number
  w: number
  d: number
  y0: number
  h: number
  color: Rgb
}

export interface DetailCylinder {
  cx: number
  cz: number
  r: number
  y0: number
  h: number
  color: Rgb
}

export type PropKind = 'fuelTruck' | 'tractor' | 'cart' | 'bus' | 'loader' | 'gpu' | 'tug' | 'fireTruck' | 'van' | 'car'

export interface Prop {
  kind: PropKind
  x: number
  z: number
  /** Rotation about Y (rad); 0 points along +z. */
  rotY: number
  /** Tint multiplier for cars and vans (0xRRGGBB). */
  tint?: number
}

export interface ParkedSlot {
  x: number
  z: number
  /** Index into the traffic models (a320, b737, b787, a350). */
  model: number
  /** Gate number along the apron, relative to the player's stand. */
  gate: number
}

export interface AirportDetail {
  boxes: DetailBox[]
  cylinders: DetailCylinder[]
  props: Prop[]
  parked: ParkedSlot[]
  lights: LightPlacement[]
}

const GLASS: Rgb = [0.1, 0.18, 0.28]
const FRAME: Rgb = [0.84, 0.86, 0.88]
const ROOF: Rgb = [0.5, 0.52, 0.55]
const ASPHALT: Rgb = [0.2, 0.2, 0.21]
const YELLOW: Rgb = [0.92, 0.76, 0.1]
const WHITE: Rgb = [0.92, 0.92, 0.9]
const DARK: Rgb = [0.12, 0.13, 0.15]
const TANK: Rgb = [0.88, 0.88, 0.85]
const CAR_COLOURS = [0xc0c4c8, 0x202428, 0x7a1f1f, 0x1f3a6a, 0xe6e6e0, 0x4a4f55, 0x2d5a3a, 0xb8860b]

export function buildAirportDetail(a: AirportDef, buildings: readonly BuildingPlacement[]): AirportDetail {
  const out: AirportDetail = { boxes: [], cylinders: [], props: [], parked: [], lights: [] }
  const lay = airportLayout(a)
  const rr = airportFrame(a)
  const primary = airportRunways(a)[0]
  const ap = toLocal(rr, lay.apron.cx, lay.apron.cz)
  const tw = toLocal(rr, lay.taxiway.cx, lay.taxiway.cz)
  const apronFar = ap.across + lay.apron.width / 2
  const standAlong = -0.22 * lay.apron.length
  const rnd = mulberry32(hashString(a.id))
  const box = (cx: number, cz: number, w: number, d: number, y0: number, h: number, color: Rgb) => out.boxes.push({ cx, cz, w, d, y0, h, color })
  const L = (along: number, across: number) => ({ x: across, z: -along })

  const terminals = buildings.filter((b) => b.kind === 'terminal')
  const mainTerminal = terminals.length > 0 ? terminals.reduce((m, b) => (b.depth * b.width > m.depth * m.width ? b : m)) : null

  // ---- Terminal architecture ----------------------------------------------------
  if (mainTerminal) {
    const t = mainTerminal
    const xFace = t.x - t.width / 2 // the face towards the apron
    const xBack = t.x + t.width / 2
    const floors = Math.max(1, Math.round(t.height / 5))
    const top = floors * 5
    // Curtain wall: dark glass bands, white spandrels, vertical mullions.
    for (let f = 0; f < floors; f++) {
      box(xFace - 0.2, t.z, 0.3, t.depth, f * 5 + 0.6, 4.1, GLASS)
      box(xFace - 0.3, t.z, 0.5, t.depth, f * 5 + 4.7, 0.5, FRAME)
    }
    box(xFace - 0.3, t.z, 0.5, t.depth, 0, 0.6, FRAME)
    for (let z = t.z - t.depth / 2; z <= t.z + t.depth / 2 + 0.01; z += 5) box(xFace - 0.35, z, 0.5, 0.45, 0.2, top, FRAME)
    // Roof edge, a long skylight and rooftop plant.
    box(t.x, t.z, t.width + 1, t.depth + 1, t.height, 0.8, FRAME)
    box(t.x - t.width * 0.12, t.z, 8, t.depth * 0.88, t.height + 0.8, 0.5, [0.55, 0.72, 0.86])
    for (let z = t.z - t.depth / 2 + 30; z < t.z + t.depth / 2 - 20; z += 38 + rnd() * 18) {
      box(t.x + t.width * 0.22, z, 7 + rnd() * 4, 4 + rnd() * 3, t.height + 0.8, 1.8 + rnd() * 1.4, ROOF)
    }
    // Landside: a drop-off canopy on columns, and a road with a dashed centreline.
    box(xBack + 8, t.z, 16, t.depth, 5.6, 0.6, WHITE)
    for (let z = t.z - t.depth / 2 + 10; z <= t.z + t.depth / 2; z += 24) box(xBack + 14.5, z, 0.9, 0.9, 0, 5.6, ROOF)
    box(xBack + 30, t.z, 13, t.depth + 160, 0.02, 0.04, ASPHALT)
    for (let z = t.z - t.depth / 2 - 70; z < t.z + t.depth / 2 + 70; z += 14) box(xBack + 30, z, 0.3, 6, 0.07, 0.03, WHITE)
    // A multi-storey car park with a surface lot beside it.
    const gx = xBack + 90
    const gz = t.z + t.depth * 0.18
    box(gx, gz, 54, 190, 0, 12.4, [0.32, 0.33, 0.35])
    for (const y of [3.9, 7.9, 11.9]) box(gx, gz, 55, 191, y, 0.55, FRAME)
    box(gx, gz, 54.5, 191, 12.4, 0.5, ROOF)
    box(xBack + 90, t.z - t.depth * 0.3, 64, 230, 0.02, 0.04, ASPHALT)
    const lotZ0 = t.z - t.depth * 0.3 - 105
    for (let row = 0; row < 8; row++) {
      for (let z = lotZ0; z < lotZ0 + 210; z += 2.9) {
        if (rnd() < 0.62) out.props.push({ kind: 'car', x: xBack + 90 - 28 + row * 7.6 + (row % 2) * 0.6, z, rotY: 0, tint: CAR_COLOURS[Math.floor(rnd() * CAR_COLOURS.length)] })
      }
    }
    // Pods' stand-side apron furniture: stand markings and floodlights are added below.
  }

  // ---- Tower, hangars ---------------------------------------------------------
  for (const b of buildings) {
    if (b.kind === 'tower-cab') {
      box(b.x, b.z, b.width + 2.4, b.depth + 2.4, b.base + b.height, 0.7, WHITE)
      box(b.x, b.z, 0.7, 0.7, b.base + b.height + 0.7, 15, ROOF)
      box(b.x, b.z, 1.4, 1.4, b.base + b.height + 15.7, 0.9, [0.9, 0.2, 0.15])
      out.lights.push({ x: b.x, y: b.base + b.height + 16.7, z: b.z, color: 'red' })
      box(b.x, b.z, b.width + 0.5, b.depth + 0.5, b.base + 0.8, 0.5, FRAME)
    }
    if (b.kind === 'hangar') {
      // A big door on the apron face and a row of roof lights.
      box(b.x - b.width / 2 - 0.1, b.z, 0.4, b.depth * 0.72, 0, Math.min(b.height - 1, 9), DARK)
      for (let z = b.z - b.depth * 0.36; z <= b.z + b.depth * 0.36 + 0.01; z += b.depth * 0.18) box(b.x - b.width / 2 - 0.15, z, 0.4, 0.5, 0, Math.min(b.height - 1, 9), FRAME)
    }
  }

  // ---- Fuel farm and cargo shed ---------------------------------------------------
  if (a.class === 'international' || a.class === 'regional' || a.class === 'military') {
    const farmZ = -(ap.along - lay.apron.length / 2 - 140)
    const farmX = apronFar + 70
    for (let i = 0; i < 4; i++) {
      const cx = farmX + (i % 2) * 24
      const cz = farmZ + Math.floor(i / 2) * 24
      out.cylinders.push({ cx, cz, r: 9, y0: 0, h: 13, color: TANK })
      out.cylinders.push({ cx, cz, r: 9.3, y0: 12.6, h: 0.7, color: ROOF })
    }
    box(farmX + 12, farmZ + 12, 62, 62, 0.01, 0.2, [0.4, 0.4, 0.38]) // bund
    out.props.push({ kind: 'fuelTruck', x: farmX + 44, z: farmZ + 6, rotY: Math.PI / 2 }, { kind: 'fireTruck', x: apronFar + 95, z: -(ap.along + 40), rotY: 0 })
  }
  if (a.class === 'international') {
    const cz = -(ap.along + lay.apron.length / 2 + 120)
    box(apronFar + 80, cz, 50, 120, 0, 11, [0.62, 0.64, 0.67])
    box(apronFar + 80, cz, 51, 121, 11, 0.6, FRAME)
    for (let i = 0; i < 6; i++) box(apronFar + 54, cz - 50 + i * 20, 0.4, 9, 0, 4, DARK) // dock doors
    out.props.push({ kind: 'van', x: apronFar + 40, z: cz - 20, rotY: Math.PI / 2, tint: 0xf0f0f0 }, { kind: 'van', x: apronFar + 40, z: cz + 30, rotY: Math.PI / 2, tint: 0x1f3a6a })
  }

  // ---- Gates: stands, markings, parked aircraft and their equipment -----------------------
  const gateRange: [number, number] = a.class === 'international' ? [-2, 8] : a.class === 'regional' ? [-1, 3] : [0, -1]
  const standAcross = apronFar - 10 - 2
  for (let k = gateRange[0]; k <= gateRange[1]; k++) {
    const along = standAlong + k * GATE_PITCH
    const nose = L(along - 20, standAcross)
    // The stand: a centreline running out to the stop bar, and the equipment-free outline.
    const centre = L(along - 6, standAcross)
    box(centre.x, centre.z, 0.3, 80, 0.07, 0.03, YELLOW)
    box(nose.x, nose.z, 9, 0.5, 0.07, 0.03, [0.9, 0.2, 0.15])
    box(L(along, standAcross - 19).x, L(along, standAcross - 19).z, 0.3, 46, 0.07, 0.03, YELLOW)
    box(L(along, standAcross + 15).x, L(along, standAcross + 15).z, 0.3, 46, 0.07, 0.03, YELLOW)
    if (k === 0) continue // your stand: the working bridge, and an empty apron for your pushback
    const occupied = rnd() < (a.class === 'international' ? 0.72 : 0.55)
    if (!occupied) continue
    const model = Math.floor(rnd() * 4)
    const p = L(along, standAcross)
    out.parked.push({ x: p.x, z: p.z, model, gate: k })
    // Servicing: fuel truck under the wing, baggage tractor with carts at the rear, power unit at the nose.
    const fuel = L(along + 4, standAcross - 14)
    out.props.push({ kind: 'fuelTruck', x: fuel.x, z: fuel.z, rotY: 0 })
    const tr = L(along + 16, standAcross + 8)
    out.props.push({ kind: 'tractor', x: tr.x, z: tr.z, rotY: Math.PI })
    for (let i = 0; i < 2 + Math.floor(rnd() * 2); i++) {
      const c = L(along + 22 + i * 7, standAcross + 8)
      out.props.push({ kind: 'cart', x: c.x, z: c.z, rotY: Math.PI })
    }
    const gpu = L(along - 14, standAcross + 4)
    out.props.push({ kind: 'gpu', x: gpu.x, z: gpu.z, rotY: 0 })
    if (rnd() < 0.5) {
      const ld = L(along + 9, standAcross + 7)
      out.props.push({ kind: 'loader', x: ld.x, z: ld.z, rotY: Math.PI / 2 })
    }
    if (rnd() < 0.4) {
      const bus = L(along - 4, standAcross - 24)
      out.props.push({ kind: 'bus', x: bus.x, z: bus.z, rotY: Math.PI / 2 })
    }
    if (rnd() < 0.35) {
      const tug = L(along - 18, standAcross - 3)
      out.props.push({ kind: 'tug', x: tug.x, z: tug.z, rotY: 0 })
    }
  }

  // ---- Floodlights along the apron --------------------------------------------------------
  if (gateRange[1] >= gateRange[0]) {
    const mastAcross = tw.across + lay.taxiway.width / 2 + 14
    const from = standAlong + (gateRange[0] - 0.5) * GATE_PITCH
    const to = standAlong + (gateRange[1] + 0.5) * GATE_PITCH
    for (let along = from; along <= to; along += GATE_PITCH * 1.5) {
      const m = L(along, mastAcross)
      box(m.x, m.z, 0.7, 0.7, 0, 24, ROOF)
      box(m.x, m.z, 3.4, 1.1, 24, 0.9, DARK)
      for (const dz of [-1.1, 0, 1.1]) out.lights.push({ x: m.x, y: 24.3, z: m.z + dz, color: 'white' })
    }
  }

  // ---- Hold-short bars across every connector, at the runway side -----------------------------
  const holdAcross = primary.def.width / 2 + 38
  for (const c of lay.connectors) {
    const loc = toLocal(rr, c.cx, c.cz)
    // Only the connectors of the primary runway (the ones on the taxiway side).
    if (loc.across < 0 || Math.abs(loc.across - (primary.def.width / 2 + (tw.across - primary.def.width / 2) / 2)) > 5) continue
    const hl = L(loc.along, holdAcross)
    box(hl.x, hl.z, 0.4, lay.taxiway.width, 0.09, 0.03, YELLOW)
    box(hl.x + 1.2, hl.z, 0.4, lay.taxiway.width, 0.09, 0.03, YELLOW)
  }
  return out
}

function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
