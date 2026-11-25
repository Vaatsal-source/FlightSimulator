/**
 * Builds a 3D flight deck around the pilot's eye point. Pure three.js (no
 * React), like the aircraft rigs. The returned root sits at the eye point in
 * the aircraft body frame (+X right, +Y up, nose = -Z): the caller copies the
 * aircraft's pose onto it each frame.
 *
 * The deck is a closed room (floor, ceiling, walls) with openings only where
 * the windows are, so nothing outside can show through a gap. Static parts are
 * merged into one mesh per material; only the screens, textured panels and
 * moving controls are separate. Screens are 2D-canvas textures redrawn when a
 * new telemetry snapshot arrives (~30 Hz).
 */

import {
  AdditiveBlending,
  BoxGeometry,
  type BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  Euler,
  Group,
  LinearFilter,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  SRGBColorSpace,
  type Texture,
  TorusGeometry,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { getAircraft, type AircraftId } from '../../config/aircraftCatalog'
import type { Ctx, PanelState } from './canvasKit'
import { cockpitSpecFor, TEXTURE_SIZE } from './cockpitSpec'
import { drawSixPack } from './dialDraw'
import { drawHud, drawMfd } from './fighterDraw'
import { drawEicas, drawMcp, drawPfd } from './glassDraw'

export interface CockpitControls {
  /** Applied stick and pedal commands, -1..1 (+pitch = pull back). */
  pitch: number
  roll: number
  yaw: number
  /** Throttle lever 0..1. */
  throttle: number
}

export interface CockpitOptions {
  /** Soft interior lighting (a prefiltered environment map). Without it the deck is lit by the scene lights only. */
  envMap?: Texture | null
}

export interface Cockpit {
  /** Position at the eye point (body frame) and copy the aircraft's orientation onto it. */
  root: Group
  update(ps: PanelState, controls: CockpitControls): void
  dispose(): void
}

type Vec = [number, number, number]
type Draw = (ctx: Ctx, w: number, h: number, ps: PanelState) => void

interface Screen {
  ctx: Ctx | null
  texture: CanvasTexture
  material: MeshBasicMaterial
  w: number
  h: number
  draw: Draw
}

/** Dimensions of the cabin around the pilot; everything is relative to the eye. */
interface Shell {
  halfW: number
  floorY: number
  ceilY: number
  backZ: number
  /** Height of the window sill and of the top of the windows. */
  sillY: number
  topY: number
  /** The windscreen leans back: its foot is at noseZ, its top at headerZ. */
  noseZ: number
  headerZ: number
  /** The side window spans sideZ0..sideZ1. */
  sideZ0: number
  sideZ1: number
}

const Y_AXIS = new Vector3(0, 1, 0)
const clamp1 = (v: number): number => Math.max(-1, Math.min(1, Number.isFinite(v) ? v : 0))

export function buildCockpit(id: AircraftId, options: CockpitOptions = {}): Cockpit {
  const info = getAircraft(id)
  const spec = cockpitSpecFor(id)
  const cx = -info.geometry.eyePoint.x // aircraft centreline, relative to the pilot
  const root = new Group()
  root.name = `cockpit-${id}`

  const disposables: { dispose(): void }[] = []
  const track = <T extends { dispose(): void }>(o: T): T => {
    disposables.push(o)
    return o
  }
  const screens: Screen[] = []

  const std = (color: number, roughness = 0.8, metalness = 0.05): MeshStandardMaterial =>
    track(
      new MeshStandardMaterial({
        color,
        roughness,
        metalness,
        envMap: options.envMap ?? null,
        envMapIntensity: 0.42,
        // Without an environment map a faint emissive floor keeps the deck from going black.
        ...(options.envMap ? {} : { emissive: color, emissiveIntensity: 0.3 }),
      }),
    )
  const plastic = std(0x2e3239)
  const trim = std(0x3b404b, 0.6, 0.15)
  const fabric = std(0x4d4e57, 1)
  const leather = std(0x4a3d34, 0.7)
  const glareMat = std(0x1a1c21, 0.9)
  const carpet = std(0x15161a, 1)

  // ---- geometry helpers --------------------------------------------------
  const batches = new Map<Material, BufferGeometry[]>()
  const local = new Matrix4()
  const q = new Quaternion()
  const e = new Euler()
  const one = new Vector3(1, 1, 1)

  /** Adds a static part: baked into the material's merged mesh, or a real mesh under a moving group. */
  const solid = (parent: Object3D, geo: BufferGeometry, mat: Material, p: Vec, r: Vec = [0, 0, 0]): void => {
    if (parent.userData.dynamic) {
      const m = new Mesh(track(geo), mat)
      m.position.set(...p)
      m.rotation.set(...r)
      m.frustumCulled = false
      parent.add(m)
      return
    }
    local.compose(new Vector3(...p), q.setFromEuler(e.set(...r)), one)
    if (parent !== root) local.premultiply(parent.matrix)
    geo.applyMatrix4(local)
    const list = batches.get(mat)
    if (list) list.push(geo)
    else batches.set(mat, [geo])
  }
  const box = (parent: Object3D, w: number, h: number, d: number, mat: Material, p: Vec, r?: Vec): void =>
    solid(parent, new BoxGeometry(w, h, d), mat, p, r)

  /** A bar between two points (w across x, d across z before leaning). */
  const bar = (a: Vec, b: Vec, w: number, d: number, mat: Material = trim): void => {
    const va = new Vector3(...a)
    const dir = new Vector3(...b).sub(va)
    const len = dir.length()
    const geo = new BoxGeometry(w, len, d)
    local.compose(va.clone().addScaledVector(dir, 0.5), new Quaternion().setFromUnitVectors(Y_AXIS, dir.normalize()), one)
    geo.applyMatrix4(local)
    const list = batches.get(mat)
    if (list) list.push(geo)
    else batches.set(mat, [geo])
  }

  /** A separate mesh (own material, texture or transparency). */
  const mesh = (parent: Object3D, geo: BufferGeometry, mat: Material, p: Vec, r: Vec = [0, 0, 0]): Mesh => {
    const m = new Mesh(track(geo), mat)
    m.position.set(...p)
    m.rotation.set(...r)
    m.frustumCulled = false
    parent.add(m)
    return m
  }

  /** A live screen: a canvas texture on a flat plane. */
  const addScreen = (
    parent: Object3D,
    size: { w: number; h: number },
    meters: { w: number; h: number },
    p: Vec,
    draw: Draw,
    r: Vec = [0, 0, 0],
    additive = false,
  ): Screen => {
    const canvas = document.createElement('canvas')
    canvas.width = size.w
    canvas.height = size.h
    const texture = track(new CanvasTexture(canvas))
    texture.colorSpace = SRGBColorSpace
    texture.generateMipmaps = false
    texture.minFilter = LinearFilter
    texture.magFilter = LinearFilter
    const material = track(
      new MeshBasicMaterial({
        map: texture,
        toneMapped: false,
        fog: false,
        ...(additive
          ? { transparent: true, blending: AdditiveBlending, depthWrite: false }
          : { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      }),
    )
    const s: Screen = { ctx: canvas.getContext('2d'), texture, material, w: size.w, h: size.h, draw }
    screens.push(s)
    const m = mesh(parent, new PlaneGeometry(meters.w, meters.h), material, p, r)
    if (additive) m.renderOrder = 5
    return s
  }
  /** Another plane showing an existing screen's texture. */
  const mirrorScreen = (parent: Object3D, s: Screen, meters: { w: number; h: number }, p: Vec, r: Vec = [0, 0, 0]): void => {
    mesh(parent, new PlaneGeometry(meters.w, meters.h), s.material, p, r)
  }

  /** A quiet static panel of switches, knobs and a few indicator lights, drawn once. */
  const switchPanel = (cols: number, rows: number, seed: number, lit: boolean, aspect = 2): MeshBasicMaterial => {
    const canvas = document.createElement('canvas')
    // Match the plane's proportions so the cells are not stretched.
    const W = Math.max(64, Math.round(aspect >= 1 ? 512 : 512 * aspect))
    const H = Math.max(64, Math.round(aspect >= 1 ? 512 / aspect : 512))
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.fillStyle = '#17191e'
      ctx.fillRect(0, 0, W, H)
      let n = seed
      const rnd = () => ((n = (n * 1664525 + 1013904223) >>> 0) / 4294967296)
      const cw = W / cols
      const rh = H / rows
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = c * cw + cw / 2
          const y = r * rh + rh / 2
          const k = rnd()
          const m = Math.min(cw, rh)
          // Recessed cell with a thin lighter edge.
          ctx.fillStyle = '#20232a'
          ctx.fillRect(x - cw * 0.4, y - rh * 0.4, cw * 0.8, rh * 0.8)
          ctx.fillStyle = '#2b2f38'
          ctx.fillRect(x - cw * 0.4, y - rh * 0.4, cw * 0.8, Math.max(1, rh * 0.06))
          if (k < 0.4) {
            ctx.fillStyle = '#4b515d'
            ctx.fillRect(x - m * 0.07, y - m * 0.2, m * 0.14, m * 0.34)
            ctx.fillStyle = '#6c7380'
            ctx.fillRect(x - m * 0.07, y - m * 0.2, m * 0.14, m * 0.08)
          } else if (k < 0.7) {
            ctx.fillStyle = '#343942'
            ctx.beginPath()
            ctx.arc(x, y, m * 0.24, 0, Math.PI * 2)
            ctx.fill()
            ctx.fillStyle = '#7c8390'
            ctx.fillRect(x - m * 0.03, y - m * 0.24, m * 0.06, m * 0.2)
          } else if (lit && k > 0.9) {
            ctx.fillStyle = k > 0.96 ? '#e8a23a' : '#4ee08a'
            ctx.fillRect(x - m * 0.16, y - m * 0.07, m * 0.32, m * 0.14)
          }
        }
      }
    }
    const texture = track(new CanvasTexture(canvas))
    texture.colorSpace = SRGBColorSpace
    return track(new MeshBasicMaterial({ map: texture, toneMapped: false, fog: false, color: 0xd8d8d8 }))
  }
  /** A textured plane of switches, e.g. a panel face or a console top. */
  const detail = (parent: Object3D, w: number, h: number, p: Vec, r: Vec, cols: number, rows: number, seed: number, lit = false): void => {
    mesh(parent, new PlaneGeometry(w, h), switchPanel(cols, rows, seed, lit, w / h), p, r)
  }
  /** A thin frame a little larger than a screen at the same position; sits just behind it. */
  const bezel = (parent: Object3D, w: number, h: number, p: Vec): void => {
    box(parent, w + 0.03, h + 0.03, 0.004, trim, [p[0], p[1], p[2] - 0.0025])
  }
  /** Faint tint over a window opening so it reads as glass. */
  const glass = (w: number, h: number, p: Vec, r: Vec): void => {
    const m = track(new MeshBasicMaterial({ color: 0xcfe4ff, transparent: true, opacity: 0.05, depthWrite: false, toneMapped: false, fog: false }))
    mesh(root, new PlaneGeometry(w, h), m, p, r).renderOrder = 4
  }

  // ---- moving controls ---------------------------------------------------
  const levers: { mesh: Object3D; baseZ: number; travel: number }[] = []
  const lever = (p: Vec, travel: number): void => {
    const g = new Group()
    g.position.set(...p)
    g.userData.dynamic = true
    solid(g, new BoxGeometry(0.016, 0.09, 0.024), trim, [0, 0.045, 0])
    solid(g, new SphereGeometry(0.017, 10, 8), plastic, [0, 0.1, 0])
    root.add(g)
    levers.push({ mesh: g, baseZ: p[2], travel })
  }
  let yoke: Group | null = null
  let yokeBaseZ = 0
  let stick: Group | null = null

  const seat = (x: number, y: number, z: number): void => {
    box(root, 0.52, 0.09, 0.52, leather, [x, y - 0.32, z])
    box(root, 0.52, 0.7, 0.1, leather, [x, y, z + 0.26], [-0.12, 0, 0])
    box(root, 0.3, 0.2, 0.08, leather, [x, y + 0.42, z + 0.31])
  }
  const makeYoke = (p: Vec, radius: number): Group => {
    const g = new Group()
    g.position.set(...p)
    g.userData.dynamic = true
    yokeBaseZ = p[2]
    solid(g, new CylinderGeometry(0.02, 0.02, 0.4, 8), trim, [0, -0.02, 0.2], [Math.PI / 2, 0, 0])
    const wheel = new Group()
    wheel.userData.dynamic = true
    solid(wheel, new TorusGeometry(radius, 0.014, 8, 24), plastic, [0, 0, 0])
    solid(wheel, new BoxGeometry(radius * 2, 0.03, 0.03), plastic, [0, 0, 0])
    solid(wheel, new BoxGeometry(0.03, radius, 0.03), plastic, [0, -radius / 2, 0])
    wheel.name = 'wheel'
    g.add(wheel)
    root.add(g)
    return g
  }
  const makeStick = (p: Vec, height: number): Group => {
    const g = new Group()
    g.position.set(...p)
    g.userData.dynamic = true
    solid(g, new CylinderGeometry(0.014, 0.018, height, 8), trim, [0, height / 2, 0])
    solid(g, new SphereGeometry(0.03, 10, 8), plastic, [0, height + 0.02, 0])
    root.add(g)
    return g
  }

  /** The closed cabin: floor, ceiling, back wall, side walls and a front wall, open only at the windows. */
  const buildShell = (s: Shell): void => {
    const W = s.halfW * 2
    const midZ = (s.noseZ + s.backZ) / 2
    const len = s.backZ - s.noseZ
    const H = s.ceilY - s.floorY
    const midY = (s.floorY + s.ceilY) / 2
    box(root, W, 0.05, len, carpet, [cx, s.floorY, midZ])
    box(root, W, 0.04, len, fabric, [cx, s.ceilY, midZ])
    box(root, W, H, 0.05, plastic, [cx, midY, s.backZ])
    // Front wall below the glare-shield, and the beam above the windscreen.
    box(root, W, s.sillY - s.floorY, 0.06, plastic, [cx, (s.floorY + s.sillY) / 2, s.noseZ - 0.02])
    box(root, W, s.ceilY - s.topY, 0.24, plastic, [cx, (s.topY + s.ceilY) / 2, s.headerZ - 0.04])
    box(root, W, 0.07, 0.07, trim, [cx, s.topY, s.headerZ])
    for (const sx of [-1, 1]) {
      const x = cx + sx * s.halfW
      // Door panel below the sill, the band above the window, and solid wall behind it.
      box(root, 0.06, s.sillY - s.floorY, len, plastic, [x, (s.floorY + s.sillY) / 2, midZ])
      box(root, 0.06, s.ceilY - s.topY, s.sideZ1 - s.noseZ, plastic, [x, (s.topY + s.ceilY) / 2, (s.noseZ + s.sideZ1) / 2])
      box(root, 0.06, H, s.backZ - s.sideZ1, plastic, [x, midY, (s.sideZ1 + s.backZ) / 2])
      // Window frames: sill, top rail, the corner post of the windscreen and the post behind the side window.
      box(root, 0.07, 0.06, s.sideZ1 - s.noseZ, trim, [x, s.sillY, (s.noseZ + s.sideZ1) / 2])
      box(root, 0.07, 0.06, s.sideZ1 - s.headerZ, trim, [x, s.topY, (s.headerZ + s.sideZ1) / 2])
      bar([x, s.sillY, s.noseZ], [x, s.topY, s.headerZ], 0.06, 0.05)
      bar([x, s.sillY, s.sideZ0], [x, s.topY, s.sideZ0], 0.05, 0.05)
    }
    // Centre post of the windscreen.
    bar([cx, s.sillY, s.noseZ], [cx, s.topY, s.headerZ], 0.055, 0.045)
    // Faint glass tint over the windscreen.
    const lean = Math.atan2(s.headerZ - s.noseZ, s.topY - s.sillY)
    glass(W - 0.1, Math.hypot(s.headerZ - s.noseZ, s.topY - s.sillY), [cx, (s.sillY + s.topY) / 2, (s.noseZ + s.headerZ) / 2], [lean, 0, 0])
  }

  // ---------------------------------------------------------------------
  if (spec.style === 'light') {
    buildShell({ halfW: 0.62, floorY: -0.95, ceilY: 0.38, backZ: 1.05, sillY: -0.12, topY: 0.3, noseZ: -1.1, headerZ: -0.46, sideZ0: 0.1, sideZ1: 0.6 })
    // Instrument panel under a slim glare-shield.
    box(root, 1.24, 0.34, 0.06, plastic, [cx, -0.36, -0.8])
    box(root, 1.24, 0.035, 0.4, glareMat, [cx, -0.185, -1.0])
    bezel(root, 0.48, 0.32, [0, -0.375, -0.768])
    addScreen(root, TEXTURE_SIZE.gauges, { w: 0.48, h: 0.32 }, [0, -0.375, -0.768], drawSixPack)
    detail(root, 0.58, 0.3, [cx + 0.33, -0.375, -0.7695], [0, 0, 0], 12, 6, 11, true) // avionics stack
    detail(root, 0.16, 0.3, [-0.27, -0.375, -0.7695], [0, 0, 0], 4, 6, 4)
    seat(0, -0.15, 0.05)
    seat(cx * 2, -0.15, 0.05)
    box(root, 0.2, 0.14, 0.55, plastic, [cx, -0.55, -0.2]) // pedestal
    lever([cx, -0.48, -0.1], 0.17)
    yoke = makeYoke([0, -0.44, -0.4], 0.11)
  } else if (spec.style === 'airliner') {
    buildShell({ halfW: 1.1, floorY: -1.2, ceilY: 0.76, backZ: 1.9, sillY: -0.1, topY: 0.56, noseZ: -1.15, headerZ: -0.76, sideZ0: -0.3, sideZ1: 0.7 })
    // Main panel, wall to wall, tilted back a little.
    const panel = new Group()
    panel.position.set(cx, -0.52, -1.02)
    panel.rotation.set(-0.3, 0, 0)
    panel.updateMatrix()
    root.add(panel)
    box(panel, 2.2, 0.72, 0.08, plastic, [0, 0, 0])
    detail(panel, 2.14, 0.66, [0, 0, 0.0402], [0, 0, 0], 60, 11, 5)
    // PFD in front of each pilot, EICAS in the middle.
    bezel(panel, 0.37, 0.37, [-cx, 0.1, 0.045])
    bezel(panel, 0.37, 0.37, [cx, 0.1, 0.045])
    bezel(panel, 0.34, 0.17, [0, 0.18, 0.045])
    const pfd = addScreen(panel, TEXTURE_SIZE.pfd, { w: 0.37, h: 0.37 }, [-cx, 0.1, 0.045], drawPfd)
    mirrorScreen(panel, pfd, { w: 0.37, h: 0.37 }, [cx, 0.1, 0.045])
    addScreen(panel, TEXTURE_SIZE.eicas, { w: 0.34, h: 0.17 }, [0, 0.18, 0.045], drawEicas)
    box(panel, 0.37, 0.2, 0.004, trim, [0, -0.01, 0.0425]) // frame of the lower display
    box(panel, 0.34, 0.17, 0.004, glareMat, [0, -0.01, 0.0452]) // the display itself, off
    // Slim glare-shield with the autopilot control strip on it.
    box(root, 2.2, 0.05, 0.28, glareMat, [cx, -0.1, -1.0])
    addScreen(root, TEXTURE_SIZE.mcp, { w: 0.62, h: 0.078 }, [cx, -0.065, -0.95], drawMcp, [-0.75, 0, 0])
    // Overhead panel, side console details, pedestal.
    detail(root, 1.9, 0.6, [cx, 0.738, -0.32], [Math.PI / 2, 0, 0], 40, 10, 7, true)
    for (const sx of [-1, 1]) detail(root, 1.4, 0.5, [cx + sx * 1.065, -0.55, 0.15], [0, -sx * Math.PI / 2, 0], 28, 8, 9 + sx)
    box(root, 0.34, 0.3, 1.1, plastic, [cx, -1.0, -0.1])
    detail(root, 0.3, 0.9, [cx, -0.848, -0.05], [-Math.PI / 2, 0, 0], 8, 20, 3)
    const engines = Math.max(1, info.engines)
    for (let i = 0; i < engines; i++) lever([cx + (i - (engines - 1) / 2) * 0.1, -0.85, -0.02], 0.2)
    seat(0, -0.3, 0.1)
    seat(cx * 2, -0.3, 0.1)
    if (spec.control === 'yoke') yoke = makeYoke([0, -0.58, -0.58], 0.12)
    else {
      stick = makeStick([-0.55, -0.82, -0.1], 0.14)
      box(root, 0.16, 0.12, 0.34, plastic, [-0.55, -0.86, -0.12]) // side console
    }
  } else {
    // Fighter: HUD, three MFDs, canopy arches and rails, closed tub.
    addScreen(root, TEXTURE_SIZE.hud, { w: 0.36, h: 0.36 }, [0, 0.03, -0.9], drawHud, [0, 0, 0], true)
    glass(0.34, 0.34, [0, 0.03, -0.895], [0, 0, 0]) // combiner glass tint
    box(root, 0.34, 0.05, 0.12, glareMat, [0, -0.2, -0.86]) // HUD housing
    box(root, 0.012, 0.24, 0.012, trim, [-0.19, 0.0, -0.9])
    box(root, 0.012, 0.24, 0.012, trim, [0.19, 0.0, -0.9])
    box(root, 0.4, 0.012, 0.012, trim, [0, 0.16, -0.9])
    const panel = new Group()
    panel.position.set(0, -0.3, -0.76)
    panel.rotation.set(-0.28, 0, 0)
    panel.updateMatrix()
    root.add(panel)
    box(panel, 1.3, 0.3, 0.05, plastic, [0, 0, 0])
    detail(panel, 1.26, 0.28, [0, 0, 0.0252], [0, 0, 0], 30, 8, 13)
    bezel(panel, 0.21, 0.21, [0, 0, 0.03])
    bezel(panel, 0.17, 0.17, [-0.29, 0.01, 0.03])
    bezel(panel, 0.17, 0.17, [0.29, 0.01, 0.03])
    const mfd = addScreen(panel, TEXTURE_SIZE.mfd, { w: 0.21, h: 0.21 }, [0, 0.0, 0.03], drawMfd)
    mirrorScreen(panel, mfd, { w: 0.17, h: 0.17 }, [-0.29, 0.01, 0.03])
    mirrorScreen(panel, mfd, { w: 0.17, h: 0.17 }, [0.29, 0.01, 0.03])
    box(root, 1.4, 0.5, 0.5, plastic, [0, -0.62, -0.55])
    // Tub: floor, back wall, side walls up to the canopy rails.
    box(root, 1.5, 0.05, 2.2, carpet, [0, -0.9, 0.0])
    box(root, 1.5, 1.4, 0.05, plastic, [0, -0.2, 1.1])
    // Canopy: front bow, mid bow, rear arch and side rails.
    for (const [z, r] of [
      [-0.95, 0.6],
      [-0.2, 0.7],
      [0.45, 0.72],
    ] as const) solid(root, new TorusGeometry(r, 0.018, 8, 28, Math.PI), trim, [0, -0.12, z])
    for (const sx of [-1, 1]) {
      bar([sx * 0.6, -0.12, -0.95], [sx * 0.7, -0.12, -0.2], 0.04, 0.04)
      bar([sx * 0.7, -0.12, -0.2], [sx * 0.72, -0.12, 0.45], 0.04, 0.04)
      box(root, 0.05, 0.2, 1.7, plastic, [sx * 0.72, -0.2, -0.15]) // sill wall under the rail
      box(root, 0.2, 0.2, 1.3, plastic, [sx * 0.5, -0.34, -0.1]) // side consoles
      detail(root, 0.18, 1.24, [sx * 0.5, -0.2395, -0.1], [-Math.PI / 2, 0, 0], 6, 22, 21 + sx, true)
    }
    box(root, 0.34, 0.5, 0.14, leather, [0, 0.0, 0.5]) // headrest
    box(root, 0.5, 0.1, 0.45, leather, [0, -0.46, 0.15])
    lever([-0.5, -0.235, -0.3], 0.14)
    lever([-0.46, -0.235, -0.3], 0.14)
    stick = makeStick([0, -0.64, -0.3], 0.3)
  }

  // Merge the static parts: one mesh per material.
  for (const [mat, geos] of batches) {
    const merged = mergeGeometries(geos, false)
    for (const g of geos) g.dispose()
    if (!merged) continue
    const m = new Mesh(track(merged), mat)
    m.frustumCulled = false
    root.add(m)
  }
  batches.clear()

  const level = (v: number): number => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0))
  let lastT: PanelState['t'] | null = null

  return {
    root,
    update(ps, c) {
      if (ps.t !== lastT) {
        lastT = ps.t
        for (const s of screens) {
          if (!s.ctx) continue
          s.draw(s.ctx, s.w, s.h, ps)
          s.texture.needsUpdate = true
        }
      }
      const pitch = clamp1(c.pitch)
      const roll = clamp1(c.roll)
      if (yoke) {
        yoke.position.z = yokeBaseZ + pitch * 0.05
        const wheel = yoke.getObjectByName('wheel')
        if (wheel) wheel.rotation.z = -roll * 1.1
      }
      if (stick) {
        stick.rotation.x = pitch * 0.32
        stick.rotation.z = -roll * 0.32
      }
      const thr = level(c.throttle)
      for (const l of levers) l.mesh.position.z = l.baseZ - thr * l.travel
    },
    dispose() {
      for (const d of disposables) d.dispose()
      disposables.length = 0
      screens.length = 0
      root.clear()
    },
  }
}
