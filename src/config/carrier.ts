/**
 * The aircraft carrier: a king-sized ship (1.8 x the real Gerald R. Ford class, about 600 m long) anchored in the open sea off the
 * east coast. Pure constants, shared by the airport list, physics (the deck is solid ground) and the model placement.
 *
 * The model (public/models/carrier/carrier.glb, baked by scripts/prepare-carrier.mjs) has its origin on the waterline in the middle of
 * the ship, +Z towards the bow, +X to port. The landing deck is a rectangle on the flight deck, clear of the island.
 */

export const CARRIER_ID = 'carrier'

/** Heading of the bow, and of take-off and landing (deg, 0 = north, 90 = east). */
export const CARRIER_HEADING_DEG = 120

/** Where the middle of the landing deck is (world x/z, m). */
export const CARRIER_DECK_CENTER = { x: 43000, z: -11000 }

export const CARRIER_DECK = {
  /** Height of the flight deck above the sea (m). */
  height: 32.68,
  length: 435,
  width: 46,
  /** The deck's centre, in the ship's frame: this far toward the bow (m) and to port (m, negative = starboard). */
  shipZ: -27.5,
  shipX: -23,
} as const

/** The arresting wires: where along the landing deck they lie (m from the stern end), the slowest touchdown they catch, and how hard they pull (m/s^2). */
export const ARRESTING_GEAR = { from: 30, to: 260, minSpeed: 30, decel: 22 } as const

const rad = (CARRIER_HEADING_DEG * Math.PI) / 180
const fwd = { x: Math.sin(rad), z: -Math.cos(rad) }
const left = { x: -Math.cos(rad), z: -Math.sin(rad) }

/** World position of the ship's origin (on the waterline, amidships), and the y rotation that puts its bow on the heading. */
export const CARRIER_SHIP = {
  x: CARRIER_DECK_CENTER.x - fwd.x * CARRIER_DECK.shipZ - left.x * CARRIER_DECK.shipX,
  z: CARRIER_DECK_CENTER.z - fwd.z * CARRIER_DECK.shipZ - left.z * CARRIER_DECK.shipX,
  rotationY: Math.PI - rad,
}

/** True over the landing deck (a rotated rectangle), with `margin` metres of slack. */
export function onCarrierDeck(x: number, z: number, margin = 0): boolean {
  const dx = x - CARRIER_DECK_CENTER.x
  const dz = z - CARRIER_DECK_CENTER.z
  if (dx > 400 || dx < -400 || dz > 400 || dz < -400) return false
  const along = dx * fwd.x + dz * fwd.z
  const across = dx * -fwd.z + dz * fwd.x
  return Math.abs(along) <= CARRIER_DECK.length / 2 + margin && Math.abs(across) <= CARRIER_DECK.width / 2 + margin
}
