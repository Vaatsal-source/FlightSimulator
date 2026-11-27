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
import { drawDed, drawHud, drawMfd, drawMfdAttitude, drawMfdNav } from './fighterDraw'
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
  /** Redraw the live screens at most this often (ms); 0 redraws on every new snapshot. */
  redrawMs?: number
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
  const belt = std(0x23252b, 1)
  const knobHat = std(0xc23a2e, 0.5)
  const buckle = std(0xb7bcc6, 0.3, 0.8)
  const rubber = std(0x0f1013, 1)
  const brushed = std(0x7d838f, 0.35, 0.7)
  const lamp = (color: number): MeshBasicMaterial => track(new MeshBasicMaterial({ color, toneMapped: false, fog: false }))
  const red = lamp(0xe23b2e)
  const amber = lamp(0xf0a82a)
  const green = lamp(0x43e08a)
  const white = lamp(0xe9edf2)
  const knobYellow = std(0xd8b020, 0.5)
  const knobRed = std(0xb02a24, 0.5)
  const knobBlue = std(0x2f5fa8, 0.5)

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

  const LEGENDS = ['APU', 'FUEL', 'HYD', 'ELEC', 'AIR', 'PACK', 'BLEED', 'ENG', 'FIRE', 'A-ICE', 'LDG', 'STROBE', 'NAV', 'SEAT', 'WIPER', 'CABIN', 'EMER', 'ADIRS', 'FLT CTL', 'CVR', 'RADIO', 'TRIM', 'GEN', 'PUMP']
  /** A glossy reflection over a screen: a soft diagonal sheen on a transparent plane. */
  const sheenTexture = ((): CanvasTexture => {
    const c = document.createElement('canvas')
    c.width = 128
    c.height = 128
    const g = c.getContext('2d')
    if (g) {
      const grad = g.createLinearGradient(0, 0, 128, 128)
      grad.addColorStop(0, 'rgba(255,255,255,0.20)')
      grad.addColorStop(0.35, 'rgba(255,255,255,0.05)')
      grad.addColorStop(0.55, 'rgba(255,255,255,0)')
      grad.addColorStop(1, 'rgba(255,255,255,0.07)')
      g.fillStyle = grad
      g.fillRect(0, 0, 128, 128)
    }
    return track(new CanvasTexture(c))
  })()
  const sheenMat = track(new MeshBasicMaterial({ map: sheenTexture, transparent: true, depthWrite: false, toneMapped: false, fog: false }))
  const sheen = (parent: Object3D, w: number, h: number, p: Vec, r: Vec = [0, 0, 0]): void => {
    const m = mesh(parent, new PlaneGeometry(w, h), sheenMat, p, r)
    m.renderOrder = 6
  }
  /** A quiet static panel of switches, knobs and a few indicator lights, drawn once. */
  const switchPanel = (cols: number, rows: number, seed: number, lit: boolean, aspect = 2): MeshBasicMaterial => {
    const canvas = document.createElement('canvas')
    // Match the plane's proportions so the cells are not stretched.
    const W = Math.max(64, Math.round(aspect >= 1 ? 1024 : 1024 * aspect))
    const H = Math.max(64, Math.round(aspect >= 1 ? 1024 / aspect : 1024))
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
          // A legend under the control, as engraved on a real panel.
          ctx.fillStyle = '#9aa3b2'
          ctx.font = `${Math.max(7, Math.round(m * 0.19))}px sans-serif`
          ctx.textAlign = 'center'
          ctx.fillText(LEGENDS[Math.floor(rnd() * LEGENDS.length)], x, y + rh * 0.36, cw * 0.78)
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
      // Section frames around groups of controls, with a coloured corner tab on some.
      ctx.lineWidth = Math.max(1, W / 400)
      const gw = cw * Math.max(2, Math.min(cols, 4))
      const gh = rh * Math.max(2, Math.min(rows, 3))
      for (let gy = 0; gy < H - 1; gy += gh) {
        for (let gx = 0; gx < W - 1; gx += gw) {
          ctx.strokeStyle = '#3b4252'
          ctx.strokeRect(gx + 2, gy + 2, gw - 4, gh - 4)
          const tab = rnd()
          ctx.fillStyle = tab < 0.2 ? '#d8b020' : tab < 0.35 ? '#c23a2e' : tab < 0.5 ? '#3a6ab5' : '#2a2f3a'
          ctx.fillRect(gx + 2, gy + 2, gw * 0.18, Math.max(2, gh * 0.03))
        }
      }
    }
    const texture = track(new CanvasTexture(canvas))
    texture.colorSpace = SRGBColorSpace
    texture.anisotropy = 4
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
    // Side bolsters, armrests, a lumbar pad, the seat pan frame and its rails.
    for (const sx of [-1, 1]) {
      box(root, 0.06, 0.5, 0.09, leather, [x + sx * 0.28, y - 0.02, z + 0.24], [-0.12, 0, 0])
      box(root, 0.07, 0.04, 0.34, trim, [x + sx * 0.33, y - 0.17, z - 0.02])
      box(root, 0.05, 0.14, 0.05, trim, [x + sx * 0.33, y - 0.25, z + 0.12])
      box(root, 0.04, 0.05, 0.62, plastic, [x + sx * 0.2, y - 0.4, z])
    }
    box(root, 0.34, 0.12, 0.04, fabric, [x, y - 0.12, z + 0.2], [-0.12, 0, 0])
    box(root, 0.56, 0.03, 0.56, plastic, [x, y - 0.38, z])
    // Shoulder harness straps over the seat back, with a buckle.
    for (const sx of [-1, 1]) bar([x + sx * 0.11, y + 0.3, z + 0.27], [x + sx * 0.05, y - 0.15, z + 0.18], 0.04, 0.012, belt)
    box(root, 0.06, 0.04, 0.02, buckle, [x, y - 0.17, z + 0.17])
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
    solid(wheel, new BoxGeometry(0.035, 0.1, 0.045), plastic, [radius, -0.02, 0])
    solid(wheel, new BoxGeometry(0.035, 0.1, 0.045), plastic, [-radius, -0.02, 0])
    solid(wheel, new BoxGeometry(0.03, 0.018, 0.02), knobHat, [radius, 0.03, -0.025])
    solid(wheel, new BoxGeometry(0.03, 0.018, 0.02), knobHat, [-radius, 0.03, -0.025])
    solid(wheel, new CylinderGeometry(0.028, 0.028, 0.03, 12), trim, [0, 0, 0.0], [Math.PI / 2, 0, 0])
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
    solid(g, new CylinderGeometry(0.05, 0.065, 0.05, 12), carpet, [0, 0.01, 0])
    solid(g, new BoxGeometry(0.012, 0.016, 0.012), knobHat, [0.012, height + 0.05, -0.012])
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
    sheen(root, 0.48, 0.32, [0, -0.375, -0.7665])
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
    sheen(panel, 0.37, 0.37, [-cx, 0.1, 0.0462])
    sheen(panel, 0.37, 0.37, [cx, 0.1, 0.0462])
    sheen(panel, 0.34, 0.17, [0, 0.18, 0.0462])
    // Standby attitude indicator under the displays, with its own bezel, and gear and brake lights.
    bezel(panel, 0.13, 0.13, [0, -0.215, 0.045])
    mirrorScreen(panel, pfd, { w: 0.13, h: 0.13 }, [0, -0.215, 0.0455])
    for (let i = 0; i < 3; i++) box(panel, 0.03, 0.03, 0.006, i === 1 ? amber : green, [-0.1 + i * 0.1, -0.31, 0.044])
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
    // Fighter: a HUD on posts above a sloped glare-shield, a keypad and data display, three MFDs with bezel
    // buttons, a standby cluster, a tapered tub with canopy bows, rails and a rear-view mirror.
    addScreen(root, TEXTURE_SIZE.hud, { w: 0.36, h: 0.36 }, [0, 0.03, -0.9], drawHud, [0, 0, 0], true)
    glass(0.34, 0.34, [0, 0.03, -0.895], [0, 0, 0]) // combiner glass tint
    // Combiner frame: two tall posts, a top bar and a bottom rail, with the HUD box below.
    for (const sx of [-1, 1]) {
      bar([sx * 0.2, -0.2, -0.88], [sx * 0.19, 0.2, -0.92], 0.024, 0.024, trim)
      box(root, 0.05, 0.05, 0.05, glareMat, [sx * 0.2, -0.2, -0.88])
    }
    box(root, 0.4, 0.014, 0.02, trim, [0, 0.2, -0.92])
    box(root, 0.4, 0.014, 0.02, trim, [0, -0.15, -0.88])
    box(root, 0.5, 0.07, 0.16, glareMat, [0, -0.23, -0.86])
    // Glare-shield: a long sloped hood over the panel, with a lip.
    box(root, 1.5, 0.03, 0.5, glareMat, [0, -0.215, -0.8], [-0.12, 0, 0])
    // Main panel, tilted back a little.
    const panel = new Group()
    panel.position.set(0, -0.36, -0.7)
    panel.rotation.set(-0.3, 0, 0)
    panel.updateMatrix()
    root.add(panel)
    box(panel, 1.36, 0.42, 0.05, plastic, [0, 0, 0])
    detail(panel, 1.32, 0.4, [0, 0, 0.0252], [0, 0, 0], 34, 9, 13)
    // Keypad and data display band under the HUD.
    detail(panel, 0.34, 0.07, [0, 0.165, 0.0262], [0, 0, 0], 12, 3, 31)
    bezel(panel, 0.18, 0.055, [-0.27, 0.168, 0.03])
    addScreen(panel, { w: 256, h: 96 }, { w: 0.18, h: 0.055 }, [-0.27, 0.168, 0.031], drawDed)
    // Three MFDs, each with a ring of bezel buttons, left attitude, centre engines, right navigation.
    const mfds: [number, number, number, Draw][] = [
      [-0.4, -0.02, 0.2, drawMfdAttitude],
      [0, -0.02, 0.23, drawMfd],
      [0.4, -0.02, 0.2, drawMfdNav],
    ]
    for (const [mx, my, ms, draw] of mfds) {
      box(panel, ms + 0.06, ms + 0.06, 0.012, glareMat, [mx, my, 0.032]) // thick black frame
      addScreen(panel, TEXTURE_SIZE.mfd, { w: ms, h: ms }, [mx, my, 0.0385], draw)
      sheen(panel, ms, ms, [mx, my, 0.0392])
      for (let i = 0; i < 5; i++) {
        const o = -ms / 2 + (ms / 5) * (i + 0.5)
        box(panel, 0.014, 0.01, 0.01, brushed, [mx + o, my + ms / 2 + 0.036, 0.034]) // top row
        box(panel, 0.014, 0.01, 0.01, brushed, [mx + o, my - ms / 2 - 0.036, 0.034]) // bottom row
        box(panel, 0.01, 0.014, 0.01, brushed, [mx - ms / 2 - 0.036, my + o, 0.034]) // left column
        box(panel, 0.01, 0.014, 0.01, brushed, [mx + ms / 2 + 0.036, my + o, 0.034]) // right column
      }
      box(panel, 0.03, 0.012, 0.01, knobYellow, [mx, my - ms / 2 - 0.058, 0.034]) // brightness rocker
    }
    // Standby cluster and lamp strip in the lower centre.
    bezel(panel, 0.28, 0.1, [0, -0.19, 0.031])
    addScreen(panel, TEXTURE_SIZE.gauges, { w: 0.28, h: 0.1 }, [0, -0.19, 0.0335], drawSixPack)
    for (let i = 0; i < 6; i++) box(panel, 0.024, 0.012, 0.008, i % 3 === 0 ? green : i % 3 === 1 ? amber : red, [-0.34 + i * 0.05, -0.185, 0.033])
    box(root, 1.5, 0.5, 0.5, plastic, [0, -0.66, -0.52])
    // Tub: a floor, a sloped back wall, tapered sides up to the canopy rails, and the sloped side consoles.
    box(root, 1.5, 0.05, 2.2, carpet, [0, -0.95, 0.0])
    box(root, 1.5, 1.4, 0.05, plastic, [0, -0.25, 1.1])
    for (const sx of [-1, 1]) {
      box(root, 0.05, 0.55, 1.7, plastic, [sx * 0.72, -0.35, -0.15], [0, 0, sx * 0.12]) // leaning side wall
      box(root, 0.06, 0.05, 1.7, brushed, [sx * 0.7, -0.1, -0.15]) // canopy sill rail
      box(root, 0.2, 0.14, 1.3, plastic, [sx * 0.52, -0.42, -0.1], [0, 0, sx * -0.08]) // side console
      detail(root, 0.18, 1.24, [sx * 0.52, -0.345, -0.1], [-Math.PI / 2, 0, sx * -0.08], 6, 22, 21 + sx, true)
      for (let i = 0; i < 4; i++) box(root, 0.02, 0.012, 0.03, i % 2 ? green : amber, [sx * 0.54, -0.335, -0.5 + i * 0.12]) // annunciator strip
    }
    // Canopy: three bows, the side rails, and a rear-view mirror on the front bow.
    for (const [z, r] of [
      [-0.95, 0.6],
      [-0.2, 0.7],
      [0.45, 0.72],
    ] as const) solid(root, new TorusGeometry(r, 0.024, 8, 32, Math.PI), trim, [0, -0.1, z])
    for (const sx of [-1, 1]) {
      bar([sx * 0.6, -0.1, -0.95], [sx * 0.7, -0.1, -0.2], 0.045, 0.045)
      bar([sx * 0.7, -0.1, -0.2], [sx * 0.72, -0.1, 0.45], 0.045, 0.045)
    }
    box(root, 0.3, 0.06, 0.02, glareMat, [0, 0.62, -0.78]) // mirror housing
    box(root, 0.26, 0.045, 0.004, rubber, [0, 0.62, -0.769]) // mirror face
    box(root, 0.34, 0.5, 0.14, leather, [0, 0.0, 0.5]) // headrest
    box(root, 0.5, 0.1, 0.45, leather, [0, -0.46, 0.15])
    lever([-0.5, -0.33, -0.3], 0.14)
    lever([-0.46, -0.33, -0.3], 0.14)
    stick = makeStick([0, -0.7, -0.3], 0.3)
  }

  // ---- furnishing: the small things that make it a room somebody works in ----
  const knob = (parent: Object3D, p: Vec, r: number, mat: Material, axis: 'y' | 'z' = 'y'): void =>
    solid(parent, new CylinderGeometry(r, r * 1.1, r * 1.1, 10), mat, p, axis === 'z' ? [Math.PI / 2, 0, 0] : [0, 0, 0])
  /** A pair of rudder pedals with heel rests, under a pilot's panel. */
  const pedals = (x: number, y: number, z: number, floor: number): void => {
    for (const sx of [-1, 1]) {
      box(root, 0.13, 0.17, 0.025, brushed, [x + sx * 0.14, y, z], [-0.55, 0, 0])
      box(root, 0.13, 0.02, 0.07, rubber, [x + sx * 0.14, y - 0.07, z - 0.03], [-0.55, 0, 0])
      bar([x + sx * 0.14, y + 0.07, z + 0.02], [x + sx * 0.14, y + 0.3, z + 0.1], 0.02, 0.02, trim)
    }
    box(root, 0.42, 0.015, 0.3, rubber, [x, floor + 0.03, z + 0.3]) // heel mat
  }
  if (spec.style === 'airliner') {
    const px = [0, cx * 2]
    for (const x of px) {
      pedals(x, -1.02, -0.78, -1.2)
      // Master warning and caution lights, and the glare-shield rim.
      box(root, 0.045, 0.018, 0.035, red, [x - 0.14, -0.073, -0.9], [-0.2, 0, 0])
      box(root, 0.045, 0.018, 0.035, amber, [x + 0.14, -0.073, -0.9], [-0.2, 0, 0])
      box(root, 0.5, 0.02, 0.02, trim, [x, -0.083, -0.86])
      // Sun visors folded up at the top of the windscreen.
      box(root, 0.42, 0.012, 0.22, glareMat, [x, 0.5, -0.8], [0.35, 0, 0])
      bar([x - 0.18, 0.5, -0.82], [x - 0.18, 0.55, -0.74], 0.012, 0.012, brushed)
      // Cup holder and a headset hook.
      knob(root, [x + (x === 0 ? -0.55 : 0.55), -0.76, 0.0], 0.04, rubber)
      knob(root, [x + (x === 0 ? -0.8 : 0.8), -0.35, 0.5], 0.015, brushed, 'z')
    }
    // Pedestal: flap and speed brake levers, trim wheels, parking brake and the radio panel.
    for (const sx of [-1, 1]) {
      knob(root, [cx + sx * 0.185, -0.89, -0.32], 0.075, plastic, 'z')
      box(root, 0.012, 0.15, 0.012, brushed, [cx + sx * 0.185, -0.89, -0.32])
    }
    box(root, 0.02, 0.07, 0.03, trim, [cx + 0.08, -0.82, -0.12])
    knob(root, [cx + 0.08, -0.77, -0.12], 0.016, knobYellow)
    box(root, 0.02, 0.07, 0.03, trim, [cx - 0.08, -0.82, 0.06])
    knob(root, [cx - 0.08, -0.77, 0.06], 0.016, knobBlue)
    box(root, 0.03, 0.05, 0.1, knobRed, [cx, -0.82, 0.42])
    box(root, 0.24, 0.025, 0.16, glareMat, [cx, -0.838, 0.28])
    for (let i = 0; i < 3; i++) box(root, 0.05, 0.01, 0.035, i === 2 ? amber : green, [cx - 0.07 + i * 0.07, -0.822, 0.27])
    // Overhead: raised module frames, rotary knobs and guard covers.
    for (let i = 0; i < 4; i++) box(root, 0.02, 0.025, 0.5, trim, [cx - 0.72 + i * 0.48, 0.735, -0.32])
    for (let r = 0; r < 3; r++) box(root, 1.9, 0.025, 0.02, trim, [cx, 0.735, -0.5 + r * 0.17])
    for (let i = 0; i < 12; i++) {
      knob(root, [cx - 0.82 + i * 0.15, 0.72, -0.45 + (i % 3) * 0.11], 0.017, i % 4 === 0 ? knobYellow : brushed)
      if (i % 3 === 0) box(root, 0.04, 0.012, 0.03, i % 2 ? amber : green, [cx - 0.78 + i * 0.15, 0.727, -0.1])
    }
    for (let i = 0; i < 4; i++) box(root, 0.06, 0.03, 0.05, knobRed, [cx - 0.3 + i * 0.2, 0.72, 0.18]) // fire handle guards
    // Ceiling: dome light, escape-rope box, grab handles, a compass.
    knob(root, [cx, 0.745, 0.6], 0.06, white)
    box(root, 0.25, 0.08, 0.2, plastic, [cx, 0.715, 1.2])
    for (const sx of [-1, 1]) bar([cx + sx * 1.03, 0.4, 0.9], [cx + sx * 1.03, 0.4, 1.6], 0.025, 0.025, brushed)
    box(root, 0.05, 0.12, 0.05, brushed, [cx, 0.5, -0.74])
    knob(root, [cx, 0.52, -0.78], 0.035, glareMat)
    // Wipers parked at the foot of the windscreen, and a clock on the panel's rim.
    for (const wx of [-0.45, 0.45]) bar([cx + wx - 0.17, -0.085, -1.12], [cx + wx + 0.17, -0.04, -1.1], 0.016, 0.01, rubber)
    // Oxygen masks in their boxes, a fire extinguisher and a first-aid kit behind the seats.
    for (const x of [0, cx * 2]) box(root, 0.12, 0.1, 0.08, white, [x + (x === 0 ? -0.62 : 0.62), -0.1, 0.78])
    knob(root, [cx + 0.9, -0.85, 1.7], 0.07, knobRed)
    box(root, 0.18, 0.12, 0.1, white, [cx - 0.9, -0.5, 1.82])
    box(root, 0.06, 0.04, 0.01, red, [cx - 0.9, -0.5, 1.765])
    // Window rubber seals just inside the frames.
    for (const sx of [-1, 1]) {
      box(root, 0.02, 0.04, 1.0, rubber, [cx + sx * 1.065, -0.075, 0.1])
      box(root, 0.02, 0.04, 1.0, rubber, [cx + sx * 1.065, 0.53, 0.1])
    }
    // Side consoles: the nose-wheel tiller and a small drawer face.
    for (const sx of [-1, 1]) {
      knob(root, [cx + sx * 1.0, -0.68, -0.05], 0.03, brushed, 'z')
      box(root, 0.18, 0.05, 0.18, glareMat, [cx + sx * 0.97, -0.74, 0.5])
    }
  } else if (spec.style === 'light') {
    pedals(0, -0.85, -0.58, -0.95)
    pedals(cx * 2, -0.85, -0.58, -0.95)
    // Compass above the windscreen, trim wheel on the pedestal, a glare-shield rim, warning lights.
    knob(root, [cx, 0.28, -0.55], 0.04, glareMat)
    box(root, 0.02, 0.1, 0.02, brushed, [cx, 0.31, -0.55])
    box(root, 1.24, 0.02, 0.02, trim, [cx, -0.17, -0.82])
    knob(root, [cx + 0.12, -0.52, -0.3], 0.05, plastic, 'z')
    for (let i = 0; i < 3; i++) box(root, 0.03, 0.02, 0.03, i === 0 ? red : i === 1 ? amber : green, [-0.45 + i * 0.05, -0.2, -0.78])
    // Headrests and a coat hook on the back wall.
    for (const x of [0, cx * 2]) box(root, 0.28, 0.16, 0.07, leather, [x, 0.3, 0.38])
    knob(root, [cx, 0.1, 1.0], 0.012, brushed, 'z')
  } else {
    // Fighter: ejection handle, harness straps, warning lights and rudder pedals.
    box(root, 0.1, 0.03, 0.04, knobYellow, [0, -0.42, -0.2])
    bar([-0.05, -0.42, -0.2], [-0.05, -0.34, -0.2], 0.012, 0.012, rubber)
    bar([0.05, -0.42, -0.2], [0.05, -0.34, -0.2], 0.012, 0.012, rubber)
    for (const sx of [-1, 1]) {
      bar([sx * 0.14, 0.2, 0.5], [sx * 0.07, -0.3, 0.28], 0.05, 0.014, belt)
      box(root, 0.07, 0.04, 0.02, buckle, [sx * 0.07, -0.3, 0.27])
    }
    box(root, 0.09, 0.02, 0.05, knobRed, [0.52, -0.23, -0.2])
    for (let i = 0; i < 5; i++) box(root, 0.03, 0.012, 0.03, i % 2 ? amber : green, [-0.2 + i * 0.1, -0.2, -0.78], [-0.28, 0, 0])
    box(root, 0.4, 0.02, 0.015, glareMat, [0, -0.2, -0.84])
    pedals(0, -0.62, -0.6, -0.9)
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
  let lastDraw = -Infinity

  return {
    root,
    update(ps, c) {
      const now = options.redrawMs ? performance.now() : 0
      if (ps.t !== lastT && (!options.redrawMs || now - lastDraw >= options.redrawMs)) {
        lastT = ps.t
        lastDraw = now
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
