import { describe, expect, it } from 'vitest'
import { naturalHeightAt, forestAt } from '../heightField'
import { TILE, tileForest, tileRelief01, tileWeight } from '../tileTerrain'

describe('mountain tile', () => {
  it('has no effect outside its square and full effect inside its soft edge', () => {
    expect(tileWeight(TILE.cx + TILE.half + 1, TILE.cz)).toBe(0)
    expect(tileWeight(TILE.cx, TILE.cz)).toBe(1)
    expect(tileWeight(TILE.cx + TILE.half - TILE.fade / 2, TILE.cz)).toBeGreaterThan(0)
    expect(tileWeight(TILE.cx + TILE.half - TILE.fade / 2, TILE.cz)).toBeLessThan(1)
  })

  it('reads relief and forest in range, with real variation', () => {
    let lo = 1
    let hi = 0
    let fLo = 1
    let fHi = 0
    for (let i = 0; i < 400; i++) {
      const x = TILE.cx - TILE.half + ((i * 37) % 200) * 100
      const z = TILE.cz - TILE.half + ((i * 53) % 200) * 100
      const r = tileRelief01(x, z)
      const f = tileForest(x, z)
      expect(r).toBeGreaterThanOrEqual(0)
      expect(r).toBeLessThanOrEqual(1)
      lo = Math.min(lo, r)
      hi = Math.max(hi, r)
      fLo = Math.min(fLo, f)
      fHi = Math.max(fHi, f)
    }
    expect(hi - lo).toBeGreaterThan(0.5)
    expect(fHi - fLo).toBeGreaterThan(0.3)
  })

  it('is deterministic and keeps the terrain under the height ceiling', () => {
    let max = 0
    for (let i = 0; i < 300; i++) {
      const x = TILE.cx - TILE.half + ((i * 41) % 200) * 100
      const z = TILE.cz - TILE.half + ((i * 59) % 200) * 100
      const h = naturalHeightAt(x, z)
      expect(naturalHeightAt(x, z)).toBe(h)
      max = Math.max(max, h)
    }
    expect(max).toBeGreaterThan(300)
    expect(max).toBeLessThan(2000)
  })

  it('forest cover stays 0..1', () => {
    for (let i = 0; i < 200; i++) {
      const f = forestAt(TILE.cx + ((i * 31) % 100) * 150 - 7500, TILE.cz + ((i * 17) % 100) * 150 - 7500)
      expect(f).toBeGreaterThanOrEqual(-1e-9)
      expect(f).toBeLessThanOrEqual(1 + 1e-9)
    }
  })
})
