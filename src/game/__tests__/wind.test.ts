import { describe, expect, it } from 'vitest'
import { AIRPORTS } from '../../config/airports'
import { prevailingFrom, WIND_SETTINGS, WIND_SPEED, windComponents, windFor, windText } from '../wind'

describe('wind model', () => {
  it('calm is calm, and the other settings scale up', () => {
    expect(windFor('calm', 'central', 0, 100).speed).toBe(0)
    const speeds = WIND_SETTINGS.map((s) => WIND_SPEED[s])
    for (let i = 1; i < speeds.length; i++) expect(speeds[i]).toBeGreaterThan(speeds[i - 1])
  })

  it('the vector points where the air goes: wind from the north blows towards +Z, from the east towards -X', () => {
    const north = { ...windFor('moderate', 'x', 0, 0), fromDeg: 0 }
    // Use the formula directly through windComponents' inverse: speed and direction fix the vector.
    const w = windFor('moderate', 'central', 0, 0)
    const r = (w.fromDeg * Math.PI) / 180
    expect(w.x).toBeCloseTo(-w.speed * Math.sin(r), 9)
    expect(w.z).toBeCloseTo(w.speed * Math.cos(r), 9)
    expect(north.fromDeg).toBe(0)
  })

  it('stays within the gust band and is deterministic', () => {
    for (const s of ['light', 'moderate', 'strong'] as const) {
      for (let t = 0; t < 600; t += 7) {
        const w = windFor(s, 'harbor', 90, t)
        expect(w.speed).toBeGreaterThan(WIND_SPEED[s] * 0.7)
        expect(w.speed).toBeLessThan(WIND_SPEED[s] * 1.3)
        expect(windFor(s, 'harbor', 90, t)).toEqual(w)
      }
    }
  })

  it('every airport has some crosswind on its runway: the wind is 20 to 60 degrees off the axis', () => {
    for (const a of AIRPORTS) {
      const from = prevailingFrom(a.id, a.runways[0].headingDeg)
      const off = Math.abs((((from - a.runways[0].headingDeg) % 360) + 540) % 360 - 180)
      expect(off, a.id).toBeGreaterThanOrEqual(19.9)
      expect(off, a.id).toBeLessThanOrEqual(60.1)
    }
  })

  it('splits a wind into headwind and crosswind for a heading', () => {
    const w = { x: 0, z: 10, speed: 10, fromDeg: 0 } // from the north
    const north = windComponents(w, 0)
    expect(north.headwind).toBeCloseTo(10, 6)
    expect(north.crosswind).toBeCloseTo(0, 6)
    const east = windComponents(w, 90) // heading east, wind from the north = from the left
    expect(east.headwind).toBeCloseTo(0, 6)
    expect(east.crosswind).toBeCloseTo(-10, 6)
    const south = windComponents(w, 180)
    expect(south.headwind).toBeCloseTo(-10, 6)
  })

  it('reads out like the tower: direction to ten degrees and knots', () => {
    expect(windText({ x: 0, z: 0, speed: 0, fromDeg: 80 })).toBe('calm')
    expect(windText({ x: 0, z: 0, speed: 6.17, fromDeg: 274 })).toBe('270 at 12 knots')
    expect(windText({ x: 0, z: 0, speed: 5, fromDeg: 2 })).toBe('360 at 10 knots')
  })
})
