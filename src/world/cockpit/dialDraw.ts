/**
 * The trainer's steam-gauge panel: six round instruments (airspeed, attitude,
 * altimeter / heading, vertical speed, tachometer) on one canvas, three by two.
 */

import { altitudeValue, speedValue, verticalSpeedValue } from '../../components/format'
import { arc, clamp, COL, fin, line, polar, rad, txt, type Ctx, type PanelState } from './canvasKit'

const R = 148

function face(ctx: Ctx, cx: number, cy: number): void {
  const bezel = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R)
  bezel.addColorStop(0, '#4a4f5a')
  bezel.addColorStop(1, '#15171c')
  ctx.fillStyle = bezel
  ctx.beginPath()
  ctx.arc(cx, cy, R + 12, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#07080b'
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.fill()
}

function ticks(
  ctx: Ctx,
  cx: number,
  cy: number,
  min: number,
  max: number,
  startDeg: number,
  endDeg: number,
  major: number,
  minor: number,
  fmt: (v: number) => string = (v) => String(v),
): void {
  const ang = (v: number) => startDeg + ((v - min) / (max - min)) * (endDeg - startDeg)
  for (let v = min; v <= max + 1e-6; v += minor) {
    const isMajor = Math.abs(v / major - Math.round(v / major)) < 1e-6
    const [x1, y1] = polar(cx, cy, R - 4, ang(v))
    const [x2, y2] = polar(cx, cy, R - (isMajor ? 24 : 14), ang(v))
    line(ctx, x1, y1, x2, y2, COL.white, isMajor ? 3 : 2)
    if (isMajor) {
      const [tx, ty] = polar(cx, cy, R - 46, ang(v))
      txt(ctx, fmt(v), tx, ty, { size: 22, align: 'center' })
    }
  }
}

function needle(ctx: Ctx, cx: number, cy: number, deg: number, len: number, color = COL.white, width = 5): void {
  const [x, y] = polar(cx, cy, len, deg)
  const [bx, by] = polar(cx, cy, -22, deg)
  line(ctx, bx, by, x, y, color, width)
  ctx.fillStyle = '#2a2d34'
  ctx.beginPath()
  ctx.arc(cx, cy, 9, 0, Math.PI * 2)
  ctx.fill()
}

export function airspeed(ctx: Ctx, cx: number, cy: number, s: PanelState): void {
  const { units, speeds } = s
  face(ctx, cx, cy)
  const imperial = units === 'imperial'
  const maxOp = speedValue(speeds.maxOperating, units)
  const step = imperial ? 20 : 40
  const max = Math.ceil((maxOp * 1.15) / step) * step
  const major = imperial ? 20 : 40
  const a = (v: number) => -140 + (clamp(speedValue(v, units), 0, max) / max) * 280
  arc(ctx, cx, cy, R - 10, a(speeds.stallClean * 0.85), a(speeds.approach * 1.2), COL.white, 6)
  const caution = speeds.stallClean + (speeds.maxOperating - speeds.stallClean) * 0.82
  arc(ctx, cx, cy, R - 18, a(speeds.stallClean), a(caution), '#35c46a', 8)
  arc(ctx, cx, cy, R - 18, a(caution), a(speeds.maxOperating), COL.yellow, 8)
  const [rx1, ry1] = polar(cx, cy, R - 4, a(speeds.maxOperating))
  const [rx2, ry2] = polar(cx, cy, R - 28, a(speeds.maxOperating))
  line(ctx, rx1, ry1, rx2, ry2, COL.red, 5)
  ticks(ctx, cx, cy, 0, max, -140, 140, major, major / 2, (v) => (v % (major * 2) === 0 ? String(v) : ''))
  txt(ctx, imperial ? 'KNOTS' : 'KM/H', cx, cy + 52, { size: 17, color: COL.dim, align: 'center' })
  needle(ctx, cx, cy, -140 + (clamp(speedValue(s.t.airspeed, units), 0, max) / max) * 280, R - 30)
}

export function attitude(ctx: Ctx, cx: number, cy: number, s: PanelState): void {
  face(ctx, cx, cy)
  const ppd = 3.4
  const p = clamp(fin(s.t.pitchDeg), -90, 90)
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, R - 4, 0, Math.PI * 2)
  ctx.clip()
  ctx.translate(cx, cy)
  ctx.rotate(-rad(fin(s.t.bankDeg)))
  ctx.translate(0, p * ppd)
  ctx.fillStyle = '#2c7ad4'
  ctx.fillRect(-400, -800, 800, 800)
  ctx.fillStyle = '#7b5233'
  ctx.fillRect(-400, 0, 800, 800)
  line(ctx, -400, 0, 400, 0, COL.white, 3)
  for (let d = -30; d <= 30; d += 5) {
    if (d === 0) continue
    const w = d % 10 === 0 ? 40 : 22
    line(ctx, -w, -d * ppd, w, -d * ppd, COL.white, 2.5)
    if (d % 10 === 0) txt(ctx, String(Math.abs(d)), w + 8, -d * ppd, { size: 16, align: 'left' })
  }
  ctx.restore()
  for (const d of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
    const [x1, y1] = polar(cx, cy, R - 4, d)
    const [x2, y2] = polar(cx, cy, R - (d % 30 === 0 ? 24 : 16), d)
    line(ctx, x1, y1, x2, y2, COL.white, 3)
  }
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(-rad(fin(s.t.bankDeg)))
  ctx.fillStyle = COL.yellow
  ctx.beginPath()
  ctx.moveTo(0, -(R - 6))
  ctx.lineTo(-9, -(R - 26))
  ctx.lineTo(9, -(R - 26))
  ctx.fill()
  ctx.restore()
  ctx.strokeStyle = COL.yellow
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.moveTo(cx - 76, cy)
  ctx.lineTo(cx - 30, cy)
  ctx.lineTo(cx - 24, cy + 12)
  ctx.moveTo(cx + 76, cy)
  ctx.lineTo(cx + 30, cy)
  ctx.lineTo(cx + 24, cy + 12)
  ctx.stroke()
  ctx.fillStyle = COL.yellow
  ctx.fillRect(cx - 4, cy - 4, 8, 8)
}

export function altimeter(ctx: Ctx, cx: number, cy: number, s: PanelState): void {
  face(ctx, cx, cy)
  const v = altitudeValue(s.t.altitude, s.units)
  const wrap = (x: number, m: number) => ((x % m) + m) % m
  ticks(ctx, cx, cy, 0, 9.5, 0, 342, 1, 0.5, (n) => String(n % 10))
  txt(ctx, s.units === 'imperial' ? 'ALT FT' : 'ALT M', cx, cy + 52, { size: 17, color: COL.dim, align: 'center' })
  needle(ctx, cx, cy, (wrap(v, 10000) / 10000) * 360, 70, COL.white, 9)
  needle(ctx, cx, cy, (wrap(v, 1000) / 1000) * 360, R - 30)
}

export function heading(ctx: Ctx, cx: number, cy: number, s: PanelState): void {
  face(ctx, cx, cy)
  const h = fin(s.t.headingDeg)
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(-rad(h))
  for (let d = 0; d < 360; d += 10) {
    const [x1, y1] = polar(0, 0, R - 4, d)
    const [x2, y2] = polar(0, 0, R - (d % 30 === 0 ? 26 : 16), d)
    line(ctx, x1, y1, x2, y2, COL.white, d % 30 === 0 ? 3 : 2)
    if (d % 30 === 0) {
      const [tx, ty] = polar(0, 0, R - 46, d)
      ctx.save()
      ctx.translate(tx, ty)
      ctx.rotate(rad(d))
      const card = ({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' } as Record<number, string>)[d]
      txt(ctx, card ?? String(d / 10), 0, 0, { size: card ? 28 : 21, color: card ? COL.amber : COL.white, align: 'center' })
      ctx.restore()
    }
  }
  ctx.restore()
  ctx.fillStyle = COL.white
  ctx.beginPath()
  ctx.moveTo(cx, cy - 56)
  ctx.lineTo(cx - 14, cy + 20)
  ctx.lineTo(cx, cy + 8)
  ctx.lineTo(cx + 14, cy + 20)
  ctx.fill()
  ctx.fillStyle = COL.yellow
  ctx.beginPath()
  ctx.moveTo(cx, cy - R + 2)
  ctx.lineTo(cx - 9, cy - R + 20)
  ctx.lineTo(cx + 9, cy - R + 20)
  ctx.fill()
}

export function vsi(ctx: Ctx, cx: number, cy: number, s: PanelState): void {
  face(ctx, cx, cy)
  const imperial = s.units === 'imperial'
  const max = imperial ? 2000 : 10
  const step = imperial ? 500 : 2
  const v = clamp(verticalSpeedValue(s.t.verticalSpeed, s.units), -max, max)
  const ang = (x: number) => -90 + (x / max) * 150
  for (let x = -max; x <= max + 1e-6; x += step / 2) {
    const major = Math.abs(x % step) < 1e-6
    const [x1, y1] = polar(cx, cy, R - 4, ang(x))
    const [x2, y2] = polar(cx, cy, R - (major ? 24 : 14), ang(x))
    line(ctx, x1, y1, x2, y2, COL.white, major ? 3 : 2)
    if (major) {
      const [tx, ty] = polar(cx, cy, R - 46, ang(x))
      txt(ctx, String(Math.abs(imperial ? x / 100 : x)), tx, ty, { size: 20, align: 'center' })
    }
  }
  txt(ctx, imperial ? 'VSI x100' : 'VSI M/S', cx + 8, cy + 56, { size: 16, color: COL.dim, align: 'center' })
  needle(ctx, cx, cy, ang(v), R - 30)
}

export function tach(ctx: Ctx, cx: number, cy: number, s: PanelState): void {
  face(ctx, cx, cy)
  const a = (v: number) => -135 + (v / 3000) * 270
  arc(ctx, cx, cy, R - 14, a(1500), a(2500), '#35c46a', 9)
  arc(ctx, cx, cy, R - 14, a(2500), a(2700), COL.yellow, 9)
  arc(ctx, cx, cy, R - 14, a(2700), a(3000), COL.red, 9)
  ticks(ctx, cx, cy, 0, 3000, -135, 135, 500, 250, (v) => String(v / 100))
  txt(ctx, 'RPM x100', cx, cy + 52, { size: 16, color: COL.dim, align: 'center' })
  needle(ctx, cx, cy, a(clamp(fin(s.t.rpm), 0, 3000)), R - 30)
}

/** The whole panel: `w` x `h` is one 3x2 grid. */
export function drawSixPack(ctx: Ctx, w: number, h: number, s: PanelState): void {
  ctx.fillStyle = '#101216'
  ctx.fillRect(0, 0, w, h)
  const cw = w / 3
  const ch = h / 2
  const cells = [airspeed, attitude, altimeter, tach, heading, vsi]
  cells.forEach((draw, i) => draw(ctx, cw * (i % 3) + cw / 2, ch * Math.floor(i / 3) + ch / 2, s))
}
