import { describe, expect, it } from 'vitest'
import { AIRPORTS } from '../../../config/airports'
import type { TerrainSampler } from '../../../simulation/types'
import { treesExcludedAt } from '../../terrain/treePlacement'
import { planScenery } from '../sceneryPlan'

/** Rolling hills with a sea on the east side. */
const terrain: TerrainSampler = {
  heightAt: (x, z) => (x > 30000 ? -5 : 120 + 110 * Math.sin(x / 7000) * Math.cos(z / 6000) + 40 * Math.sin(z / 1500)),
  surfaceAt: (x) => (x > 30000 ? 'water' : 'grass'),
}

describe('scenery plan', () => {
  const plan = planScenery(terrain)

  it('is deterministic', () => {
    const again = planScenery(terrain)
    expect(again.villages.length).toBe(plan.villages.length)
    expect(again.roads.length).toBe(plan.roads.length)
    expect(again.turbines).toEqual(plan.turbines)
    expect(again.masts).toEqual(plan.masts)
  })

  it('fills the country with villages, roads, wind farms and masts', () => {
    expect(plan.villages.length).toBeGreaterThan(15)
    expect(plan.roads.length).toBeGreaterThan(10)
    expect(plan.turbines.length).toBeGreaterThan(5)
    expect(plan.masts.length).toBeGreaterThan(0)
  })

  it('keeps everything on land and out of the airports', () => {
    for (const v of plan.villages) {
      expect(v.houses.length).toBeGreaterThanOrEqual(5)
      for (const h of v.houses) {
        expect(terrain.heightAt(h.x, h.z)).toBeGreaterThan(6)
        expect(treesExcludedAt(h.x, h.z)).toBe(false)
      }
      for (const a of AIRPORTS) expect(Math.hypot(v.x - a.center.x, v.z - a.center.z)).toBeGreaterThan(4000)
    }
    for (const r of plan.roads) {
      for (const p of r.pts) {
        expect(terrain.heightAt(p.x, p.z)).toBeGreaterThan(3)
        expect(treesExcludedAt(p.x, p.z)).toBe(false)
      }
    }
    for (const t of plan.turbines) expect(terrain.heightAt(t.x, t.z)).toBeGreaterThan(6)
  })

  it('roads join villages and are not absurdly long', () => {
    for (const r of plan.roads) {
      const a = plan.villages[r.a]
      const b = plan.villages[r.b]
      expect(Math.hypot(r.pts[0].x - a.x, r.pts[0].z - a.z)).toBeLessThan(1)
      expect(Math.hypot(r.pts[r.pts.length - 1].x - b.x, r.pts[r.pts.length - 1].z - b.z)).toBeLessThan(1)
      expect(r.pts.length).toBeLessThan(260)
    }
  })
})
