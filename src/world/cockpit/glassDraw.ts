/**
 * Airliner glass cockpit screens: primary flight display (PFD), engine/warning
 * display (EICAS) and the autopilot control strip (MCP). Drawn to 2D canvases
 * that become textures; see CockpitModel.
 */

import { altitudeValue, speedValue, verticalSpeedValue } from '../../components/format'
import { arc, clamp, COL, fin, line, pad3, polar, rad, signed, txt, type Ctx, type PanelState } from './canvasKit'

const CX = 256
const CY = 238
const PPD = 5.6 // pixels per degree of pitch
const TAPE_TOP = 44
const TAPE_BOT = 432

/** Vertical scrolling tape: the value sits at CY, higher values above it. */
function tape(
  ctx: Ctx,
  x: number,
  w: number,
  value: number,
  halfSpan: number,
  major: number,
  minor: number,
  side: 'left' | 'right',
): (v: number) => number {
  const ppu = (CY - TAPE_TOP) / halfSpan
  const yOf = (v: number) => CY - (v - value) * ppu
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, TAPE_TOP, w, TAPE_BOT - TAPE_TOP)
  ctx.clip()
  ctx.fillStyle = 'rgba(8,10,16,0.74)'
  ctx.fillRect(x, TAPE_TOP, w, TAPE_BOT - TAPE_TOP)
  const lo = Math.floor((value - halfSpan * 1.05) / minor) * minor
  for (let v = lo; v <= value + halfSpan * 1.05; v += minor) {
    if (v < 0 && side === 'left') continue
    const y = yOf(v)
    const isMajor = Math.abs(v / major - Math.round(v / major)) < 1e-6
    const edge = side === 'left' ? x + w : x
    const len = isMajor ? 16 : 8
    line(ctx, edge, y, side === 'left' ? edge - len : edge + len, y, COL.white, 2)
    if (isMajor) {
      txt(ctx, String(Math.round(v)), side === 'left' ? edge - 22 : edge + 22, y, {
        size: 19,
        align: side === 'left' ? 'right' : 'left',
      })
    }
  }
  ctx.restore()
  return yOf
}

function readoutBox(ctx: Ctx, x: number, w: number, text: string, color: string): void {
  ctx.fillStyle = '#000'
  ctx.fillRect(x, CY - 21, w, 42)
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.strokeRect(x, CY - 21, w, 42)
  txt(ctx, text, x + w / 2, CY, { size: 26, color, align: 'center' })
}

export function drawPfd(ctx: Ctx, w: number, h: number, s: PanelState): void {
  const { t, units, speeds } = s
  const pitch = clamp(fin(t.pitchDeg), -90, 90)
  const bank = fin(t.bankDeg)

  // --- Attitude (fills the display) ---
  ctx.save()
  ctx.fillStyle = COL.bg
  ctx.fillRect(0, 0, w, h)
  ctx.translate(CX, CY)
  ctx.rotate(-rad(bank))
  ctx.translate(0, pitch * PPD)
  const sky = ctx.createLinearGradient(0, -900, 0, 0)
  sky.addColorStop(0, COL.sky)
  sky.addColorStop(1, COL.skyLow)
  ctx.fillStyle = sky
  ctx.fillRect(-900, -1400, 1800, 1400)
  const ground = ctx.createLinearGradient(0, 0, 0, 900)
  ground.addColorStop(0, COL.ground)
  ground.addColorStop(1, COL.groundLow)
  ctx.fillStyle = ground
  ctx.fillRect(-900, 0, 1800, 1400)
  line(ctx, -900, 0, 900, 0, COL.white, 3)
  for (let d = -30; d <= 30; d += 2.5) {
    if (d === 0) continue
    const y = -d * PPD
    const ten = d % 10 === 0
    const five = d % 5 === 0
    const half = ten ? 64 : five ? 36 : 18
    line(ctx, -half, y, half, y, COL.white, 2.5)
    if (ten) {
      txt(ctx, String(Math.abs(d)), -half - 8, y, { size: 18, align: 'right' })
      txt(ctx, String(Math.abs(d)), half + 8, y, { size: 18, align: 'left' })
    }
  }
  ctx.restore()

  // --- Bank scale ---
  for (const d of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
    const [x1, y1] = polar(CX, CY, 178, d)
    const [x2, y2] = polar(CX, CY, d % 30 === 0 ? 160 : 168, d)
    line(ctx, x1, y1, x2, y2, COL.white, 2.5)
  }
  ctx.save()
  ctx.translate(CX, CY)
  ctx.rotate(-rad(bank))
  ctx.fillStyle = COL.yellow
  ctx.beginPath()
  ctx.moveTo(0, -176)
  ctx.lineTo(-9, -158)
  ctx.lineTo(9, -158)
  ctx.closePath()
  ctx.fill()
  ctx.restore()

  // --- Aircraft symbol ---
  ctx.strokeStyle = '#000'
  ctx.lineWidth = 9
  ctx.beginPath()
  ctx.moveTo(CX - 92, CY)
  ctx.lineTo(CX - 34, CY)
  ctx.lineTo(CX - 34, CY + 14)
  ctx.moveTo(CX + 92, CY)
  ctx.lineTo(CX + 34, CY)
  ctx.lineTo(CX + 34, CY + 14)
  ctx.stroke()
  ctx.strokeStyle = COL.yellow
  ctx.lineWidth = 5
  ctx.stroke()
  ctx.fillStyle = COL.yellow
  ctx.fillRect(CX - 4, CY - 4, 8, 8)

  // --- Speed tape ---
  const imperial = units === 'imperial'
  const spd = speedValue(t.airspeed, units)
  const yOfSpd = tape(ctx, 6, 92, spd, imperial ? 40 : 75, imperial ? 10 : 20, imperial ? 5 : 10, 'left')
  const vs = speedValue(speeds.stallClean, units)
  const vmo = speedValue(speeds.maxOperating, units)
  ctx.save()
  ctx.beginPath()
  ctx.rect(6, TAPE_TOP, 92, TAPE_BOT - TAPE_TOP)
  ctx.clip()
  ctx.fillStyle = COL.red
  ctx.fillRect(98, clamp(yOfSpd(vs * 1.08), TAPE_TOP, TAPE_BOT), 6, TAPE_BOT)
  ctx.fillStyle = COL.amber
  ctx.fillRect(98, clamp(yOfSpd(vs * 1.25), TAPE_TOP, TAPE_BOT), 6, Math.max(0, yOfSpd(vs * 1.08) - yOfSpd(vs * 1.25)))
  ctx.fillStyle = COL.red
  const yv = clamp(yOfSpd(vmo), TAPE_TOP, TAPE_BOT)
  ctx.fillRect(98, TAPE_TOP, 6, Math.max(0, yv - TAPE_TOP))
  for (const [v, mark, color] of [
    [speedValue(speeds.rotate, units), 'R', COL.cyan],
    [speedValue(speeds.approach, units), 'A', COL.magenta],
  ] as const) {
    const y = yOfSpd(v)
    if (y > TAPE_TOP + 8 && y < TAPE_BOT - 8) {
      line(ctx, 82, y, 98, y, color, 3)
      txt(ctx, mark, 70, y, { size: 16, color, align: 'right' })
    }
  }
  if (s.ap.athr && s.ap.targets.speed > 0) {
    const y = yOfSpd(speedValue(s.ap.targets.speed, units))
    ctx.fillStyle = COL.magenta
    ctx.beginPath()
    ctx.moveTo(98, clamp(y, TAPE_TOP + 6, TAPE_BOT - 6))
    ctx.lineTo(112, clamp(y, TAPE_TOP + 6, TAPE_BOT - 6) - 8)
    ctx.lineTo(112, clamp(y, TAPE_TOP + 6, TAPE_BOT - 6) + 8)
    ctx.fill()
  }
  ctx.restore()
  readoutBox(ctx, 4, 96, String(Math.max(0, Math.round(spd))), spd < vs * 1.08 && !t.onGround ? COL.red : COL.white)
  if (t.mach > 0.45) txt(ctx, `M ${t.mach.toFixed(2).replace(/^0/, '')}`, 54, TAPE_BOT - 14, { size: 20, color: COL.green, align: 'center' })

  // --- Altitude tape ---
  const alt = altitudeValue(t.altitude, units)
  const yOfAlt = tape(ctx, 388, 92, alt, imperial ? 200 : 100, imperial ? 100 : 50, imperial ? 20 : 10, 'right')
  ctx.save()
  ctx.beginPath()
  ctx.rect(388, TAPE_TOP, 92, TAPE_BOT - TAPE_TOP)
  ctx.clip()
  const terrainAlt = altitudeValue(t.altitude - t.heightAboveGround, units)
  const yg = yOfAlt(terrainAlt)
  if (yg < TAPE_BOT) {
    ctx.fillStyle = 'rgba(150,72,28,0.85)'
    ctx.fillRect(388, Math.max(TAPE_TOP, yg), 8, TAPE_BOT)
  }
  if (s.ap.ap && s.ap.targets.altitude > 0) {
    const y = clamp(yOfAlt(altitudeValue(s.ap.targets.altitude, units)), TAPE_TOP + 8, TAPE_BOT - 8)
    ctx.fillStyle = COL.magenta
    ctx.beginPath()
    ctx.moveTo(388, y)
    ctx.lineTo(374, y - 9)
    ctx.lineTo(374, y + 9)
    ctx.fill()
  }
  ctx.restore()
  readoutBox(ctx, 372, 108, String(Math.round(alt)), COL.white)

  // --- Vertical speed strip ---
  const vsMax = imperial ? 2000 : 10
  const vsv = verticalSpeedValue(t.verticalSpeed, units)
  ctx.fillStyle = 'rgba(8,10,16,0.74)'
  ctx.fillRect(482, TAPE_TOP + 40, 26, TAPE_BOT - TAPE_TOP - 80)
  for (const m of [-1, -0.5, 0, 0.5, 1]) {
    const y = CY - m * 130
    line(ctx, 482, y, m === 0 ? 508 : 496, y, COL.white, 2)
  }
  const vy = CY - clamp(vsv / vsMax, -1, 1) * 130
  line(ctx, 508, CY, 486, vy, COL.green, 3)
  if (Math.abs(vsv) > (imperial ? 200 : 1)) {
    txt(ctx, signed(imperial ? Math.round(vsv / 100) * 100 : vsv), 478, clamp(vy + (vsv > 0 ? -16 : 16), TAPE_TOP + 20, TAPE_BOT - 20), {
      size: 17,
      color: COL.green,
      align: 'right',
    })
  }

  // --- Heading tape ---
  const hdg = ((fin(t.headingDeg) % 360) + 360) % 360
  const ppdH = 7
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 448, w, h - 448)
  ctx.clip()
  ctx.fillStyle = 'rgba(8,10,16,0.88)'
  ctx.fillRect(0, 448, w, h - 448)
  for (let d = Math.floor((hdg - 38) / 5) * 5; d <= hdg + 38; d += 5) {
    const x = CX + (d - hdg) * ppdH
    const ten = ((d % 10) + 10) % 10 === 0
    line(ctx, x, 448, x, ten ? 466 : 458, COL.white, 2)
    if (ten) txt(ctx, pad3(d), x, 486, { size: 19, align: 'center' })
  }
  if (s.ap.ap && s.ap.targets.headingDeg >= 0) {
    let dd = s.ap.targets.headingDeg - hdg
    dd = ((dd + 540) % 360) - 180
    const x = CX + clamp(dd, -36, 36) * ppdH
    ctx.fillStyle = COL.magenta
    ctx.beginPath()
    ctx.moveTo(x, 449)
    ctx.lineTo(x - 8, 462)
    ctx.lineTo(x + 8, 462)
    ctx.fill()
  }
  ctx.restore()
  ctx.fillStyle = '#000'
  ctx.fillRect(CX - 36, 428, 72, 32)
  ctx.strokeStyle = COL.white
  ctx.lineWidth = 2
  ctx.strokeRect(CX - 36, 428, 72, 32)
  txt(ctx, pad3(hdg), CX, 444, { size: 24, align: 'center' })
  ctx.fillStyle = COL.yellow
  ctx.beginPath()
  ctx.moveTo(CX, 462)
  ctx.lineTo(CX - 7, 472)
  ctx.lineTo(CX + 7, 472)
  ctx.fill()

  // --- Radio altitude ---
  if (!t.onGround && t.heightAboveGround < (imperial ? 762 : 760)) {
    const ra = altitudeValue(t.heightAboveGround, units)
    txt(ctx, String(Math.round(ra / (ra > 100 ? 10 : 1)) * (ra > 100 ? 10 : 1)), CX, CY + 118, {
      size: 30,
      color: ra < (imperial ? 400 : 120) ? COL.amber : COL.green,
      align: 'center',
    })
  }

  // --- Flight mode annunciator ---
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, w, 36)
  const col = (i: number) => 64 + i * 128
  txt(ctx, s.ap.athr ? 'A/THR' : '', col(0), 18, { size: 21, color: COL.green, align: 'center' })
  txt(ctx, s.ap.ap ? s.ap.vertical : '', col(1), 18, { size: 21, color: COL.green, align: 'center' })
  txt(ctx, s.ap.ap ? 'HDG' : '', col(2), 18, { size: 21, color: COL.green, align: 'center' })
  txt(ctx, s.ap.ap ? 'AP' : s.ap.athr ? '' : '', col(3), 18, { size: 21, color: COL.white, align: 'center' })
  for (let i = 1; i < 4; i++) line(ctx, i * 128, 4, i * 128, 32, '#2a303c', 1)

  if (t.stalled) {
    ctx.fillStyle = 'rgba(255,40,30,0.88)'
    ctx.fillRect(CX - 70, 108, 140, 40)
    txt(ctx, 'STALL', CX, 128, { size: 28, color: '#fff', align: 'center' })
  } else if (t.stallWarning) {
    txt(ctx, 'STALL', CX, 128, { size: 28, color: COL.amber, align: 'center' })
  }
}

/** N1 dial with a digital readout. */
function n1Dial(ctx: Ctx, cx: number, cy: number, r: number, n1: number, label: string): void {
  const pct = clamp(fin(n1) * 100, 0, 110)
  const a = (v: number) => -135 + (v / 110) * 270
  arc(ctx, cx, cy, r, a(0), a(110), '#1b2230', 9)
  arc(ctx, cx, cy, r, a(0), a(Math.min(pct, 100)), COL.green, 9)
  if (pct > 100) arc(ctx, cx, cy, r, a(100), a(pct), COL.red, 9)
  const [nx, ny] = polar(cx, cy, r - 4, a(pct))
  line(ctx, cx, cy, nx, ny, COL.white, 3)
  txt(ctx, pct.toFixed(1), cx, cy + r * 0.55, { size: 22, color: COL.green, align: 'center' })
  txt(ctx, label, cx, cy - r - 14, { size: 16, color: COL.dim, align: 'center' })
}

export function drawEicas(ctx: Ctx, w: number, h: number, s: PanelState): void {
  const { t } = s
  ctx.fillStyle = COL.bg
  ctx.fillRect(0, 0, w, h)
  txt(ctx, 'N1 %', 12, 16, { size: 16, color: COL.dim })
  const xs = s.engines <= 1 ? [140] : [78, 206]
  xs.forEach((x, i) => n1Dial(ctx, x, 118, 52, t.n1, xs.length > 1 ? `ENG ${i + 1}` : 'ENG'))
  // Throttle position.
  txt(ctx, 'THR', 12, 214, { size: 16, color: COL.dim })
  ctx.fillStyle = '#1b2230'
  ctx.fillRect(60, 204, 160, 16)
  ctx.fillStyle = COL.cyan
  ctx.fillRect(60, 204, 160 * clamp(t.throttle, 0, 1), 16)

  // Configuration column.
  const x0 = 290
  const gearDown = t.gearPosition > 0.98
  const gearUp = t.gearPosition < 0.02
  txt(ctx, 'GEAR', x0, 22, { size: 16, color: COL.dim })
  for (let i = 0; i < 3; i++) {
    const x = x0 + 18 + i * 44
    ctx.fillStyle = gearUp ? '#1b2230' : gearDown ? COL.green : COL.red
    ctx.fillRect(x, 36, 34, 22)
    txt(ctx, i === 0 ? 'N' : i === 1 ? 'L' : 'R', x + 17, 47, { size: 14, color: gearUp ? COL.dim : '#001a08', align: 'center' })
  }
  txt(ctx, 'FLAPS', x0, 88, { size: 16, color: COL.dim })
  txt(ctx, `${Math.round(t.flapsDeg)}°`, x0 + 120, 88, { size: 24, color: COL.green })
  txt(ctx, 'BRK', x0, 122, { size: 16, color: COL.dim })
  txt(ctx, t.brakes > 0.05 ? 'ON' : 'OFF', x0 + 120, 122, { size: 20, color: t.brakes > 0.05 ? COL.amber : COL.dim })
  txt(ctx, 'SPD BRK', x0, 154, { size: 16, color: COL.dim })
  txt(ctx, t.speedbrake > 0.05 ? 'EXT' : 'RET', x0 + 120, 154, { size: 20, color: t.speedbrake > 0.05 ? COL.amber : COL.dim })
  txt(ctx, 'REV', x0, 186, { size: 16, color: COL.dim })
  txt(ctx, t.reverse > 0.05 ? 'DEPLOY' : 'STOW', x0 + 120, 186, { size: 20, color: t.reverse > 0.05 ? COL.amber : COL.dim })
  txt(ctx, `G ${t.gForce.toFixed(1)}`, x0, 222, { size: 18, color: COL.white })
}

/** Autopilot control strip above the main screens. */
export function drawMcp(ctx: Ctx, w: number, h: number, s: PanelState): void {
  const { units } = s
  ctx.fillStyle = '#0c0f15'
  ctx.fillRect(0, 0, w, h)
  const win = (x: number, label: string, value: string, lit: boolean) => {
    txt(ctx, label, x + 78, 18, { size: 16, color: COL.dim, align: 'center' })
    ctx.fillStyle = '#000'
    ctx.fillRect(x + 6, 32, 144, 50)
    ctx.strokeStyle = '#242a36'
    ctx.lineWidth = 2
    ctx.strokeRect(x + 6, 32, 144, 50)
    txt(ctx, value, x + 78, 58, { size: 34, color: lit ? COL.amber : '#5a4a1c', align: 'center' })
  }
  const on = s.ap.ap || s.ap.athr
  const tg = s.ap.targets
  win(0, units === 'imperial' ? 'SPD KT' : 'SPD KM/H', on && tg.speed > 0 ? String(Math.round(speedValue(tg.speed, units))) : '---', s.ap.athr)
  win(190, 'HDG', on ? pad3(tg.headingDeg) : '---', s.ap.ap)
  win(380, units === 'imperial' ? 'ALT FT' : 'ALT M', on && tg.altitude > 0 ? String(Math.round(altitudeValue(tg.altitude, units))) : '-----', s.ap.ap)
  win(570, units === 'imperial' ? 'V/S FPM' : 'V/S M/S', s.ap.ap && s.ap.vertical === 'VS' ? signed(verticalSpeedValue(tg.verticalSpeed, units)) : '-----', s.ap.ap)
  ctx.fillStyle = s.ap.ap ? COL.green : '#1b2230'
  ctx.fillRect(740, 36, 22, 14)
  ctx.fillStyle = s.ap.athr ? COL.green : '#1b2230'
  ctx.fillRect(740, 62, 22, 14)
}
