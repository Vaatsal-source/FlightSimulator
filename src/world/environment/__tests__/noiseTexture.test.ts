import { describe, expect, it } from 'vitest'
import { bakeNoise } from '../noiseTexture'

describe('bakeNoise', () => {
  const cells = 16
  const per = 4
  const size = cells * per
  const tile = bakeNoise(cells, per, 3)

  it('has one byte per texel and uses the range', () => {
    expect(tile.length).toBe(size * size)
    expect(Math.min(...tile)).toBeLessThan(40)
    expect(Math.max(...tile)).toBeGreaterThan(215)
  })

  it('is smooth between texels and wraps without a seam', () => {
    let worst = 0
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      worst = Math.max(worst, Math.abs(tile[y * size + x] - tile[y * size + ((x + 1) % size)]))
      worst = Math.max(worst, Math.abs(tile[y * size + x] - tile[((y + 1) % size) * size + x]))
    }
    expect(worst).toBeLessThan(100)
  })

  it('is deterministic', () => {
    expect(Array.from(bakeNoise(cells, per, 3))).toEqual(Array.from(tile))
  })
})
