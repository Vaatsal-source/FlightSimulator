import { describe, expect, it } from 'vitest'
import { KEEP_ALL_DISTANCE, TREE_NEAR_DISTANCE, viewHalfAngle } from '../treeLod'

describe('tree LOD rules', () => {
  it('keeps a cone wider than the screen so a small turn cannot reveal a gap', () => {
    const fov = 70
    const aspect = 16 / 9
    const screenHalf = Math.atan(Math.tan((fov * Math.PI) / 360) * aspect)
    const half = viewHalfAngle(fov, aspect, 1)!
    expect(half).toBeGreaterThan(screenHalf + 0.3)
    expect(half).toBeLessThan(Math.PI)
  })

  it('widens with aspect ratio and drops the filter when looking almost straight up or down', () => {
    expect(viewHalfAngle(70, 2.4, 1)!).toBeGreaterThan(viewHalfAngle(70, 1.3, 1)!)
    expect(viewHalfAngle(70, 1.78, 0.1)).toBeNull()
  })

  it('never keeps more than a half-turn plus margin, even on an extreme lens', () => {
    expect(viewHalfAngle(170, 3, 1)!).toBeLessThan(Math.PI / 2 + 0.5)
  })

  it('keeps detailed trees close enough that the shadow box and the near ring agree', () => {
    expect(KEEP_ALL_DISTANCE).toBeLessThan(TREE_NEAR_DISTANCE)
  })
})
