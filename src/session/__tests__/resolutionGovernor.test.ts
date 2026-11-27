import { describe, expect, it } from 'vitest'
import { ResolutionGovernor } from '../resolutionGovernor'

function run(g: ResolutionGovernor, ms: number, seconds: number): number {
  let r = g.current
  for (let t = 0; t < seconds; t += ms / 1000) r = g.frame(ms)
  return r
}

describe('resolution governor', () => {
  it('holds the maximum when frames are fast enough', () => {
    const g = new ResolutionGovernor({ max: 1.5 })
    expect(run(g, 14, 30)).toBe(1.5)
  })

  it('steps down when frames are slow, never below the minimum', () => {
    const g = new ResolutionGovernor({ max: 1.5, min: 0.6 })
    const r = run(g, 60, 60)
    expect(r).toBeLessThan(1.5)
    expect(r).toBeGreaterThanOrEqual(0.6)
    expect(run(g, 120, 120)).toBe(0.6)
  })

  it('settles where the frame time becomes acceptable (frame time proportional to pixels)', () => {
    const g = new ResolutionGovernor({ max: 2, min: 0.5 })
    // 50 ms at 2.0x, scaling with the pixel count (scale squared).
    let r = g.current
    for (let t = 0; t < 120; t += 0.02) r = g.frame(50 * (r / 2) ** 2)
    const ms = 50 * (r / 2) ** 2
    expect(ms).toBeLessThan(31.5)
    expect(r).toBeGreaterThan(1.2) // not needlessly low
  })

  it('does not oscillate between two levels: it holds below the level that failed', () => {
    const g = new ResolutionGovernor({ max: 2, min: 0.5 })
    const changes: number[] = []
    let last = g.current
    // A vsync-capped 16.7 ms frame until the scale exceeds 1.2, where it costs 40 ms.
    for (let t = 0; t < 120; t += 0.02) {
      const ms = g.current > 1.2 ? 40 : 16.7
      const r = g.frame(ms)
      if (r !== last) {
        changes.push(t)
        last = r
      }
    }
    // Early adjustments, then it stays put for long stretches.
    const late = changes.filter((t) => t > 60)
    expect(late.length).toBeLessThanOrEqual(4)
  })

  it('ignores hidden-tab frames, and one hitch does not move it', () => {
    const g = new ResolutionGovernor({ max: 1.5 })
    for (let i = 0; i < 100; i++) g.frame(10000)
    expect(g.current).toBe(1.5)
    for (let i = 0; i < 600; i++) g.frame(i === 300 ? 600 : 14)
    expect(g.current).toBe(1.5)
  })

  it('reacts on a machine that renders a frame per second', () => {
    const g = new ResolutionGovernor({ max: 1, min: 0.5 })
    for (let i = 0; i < 40; i++) g.frame(900)
    expect(g.current).toBeLessThan(1)
  })

  it('starts low for a software renderer and can climb when it is fast', () => {
    const g = new ResolutionGovernor({ max: 1.5, start: 0.6 })
    expect(g.current).toBe(0.6)
    expect(run(g, 8, 60)).toBeGreaterThan(0.6)
  })
})
