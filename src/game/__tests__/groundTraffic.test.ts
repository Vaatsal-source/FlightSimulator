import { describe, expect, it } from 'vitest'
import { AIRPORTS } from '../../config/airports'
import { planTaxiRoute } from '../groundOps'
import { GroundTraffic, type TrafficPose } from '../groundTraffic'

const blank = (): TrafficPose => ({ visible: false, x: 0, z: 0, headingDeg: 0, lift: 0, pitchDeg: 0, speed: 0, model: 0, waiting: false, onRunway: false })

function setup(id = 'harbor') {
  const a = AIRPORTS.find((x) => x.id === id) ?? AIRPORTS.find((x) => x.class === 'international')!
  const end = a.runways[0].headingDeg === 90 ? '09R' : '36'
  const route = planTaxiRoute({ airportId: a.id, runwayEnd: end }, 'a320')
  return { route, traffic: new GroundTraffic(route) }
}

describe('ground traffic', () => {
  it('moves smoothly: no jumps between frames while visible', () => {
    for (const a of AIRPORTS.filter((x) => x.class === 'international')) {
      const end = a.runways[0].headingDeg === 90 ? '09R' : '36'
      const t = new GroundTraffic(planTaxiRoute({ airportId: a.id, runwayEnd: end }, 'a320'))
      for (let i = 0; i < t.count; i++) {
        const prev = blank()
        const cur = blank()
        t.poseAt(i, 0, prev)
        for (let s = 0.5; s < 600; s += 0.5) {
          t.poseAt(i, s, cur)
          if (prev.visible && cur.visible) expect(Math.hypot(cur.x - prev.x, cur.z - prev.z), `${a.id} #${i} t=${s}`).toBeLessThan(0.5 * 100)
          Object.assign(prev, cur)
        }
      }
    }
  })

  it('taxies on the route and holds at the hold-short line before the runway', () => {
    const { route, traffic } = setup()
    const hold = route.points[route.holdIndex]
    const p = blank()
    let waited = 0
    for (let s = 0; s < 400; s += 0.5) {
      traffic.poseAt(0, s, p)
      if (p.waiting) {
        waited++
        expect(Math.hypot(p.x - hold.x, p.z - hold.z)).toBeLessThan(1)
      }
    }
    expect(waited).toBeGreaterThan(20)
  })

  it('has a departure on the runway at times, then none', () => {
    const { traffic } = setup()
    const p = blank()
    let busy = 0
    let free = 0
    for (let s = 0; s < 400; s += 1) {
      if (traffic.runwayBusy(s, p)) busy++
      else free++
    }
    expect(busy).toBeGreaterThan(10)
    expect(free).toBeGreaterThan(10)
  })

  it('reports traffic ahead and a close call', () => {
    const { traffic } = setup()
    const p = blank()
    // Stand directly in front of a waiting aircraft, looking at it.
    let found = false
    for (let s = 0; s < 300 && !found; s += 1) {
      traffic.poseAt(0, s, p)
      if (!p.waiting) continue
      const h = (p.headingDeg * Math.PI) / 180
      const from = { x: p.x - Math.sin(h) * 60, z: p.z + Math.cos(h) * 60 }
      const near = traffic.nearestAhead(s, from, p.headingDeg, blank())
      expect(near).not.toBeNull()
      expect(near!.distance).toBeLessThan(75)
      const close = traffic.nearestAhead(s, { x: p.x - Math.sin(h) * 10, z: p.z + Math.cos(h) * 10 }, p.headingDeg, blank())
      expect(close!.hit).toBe(true)
      found = true
    }
    expect(found).toBe(true)
  })
})
