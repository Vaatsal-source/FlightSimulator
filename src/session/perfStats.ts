/**
 * Frame-time and renderer statistics for the F3 overlay. A tiny external store:
 * the probe inside the canvas writes it every frame (no React work), the DOM
 * overlay polls it a couple of times a second while visible.
 */

export interface PerfSnapshot {
  fps: number
  /** Mean frame time over the sample window (ms). */
  frameMs: number
  /** Slowest frame in the window (ms): the stutter indicator. */
  worstMs: number
  /** 1% low fps: the average of the slowest 1% of frames in the window. */
  low1Fps: number
  drawCalls: number
  triangles: number
  geometries: number
  textures: number
  /** JS heap in MB when the browser exposes it (Chromium), else null. */
  heapMb: number | null
}

const WINDOW = 240 // frames kept for the percentile stats

const frames = new Float32Array(WINDOW)
let count = 0
let head = 0
let drawCalls = 0
let triangles = 0
let geometries = 0
let textures = 0

export function recordFrame(deltaSeconds: number, info: { calls: number; triangles: number; geometries: number; textures: number }): void {
  frames[head] = deltaSeconds * 1000
  head = (head + 1) % WINDOW
  if (count < WINDOW) count++
  drawCalls = info.calls
  triangles = info.triangles
  geometries = info.geometries
  textures = info.textures
}

export function resetPerf(): void {
  count = 0
  head = 0
}

export function readPerf(): PerfSnapshot {
  if (count === 0) {
    return { fps: 0, frameMs: 0, worstMs: 0, low1Fps: 0, drawCalls, triangles, geometries, textures, heapMb: null }
  }
  const sample = Array.from(frames.subarray(0, count)).sort((a, b) => a - b)
  const mean = sample.reduce((a, b) => a + b, 0) / count
  const worst = sample[count - 1]
  const tailN = Math.max(1, Math.ceil(count * 0.01))
  const tail = sample.slice(count - tailN)
  const tailMean = tail.reduce((a, b) => a + b, 0) / tailN
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
  return {
    fps: mean > 0 ? 1000 / mean : 0,
    frameMs: mean,
    worstMs: worst,
    low1Fps: tailMean > 0 ? 1000 / tailMean : 0,
    drawCalls,
    triangles,
    geometries,
    textures,
    heapMb: mem ? mem.usedJSHeapSize / 1048576 : null,
  }
}
