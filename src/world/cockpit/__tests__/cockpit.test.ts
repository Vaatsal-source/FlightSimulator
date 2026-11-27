// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AIRCRAFT_IDS, getAircraft } from '../../../config/aircraftCatalog'
import { INITIAL_TELEMETRY, type TelemetrySnapshot } from '../../../state/telemetry'
import { Vector3 } from 'three'
import { createAircraftRig } from '../../aircraft'
import { buildCockpit } from '../buildCockpit'
import type { Ctx, PanelState } from '../canvasKit'
import { cockpitSpecFor } from '../cockpitSpec'
import { drawSixPack } from '../dialDraw'
import { drawHud, drawMfd } from '../fighterDraw'
import { drawEicas, drawMcp, drawPfd } from '../glassDraw'

/** A canvas context that accepts any call and records the text drawn. */
function fakeCtx(): { ctx: Ctx; texts: string[] } {
  const texts: string[] = []
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(target, key: string) {
      if (key === 'fillText') return (s: string) => void texts.push(s)
      if (key === 'createLinearGradient') return () => ({ addColorStop: () => {} })
      if (key in target) return target[key]
      return () => {}
    },
    set(target, key: string, value) {
      target[key] = value
      return true
    },
  }) as unknown as Ctx
  return { ctx, texts }
}

function state(over: Partial<TelemetrySnapshot> = {}, id: (typeof AIRCRAFT_IDS)[number] = 'a220'): PanelState {
  const info = getAircraft(id)
  return {
    t: { ...INITIAL_TELEMETRY, aircraftId: id, ...over },
    units: 'imperial',
    speeds: info.speeds,
    engines: info.engines,
    ap: { ap: true, athr: true, vertical: 'ALT', targets: { speed: 80, headingDeg: 270, altitude: 3000, verticalSpeed: 5 } },
  }
}

const SANE: Partial<TelemetrySnapshot> = {
  airspeed: 75,
  altitude: 1500,
  heightAboveGround: 1400,
  headingDeg: 123,
  pitchDeg: 4,
  bankDeg: -12,
  verticalSpeed: 3,
  n1: 0.82,
  mach: 0.3,
  onGround: false,
  gearPosition: 0,
}
const HOSTILE: Partial<TelemetrySnapshot> = {
  airspeed: Number.NaN,
  altitude: Number.POSITIVE_INFINITY,
  heightAboveGround: -50,
  headingDeg: -720.5,
  pitchDeg: 400,
  bankDeg: Number.NaN,
  verticalSpeed: 1e9,
  n1: 9,
  rpm: -5,
  mach: Number.NaN,
  gForce: Number.NaN,
  stalled: true,
}

describe('screen drawing', () => {
  const screens = [
    ['pfd', drawPfd, 512, 512],
    ['eicas', drawEicas, 512, 256],
    ['mcp', drawMcp, 768, 96],
    ['six-pack', drawSixPack, 1024, 680],
    ['hud', drawHud, 512, 512],
    ['mfd', drawMfd, 256, 256],
  ] as const

  for (const [name, draw, w, h] of screens) {
    it(`${name} draws sane and hostile telemetry without throwing`, () => {
      for (const units of ['imperial', 'metric'] as const) {
        expect(() => draw(fakeCtx().ctx, w, h, { ...state(SANE), units })).not.toThrow()
        expect(() => draw(fakeCtx().ctx, w, h, { ...state(HOSTILE), units })).not.toThrow()
      }
    })
  }

  it('PFD shows rounded airspeed, altitude and heading', () => {
    const { ctx, texts } = fakeCtx()
    drawPfd(ctx, 512, 512, state(SANE))
    expect(texts).toContain(String(Math.round(75 * 1.943844))) // 146 kt
    expect(texts).toContain(String(Math.round(1500 * 3.280839895))) // 4921 ft
    expect(texts).toContain('123')
  })

  it('PFD warns of a stall', () => {
    const { ctx, texts } = fakeCtx()
    drawPfd(ctx, 512, 512, state({ ...SANE, stalled: true }))
    expect(texts).toContain('STALL')
  })

  it('MCP shows dashes until the autopilot is used', () => {
    const idle = fakeCtx()
    drawMcp(idle.ctx, 768, 96, { ...state(SANE), ap: { ap: false, athr: false, vertical: 'ALT', targets: { speed: 0, headingDeg: 0, altitude: 0, verticalSpeed: 0 } } })
    expect(idle.texts).toContain('---')
    const engaged = fakeCtx()
    drawMcp(engaged.ctx, 768, 96, state(SANE))
    expect(engaged.texts).toContain('270')
  })

  it('EICAS labels two engines on a twin and one on a single', () => {
    const twin = fakeCtx()
    drawEicas(twin.ctx, 512, 256, state(SANE))
    expect(twin.texts).toContain('ENG 2')
    const single = fakeCtx()
    drawEicas(single.ctx, 512, 256, { ...state(SANE), engines: 1 })
    expect(single.texts).not.toContain('ENG 2')
  })
})

const draws = { count: 0 }
beforeEach(() => {
  draws.count = 0
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
    const { ctx } = fakeCtx()
    return new Proxy(ctx as object, {
      get(target, key, recv) {
        if (key === 'fillRect') return () => void draws.count++
        return Reflect.get(target, key, recv)
      },
    }) as unknown as CanvasRenderingContext2D
  })
})
afterEach(() => vi.restoreAllMocks())

describe('buildCockpit', () => {
  for (const id of AIRCRAFT_IDS) {
    it(`${id}: builds, updates with extreme controls, and disposes`, () => {
      const cockpit = buildCockpit(id)
      expect(cockpit.root.children.length).toBeGreaterThan(8)
      const ps = state(SANE, id)
      expect(() => cockpit.update(ps, { pitch: 1, roll: -1, yaw: 0, throttle: 1 })).not.toThrow()
      expect(() => cockpit.update({ ...ps, t: { ...ps.t } }, { pitch: Number.NaN, roll: 9, yaw: 0, throttle: -3 })).not.toThrow()
      expect(() => cockpit.dispose()).not.toThrow()
      expect(cockpit.root.children.length).toBe(0)
    })
  }

  it('keeps the whole deck within a small draw-call budget (static parts are merged)', () => {
    for (const id of AIRCRAFT_IDS) {
      const cockpit = buildCockpit(id)
      let meshes = 0
      cockpit.root.traverse((o) => {
        if ((o as { isMesh?: boolean }).isMesh) meshes++
      })
      expect(meshes, id).toBeLessThan(50)
      cockpit.dispose()
    }
  })

  it('redraws screens only when a new telemetry snapshot arrives', () => {
    const cockpit = buildCockpit('a350')
    const ps = state(SANE, 'a350')
    const controls = { pitch: 0, roll: 0, yaw: 0, throttle: 0 }
    cockpit.update(ps, controls)
    expect(draws.count).toBeGreaterThan(0)
    for (let i = 0; i < 20; i++) cockpit.update(ps, controls) // a pass draws a couple of screens per frame, so let it finish
    const afterFirst = draws.count
    cockpit.update(ps, { ...controls, throttle: 0.5 }) // same snapshot: no redraw
    expect(draws.count).toBe(afterFirst)
    cockpit.update({ ...ps, t: { ...ps.t } }, controls) // new snapshot starts a new pass
    expect(draws.count).toBeGreaterThan(afterFirst)
    cockpit.dispose()
  })

  it('puts the pilot inside the airframe, so the model skin is not seen from outside', () => {
    // Only the airliners have a solid hull around the pilot; the trainer and F-22 hide their canopies in this view.
    for (const id of AIRCRAFT_IDS.filter((a) => getAircraft(a).engineKind === 'turbofan')) {
      const e = getAircraft(id).geometry.eyePoint
      const rig = createAircraftRig(id, false)
      expect(rig.insideEnvelope(new Vector3(e.x, e.y, e.z)), `${id} eye point`).toBe(true)
      rig.dispose()
    }
  })

  it('every deck style maps to the cockpit spec', () => {
    expect(cockpitSpecFor('f22').style).toBe('fighter')
    expect(cockpitSpecFor('trainer').style).toBe('light')
    expect(cockpitSpecFor('a350').style).toBe('airliner')
  })
})
