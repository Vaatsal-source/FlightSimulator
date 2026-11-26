import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useState } from 'react'
import { readPerf, recordFrame, resetPerf, type PerfSnapshot } from './perfStats'

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
        `res ${snap.scale.toFixed(2)}x${snap.software ? '  (software rendering)' : ''}`,
        snap.heapMb !== null ? `heap ${snap.heapMb.toFixed(0)} MB` : null,
        'F3 hides',
      ]
        .filter(Boolean)
        .join('\n')}
    </pre>
  )
}
