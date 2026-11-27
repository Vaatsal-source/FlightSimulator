import { addAfterEffect, addEffect, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useState } from 'react'
import { useGameStore } from '../state/gameStore'
import { readPerf, recordFrame, resetPerf, setPerfGpu, setPerfRenderer, type PerfSnapshot } from './perfStats'

/** Inside the Canvas: records frame time and renderer counters. Cheap; always mounted. */
export function PerfProbe() {
  useEffect(() => {
    resetPerf()
  }, [])
  const scene = useThree((st) => st.scene)
  const renderer = useThree((st) => st.gl)
  const camera = useThree((st) => st.camera)
  useEffect(() => {
    // Dev only: lets the profiling scripts reach the scene.
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__flysim = { scene, gl: renderer, camera }
  }, [scene, renderer, camera])
  // GPU time per frame from the browser's timer query (Chromium on most GPUs), and the card's name.
  useEffect(() => {
    const ctx = renderer.getContext() as WebGL2RenderingContext
    try {
      const info = ctx.getExtension('WEBGL_debug_renderer_info')
      setPerfRenderer(String(info ? ctx.getParameter(info.UNMASKED_RENDERER_WEBGL) : ctx.getParameter(ctx.RENDERER)))
    } catch {
      setPerfRenderer('unknown')
    }
    const ext = ctx.getExtension('EXT_disjoint_timer_query_webgl2')
    if (!ext) return
    const pending: WebGLQuery[] = []
    let active: WebGLQuery | null = null
    const offBefore = addEffect(() => {
      if (active || pending.length > 4) return
      active = ctx.createQuery()
      ctx.beginQuery(ext.TIME_ELAPSED_EXT, active)
    })
    const offAfter = addAfterEffect(() => {
      if (active) {
        ctx.endQuery(ext.TIME_ELAPSED_EXT)
        pending.push(active)
        active = null
      }
      while (pending.length > 0) {
        const q = pending[0]
        if (ctx.getParameter(ext.GPU_DISJOINT_EXT)) {
          for (const d of pending.splice(0)) ctx.deleteQuery(d)
          break
        }
        if (!ctx.getQueryParameter(q, ctx.QUERY_RESULT_AVAILABLE)) break
        setPerfGpu(Number(ctx.getQueryParameter(q, ctx.QUERY_RESULT)) / 1e6)
        ctx.deleteQuery(q)
        pending.shift()
      }
    })
    return () => {
      offBefore()
      offAfter()
    }
  }, [renderer])
  useFrame(({ gl }, delta) => {
    // Counters of the previous frame: three resets them at the start of each render.
    const r = gl.info.render
    recordFrame(delta, {
      calls: r.calls,
      triangles: r.triangles,
      geometries: gl.info.memory.geometries,
      textures: gl.info.memory.textures,
    })
  })
  return null
}

const BUDGET_MS = 1000 / 55

/** Outside the Canvas: F3 toggles a small readout, refreshed twice a second. */
export function PerfOverlay() {
  const [visible, setVisible] = useState(false)
  const [snap, setSnap] = useState<PerfSnapshot | null>(null)
  const quality = useGameStore((s) => s.settings.quality)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'F3' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        setVisible((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!visible) return
    const tick = () => setSnap(readPerf())
    tick()
    const id = window.setInterval(tick, 500)
    return () => window.clearInterval(id)
  }, [visible])

  if (!visible || !snap) return null
  const slow = snap.frameMs > BUDGET_MS
  return (
    <pre
      aria-label="Performance stats"
      style={{
        position: 'absolute',
        top: 8,
        left: 8,
        margin: 0,
        padding: '6px 9px',
        font: '12px/1.35 ui-monospace, Consolas, monospace',
        color: slow ? '#ffb4a8' : '#b9f6ca',
        background: 'rgba(0,0,0,0.6)',
        borderRadius: 4,
        pointerEvents: 'none',
        zIndex: 50,
      }}
    >
      {[
        `${snap.fps.toFixed(0)} fps   ${snap.frameMs.toFixed(1)} ms`,
        `1% low ${snap.low1Fps.toFixed(0)} fps   worst ${snap.worstMs.toFixed(0)} ms`,
        `draws ${snap.drawCalls}   tris ${(snap.triangles / 1000).toFixed(0)}k`,
        `geom ${snap.geometries}   tex ${snap.textures}`,
        `quality ${quality}   res ${snap.scale.toFixed(2)}x${snap.software ? '  (software rendering)' : ''}`,
        `gpu ${snap.gpuMs === null ? 'n/a' : snap.gpuMs.toFixed(1) + ' ms'}   ${snap.renderer.replace(/ANGLE \(|\)/g, '').slice(0, 44)}`,
        snap.heapMb !== null ? `heap ${snap.heapMb.toFixed(0)} MB` : null,
        'F3 hides',
      ]
        .filter(Boolean)
        .join('\n')}
    </pre>
  )
}
