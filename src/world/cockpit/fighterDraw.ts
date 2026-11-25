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
