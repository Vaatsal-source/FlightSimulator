/**
 * Small vertex-coloured models of airport ground vehicles and cars. Each is
 * built on the ground plane with its front towards +z; cars and vans use white
 * body colour so the instance tint shows.
 */

import type { BufferGeometry } from 'three'
import { MeshBuilder } from './meshBuilder'
import type { Rgb } from './plan'
import type { PropKind } from './airportDetail'

const TYRE: Rgb = [0.07, 0.07, 0.08]
const GLASS: Rgb = [0.12, 0.17, 0.22]
const WHITE: Rgb = [0.93, 0.93, 0.92]
const SILVER: Rgb = [0.78, 0.8, 0.82]
const YELLOW: Rgb = [0.95, 0.78, 0.1]
const ORANGE: Rgb = [0.95, 0.45, 0.08]
const RED: Rgb = [0.78, 0.12, 0.1]
const BLUE: Rgb = [0.16, 0.3, 0.55]
const GREY: Rgb = [0.5, 0.52, 0.55]

function wheels(b: MeshBuilder, w: number, zs: number[], r = 0.5, wid = 0.35): void {
  for (const z of zs) for (const s of [-1, 1]) b.box(s * (w / 2 - wid / 2 + 0.05), z, wid, r * 2, 0, r * 2, TYRE)
}

export function vehicleGeometry(kind: PropKind): BufferGeometry {
  const b = new MeshBuilder()
  switch (kind) {
    case 'fuelTruck':
      b.box(0, -0.5, 2.4, 9, 0.7, 0.5, GREY)
      b.box(0, 3.4, 2.4, 2.3, 0.9, 2.0, WHITE)
      b.box(0, 4.3, 2.0, 0.1, 1.9, 0.9, GLASS)
      b.box(0, -1.2, 2.5, 6.4, 1.2, 2.2, SILVER)
      b.box(0, -1.2, 2.52, 6.4, 1.9, 0.5, RED)
      b.box(0, -4.3, 2.0, 0.3, 1.3, 1.0, GREY)
      wheels(b, 2.5, [-3.3, -1.5, 3.2], 0.55)
      break
    case 'tractor':
      b.box(0, 0, 1.5, 2.6, 0.45, 0.9, ORANGE)
      b.box(0, -0.2, 1.4, 1.4, 1.3, 1.2, ORANGE)
      b.box(0, -0.2, 1.5, 1.5, 2.5, 0.1, GREY)
      wheels(b, 1.5, [-0.8, 0.9], 0.38, 0.3)
      break
    case 'cart':
      b.box(0, 0, 1.9, 3.8, 0.35, 0.3, GREY)
      b.box(0, 0, 1.8, 3.4, 0.65, 1.3, [0.55, 0.58, 0.62])
      b.box(0, 0, 1.82, 3.42, 1.55, 0.12, [0.45, 0.47, 0.5])
      wheels(b, 1.9, [-1.4, 1.4], 0.25, 0.2)
      break
    case 'bus':
      b.box(0, 0, 2.6, 11, 0.6, 2.7, WHITE)
      b.box(0, 0, 2.62, 10.4, 1.7, 0.95, GLASS)
      b.box(0, 0, 2.62, 11, 3.0, 0.3, BLUE)
      wheels(b, 2.6, [-3.5, 3.5], 0.5)
      break
    case 'loader':
      b.box(0, 0, 2.3, 5.2, 0.6, 1.3, YELLOW)
      b.box(0, 3.4, 1.6, 4.2, 1.5, 0.25, GREY)
      b.box(0, 5.2, 1.6, 2.2, 2.2, 0.25, GREY)
      b.box(0, -1.6, 2.2, 1.6, 1.9, 1.0, YELLOW)
      wheels(b, 2.3, [-1.6, 1.4], 0.45)
      break
    case 'gpu':
      b.box(0, 0, 1.3, 2.2, 0.4, 1.3, YELLOW)
      b.box(0, -0.2, 1.1, 0.9, 1.7, 0.3, GREY)
      wheels(b, 1.3, [-0.7, 0.7], 0.22, 0.18)
      break
    case 'tug':
      b.box(0, 0, 2.5, 4.6, 0.4, 1.0, ORANGE)
      b.box(0, -0.6, 2.2, 2.0, 1.4, 1.0, ORANGE)
      b.box(0, 0.4, 2.0, 0.1, 1.5, 0.8, GLASS)
      wheels(b, 2.5, [-1.5, 1.6], 0.42, 0.4)
      break
    case 'fireTruck':
      b.box(0, -0.5, 3.0, 10, 0.8, 2.6, RED)
      b.box(0, 4.3, 2.9, 2.4, 0.9, 2.2, RED)
      b.box(0, 5.4, 2.4, 0.1, 1.7, 1.0, GLASS)
      b.box(0, -0.5, 3.02, 9.6, 1.7, 0.4, WHITE)
      b.box(0, -0.5, 0.5, 1.0, 3.4, 0.5, SILVER)
      wheels(b, 3.0, [-3.5, -1.6, 4.2], 0.6)
      break
    case 'van':
      b.box(0, 0, 2.0, 5.4, 0.5, 1.6, WHITE)
      b.box(0, 1.6, 2.0, 2.0, 0.5, 2.1, WHITE)
      b.box(0, 2.6, 1.8, 0.08, 1.4, 0.8, GLASS)
      wheels(b, 2.0, [-1.6, 1.7], 0.38, 0.28)
      break
    case 'car':
      b.box(0, 0, 1.8, 4.3, 0.28, 0.75, WHITE)
      b.box(0, -0.2, 1.6, 2.3, 1.03, 0.65, WHITE)
      b.box(0, -0.2, 1.62, 2.1, 1.1, 0.5, GLASS)
      wheels(b, 1.8, [-1.35, 1.35], 0.3, 0.22)
      break
  }
  return b.build()
}
