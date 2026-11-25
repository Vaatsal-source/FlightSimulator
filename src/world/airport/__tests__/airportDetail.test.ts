import { describe, expect, it } from 'vitest'
import { AIRPORTS } from '../../../config/airports'
import { airportFrame, airportLayout, toLocal } from '../../../game/airportGeometry'
import { distanceToRoute, planTaxiRoute } from '../../../game/groundOps'
import { GATE_PITCH } from '../airportDetail'
import { buildAirportPlan } from '../plan'

describe('airport detail', () => {
  it('is deterministic', () => {
    for (const a of AIRPORTS) {
      const x = buildAirportPlan(a).detail
      const y = buildAirportPlan(a).detail
      expect(x.props).toEqual(y.props)
      expect(x.parked).toEqual(y.parked)
      expect(x.boxes.length).toBe(y.boxes.length)
    }
  })

  it('every box, cylinder and prop is finite and sensibly sized', () => {
    for (const a of AIRPORTS) {
      const d = buildAirportPlan(a).detail
      for (const b of d.boxes) {
        for (const v of [b.cx, b.cz, b.w, b.d, b.y0, b.h]) expect(Number.isFinite(v), a.id).toBe(true)
        expect(b.w).toBeGreaterThan(0)
        expect(b.d).toBeGreaterThan(0)
        expect(b.h).toBeGreaterThan(0)
        expect(b.y0 + b.h, a.id).toBeLessThan(120)
      }
      for (const c of d.cylinders) expect(c.r).toBeGreaterThan(0)
      for (const p of d.props) expect(Number.isFinite(p.x + p.z + p.rotY)).toBe(true)
    }
  })

  it('international and regional airports get gates, parked aircraft and ground equipment; small fields do not', () => {
    for (const a of AIRPORTS) {
      const d = buildAirportPlan(a).detail
      if (a.class === 'international') {
        expect(d.parked.length, a.id).toBeGreaterThanOrEqual(4)
        expect(d.props.filter((p) => p.kind === 'fuelTruck').length).toBeGreaterThanOrEqual(d.parked.length)
        expect(d.props.filter((p) => p.kind === 'car').length, a.id).toBeGreaterThan(150)
        expect(d.cylinders.length).toBeGreaterThanOrEqual(4)
      }
      if (a.class === 'short') expect(d.parked.length, a.id).toBe(0)
    }
  })

  it('aircraft are parked on the apron, one per gate, never at the player stand', () => {
    for (const a of AIRPORTS.filter((x) => x.class === 'international' || x.class === 'regional')) {
      const plan = buildAirportPlan(a)
      const lay = airportLayout(a)
      const rr = airportFrame(a)
      const standAlong = -0.22 * lay.apron.length
      const gates = new Set<number>()
      for (const s of plan.detail.parked) {
        expect(s.gate, a.id).not.toBe(0)
        expect(gates.has(s.gate), `${a.id} gate ${s.gate} used twice`).toBe(false)
        gates.add(s.gate)
        // Local z = -along: back to the airport frame and check it is on the apron.
        const along = -s.z
        expect(along).toBeCloseTo(standAlong + s.gate * GATE_PITCH, 6)
        expect(Math.abs(s.x - toLocal(rr, lay.apron.cx, lay.apron.cz).across)).toBeLessThan(lay.apron.width / 2)
        expect(s.model).toBeGreaterThanOrEqual(0)
        expect(s.model).toBeLessThan(4)
      }
    }
  })

  it('nothing is put on the player taxi route, or on the runways', () => {
    for (const a of AIRPORTS.filter((x) => x.class !== 'short' && x.class !== 'military')) {
      const plan = buildAirportPlan(a)
      const rr = airportFrame(a)
      const route = planTaxiRoute({ airportId: a.id, runwayEnd: endOf(a) }, 'a320')
      // Prop positions are local; convert the route points to the same frame to compare.
      const local = route.points.map((p) => {
        const l = toLocal(rr, p.x, p.z)
        return { x: l.across, z: -l.along }
      })
      for (const p of plan.detail.props) {
        if (p.kind === 'car') continue
        expect(distanceToRoute(local, { x: p.x, z: p.z }), `${a.id} ${p.kind} at ${p.x.toFixed(0)},${p.z.toFixed(0)}`).toBeGreaterThan(7)
      }
    }
  })
})

function endOf(a: (typeof AIRPORTS)[number]): string {
  return a.runways[0].headingDeg === 90 ? '09R' : '36'
}
