/**
 * Fighter cockpit screens: a green head-up display (transparent canvas, shown
 * additively) and a multi-function display with attitude and engine/config.
 */

import { altitudeValue, speedValue, verticalSpeedValue } from '../../components/format'
import { clamp, COL, fin, line, pad3, rad, signed, txt, type Ctx, type PanelState } from './canvasKit'

const HUD = '#5dff8e'

export function drawHud(ctx: Ctx, w: number, h: number, s: PanelState): void {
  const { t, units } = s
  ctx.clearRect(0, 0, w, h)
  ctx.shadowColor = HUD
  ctx.shadowBlur = 6
  const cx = w / 2
  const cy = h / 2 + 10
  const ppd = 7
  const pitch = clamp(fin(t.pitchDeg), -90, 90)

  // Pitch ladder, rolled with the horizon.
  ctx.save()
  ctx.beginPath()
  ctx.rect(96, 70, w - 192, h - 160)
  ctx.clip()
  ctx.translate(cx, cy)
  ctx.rotate(-rad(fin(t.bankDeg)))
  ctx.translate(0, pitch * ppd)
  line(ctx, -150, 0, -34, 0, HUD, 2.5)
  line(ctx, 34, 0, 150, 0, HUD, 2.5)
  for (let d = -80; d <= 80; d += 5) {
    if (d === 0) continue
    const y = -d * ppd
    const dash = d < 0
    ctx.strokeStyle = HUD
    ctx.lineWidth = 2
    ctx.setLineDash(dash ? [7, 6] : [])
    ctx.beginPath()
    ctx.moveTo(-56, y)
    ctx.lineTo(-22, y)
    ctx.moveTo(22, y)
    ctx.lineTo(56, y)
    ctx.stroke()
    ctx.setLineDash([])
    line(ctx, -56, y, -56, y + (d > 0 ? 7 : -7), HUD, 2)
    line(ctx, 56, y, 56, y + (d > 0 ? 7 : -7), HUD, 2)
    txt(ctx, String(Math.abs(d)), -66, y, { size: 15, color: HUD, align: 'right' })
    txt(ctx, String(Math.abs(d)), 66, y, { size: 15, color: HUD, align: 'left' })
  }
  ctx.restore()

  // Boresight and flight-path marker (below the nose by the angle of attack).
  line(ctx, cx - 9, cy, cx + 9, cy, HUD, 2)
  line(ctx, cx, cy - 9, cx, cy + 9, HUD, 2)
  const fy = cy + clamp(fin(t.angleOfAttackDeg), -20, 40) * ppd
  ctx.strokeStyle = HUD
  ctx.lineWidth = 2.5
  ctx.beginPath()
  ctx.arc(cx, fy, 10, 0, Math.PI * 2)
  ctx.moveTo(cx - 10, fy)
  ctx.lineTo(cx - 28, fy)
  ctx.moveTo(cx + 10, fy)
  ctx.lineTo(cx + 28, fy)
  ctx.moveTo(cx, fy - 10)
  ctx.lineTo(cx, fy - 20)
  ctx.stroke()

  // Heading scale along the top.
  const hdg = ((fin(t.headingDeg) % 360) + 360) % 360
  for (let d = Math.floor((hdg - 22) / 5) * 5; d <= hdg + 22; d += 5) {
    const x = cx + (d - hdg) * 6
    const ten = ((d % 10) + 10) % 10 === 0
    line(ctx, x, 42, x, ten ? 56 : 50, HUD, 2)
    if (ten) txt(ctx, String(Math.round(((d % 360) + 360) % 360) / 10).padStart(2, '0'), x, 30, { size: 15, color: HUD, align: 'center' })
  }
  ctx.strokeStyle = HUD
  ctx.lineWidth = 2
  ctx.strokeRect(cx - 22, 60, 44, 22)
  txt(ctx, pad3(hdg), cx, 71, { size: 17, color: HUD, align: 'center' })

  // Airspeed (left) and altitude (right).
  ctx.strokeRect(52, cy - 14, 78, 28)
  txt(ctx, String(Math.round(speedValue(t.airspeed, units))), 91, cy, { size: 20, color: HUD, align: 'center' })
  txt(ctx, `M ${t.mach.toFixed(2)}`, 91, cy + 28, { size: 15, color: HUD, align: 'center' })
  ctx.strokeRect(w - 144, cy - 14, 92, 28)
  txt(ctx, String(Math.round(altitudeValue(t.altitude, units))), w - 98, cy, { size: 20, color: HUD, align: 'center' })
  txt(ctx, `${signed(verticalSpeedValue(t.verticalSpeed, units))}`, w - 98, cy + 28, { size: 15, color: HUD, align: 'center' })

  // Bottom line.
  txt(ctx, `G ${t.gForce.toFixed(1)}`, 60, h - 46, { size: 17, color: HUD })
  txt(ctx, `AOA ${t.angleOfAttackDeg.toFixed(1)}`, cx, h - 46, { size: 17, color: HUD, align: 'center' })
  if (t.afterburner) txt(ctx, 'AB', w - 60, h - 46, { size: 17, color: HUD, align: 'right' })
  else if (t.gearPosition > 0.5) txt(ctx, 'GEAR', w - 60, h - 46, { size: 17, color: HUD, align: 'right' })
  ctx.shadowBlur = 0
}

export function drawMfd(ctx: Ctx, w: number, h: number, s: PanelState): void {
  const { t } = s
  ctx.fillStyle = COL.bg
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = '#1d3a2a'
  ctx.lineWidth = 3
  ctx.strokeRect(3, 3, w - 6, h - 6)
  txt(ctx, 'ENG / CONFIG', w / 2, 20, { size: 17, color: COL.green, align: 'center' })

  // Two engine bars.
  for (let i = 0; i < 2; i++) {
    const x = 36 + i * 64
    ctx.fillStyle = '#17202b'
    ctx.fillRect(x, 44, 36, 122)
    const f = clamp(fin(t.n1) / 1.1, 0, 1)
    ctx.fillStyle = t.afterburner ? COL.amber : COL.green
    ctx.fillRect(x, 44 + 122 * (1 - f), 36, 122 * f)
    txt(ctx, `${Math.round(fin(t.n1) * 100)}`, x + 18, 180, { size: 16, align: 'center' })
    txt(ctx, `E${i + 1}`, x + 18, 198, { size: 14, color: COL.dim, align: 'center' })
  }
  const x0 = 156
  txt(ctx, 'GEAR', x0, 56, { size: 15, color: COL.dim })
  txt(ctx, t.gearPosition > 0.98 ? 'DOWN' : t.gearPosition < 0.02 ? 'UP' : 'TRANS', x0, 76, {
    size: 19,
    color: t.gearPosition > 0.98 ? COL.green : t.gearPosition < 0.02 ? COL.dim : COL.red,
  })
  txt(ctx, 'FLAPS', x0, 104, { size: 15, color: COL.dim })
  txt(ctx, `${Math.round(t.flapsDeg)}°`, x0, 124, { size: 19, color: COL.green })
  txt(ctx, 'SPD BRK', x0, 152, { size: 15, color: COL.dim })
  txt(ctx, t.speedbrake > 0.05 ? 'OUT' : 'IN', x0, 172, { size: 19, color: t.speedbrake > 0.05 ? COL.amber : COL.dim })
  txt(ctx, t.afterburner ? 'AFTERBURNER' : t.onGround ? 'ON GROUND' : 'AIRBORNE', w / 2, h - 22, {
    size: 15,
    color: t.afterburner ? COL.amber : COL.dim,
    align: 'center',
  })
}

/** Left MFD: artificial horizon with a pitch ladder, speed, altitude and heading. */
export function drawMfdAttitude(ctx: Ctx, w: number, h: number, s: PanelState): void {
  const { t, units } = s
  ctx.fillStyle = COL.bg
  ctx.fillRect(0, 0, w, h)
  const cx = w / 2
  const cy = h / 2 + 4
  const r = w * 0.4
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.clip()
  ctx.translate(cx, cy)
  ctx.rotate(-rad(fin(t.bankDeg)))
  const py = fin(t.pitchDeg) * 3.2
  ctx.fillStyle = '#1d5fa8'
  ctx.fillRect(-r * 2, -r * 2 + py, r * 4, r * 2)
  ctx.fillStyle = '#6b4a2b'
  ctx.fillRect(-r * 2, py, r * 4, r * 2)
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(-r, py)
  ctx.lineTo(r, py)
  ctx.stroke()
  for (const d of [-20, -10, 10, 20]) {
    const y = py - d * 3.2
    const half = d % 20 === 0 ? 34 : 20
    ctx.beginPath()
    ctx.moveTo(-half, y)
    ctx.lineTo(half, y)
    ctx.stroke()
    txt(ctx, String(Math.abs(d)), half + 12, y, { size: 12, color: COL.white, align: 'center' })
  }
  ctx.restore()
  ctx.strokeStyle = '#33414f'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.stroke()
  // Fixed aircraft symbol.
  ctx.strokeStyle = COL.yellow
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(cx - 46, cy)
  ctx.lineTo(cx - 14, cy)
  ctx.lineTo(cx - 14, cy + 8)
  ctx.moveTo(cx + 46, cy)
  ctx.lineTo(cx + 14, cy)
  ctx.lineTo(cx + 14, cy + 8)
  ctx.stroke()
  txt(ctx, 'ADI', w / 2, 14, { size: 15, color: COL.green, align: 'center' })
  txt(ctx, `${Math.round(speedValue(fin(t.airspeed), units))}`, 12, h - 16, { size: 18, color: COL.green })
  txt(ctx, `${Math.round(altitudeValue(fin(t.altitude), units))}`, w - 12, h - 16, { size: 18, color: COL.green, align: 'right' })
}

/** Right MFD: a compass rose with the heading, ground speed and the nearest airport. */
export function drawMfdNav(ctx: Ctx, w: number, h: number, s: PanelState): void {
  const { t, units } = s
  ctx.fillStyle = COL.bg
  ctx.fillRect(0, 0, w, h)
  const cx = w / 2
  const cy = h / 2 + 6
  const r = w * 0.38
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(-rad(fin(t.headingDeg)))
  ctx.strokeStyle = '#2a6a46'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.stroke()
  for (let d = 0; d < 360; d += 10) {
    const a = rad(d)
    const len = d % 30 === 0 ? 12 : 6
    ctx.beginPath()
    ctx.moveTo(Math.sin(a) * r, -Math.cos(a) * r)
    ctx.lineTo(Math.sin(a) * (r - len), -Math.cos(a) * (r - len))
    ctx.stroke()
    if (d % 90 === 0) txt(ctx, 'NESW'[d / 90], Math.sin(a) * (r - 26), -Math.cos(a) * (r - 26), { size: 16, color: COL.green, align: 'center' })
    else if (d % 30 === 0) txt(ctx, String(d / 10), Math.sin(a) * (r - 24), -Math.cos(a) * (r - 24), { size: 12, color: COL.dim, align: 'center' })
  }
  const near = t.nav.nearest
  if (near) {
    const a = rad(near.bearingDeg)
    const d = clamp(near.distance / 40000, 0.1, 1) * (r - 30)
    ctx.fillStyle = COL.cyan
    ctx.fillRect(Math.sin(a) * d - 4, -Math.cos(a) * d - 4, 8, 8)
  }
  ctx.restore()
  ctx.fillStyle = COL.yellow
  ctx.beginPath()
  ctx.moveTo(cx, cy - 14)
  ctx.lineTo(cx + 9, cy + 10)
  ctx.lineTo(cx, cy + 5)
  ctx.lineTo(cx - 9, cy + 10)
  ctx.closePath()
  ctx.fill()
  txt(ctx, 'HSD', w / 2, 14, { size: 15, color: COL.green, align: 'center' })
  txt(ctx, pad3(fin(t.headingDeg)), cx, 36, { size: 16, color: COL.white, align: 'center' })
  txt(ctx, `GS ${Math.round(speedValue(fin(t.groundSpeed), units))}`, 10, h - 14, { size: 14, color: COL.green })
  if (near) txt(ctx, near.code, w - 10, h - 14, { size: 14, color: COL.cyan, align: 'right' })
}

/** The small amber-green data display under the HUD (the "DED"): throttle, N1 and Mach. */
export function drawDed(ctx: Ctx, w: number, h: number, s: PanelState): void {
  const { t } = s
  ctx.fillStyle = '#04100a'
  ctx.fillRect(0, 0, w, h)
  const c = '#7dff9e'
  txt(ctx, `THR ${String(Math.round(fin(t.throttle) * 100)).padStart(3, ' ')}%   N1 ${String(Math.round(fin(t.n1) * 100)).padStart(3, ' ')}%`, 10, h * 0.22, { size: h * 0.2, color: c })
  txt(ctx, `MACH ${fin(t.mach).toFixed(2)}   G ${fin(t.gForce).toFixed(1)}`, 10, h * 0.5, { size: h * 0.2, color: c })
  txt(ctx, t.onGround ? 'WOW  BRK ' + Math.round(fin(t.brakes) * 100) + '%' : 'AIRBORNE', 10, h * 0.78, { size: h * 0.2, color: COL.amber })
}
