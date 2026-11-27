import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { setPerfScale } from './perfStats'
import { ResolutionGovernor } from './resolutionGovernor'

/** Seconds at the lowest resolution and still slow before the quality tier is lowered. */
const STUCK_AFTER = 10

/**
 * Keeps the frame rate up by changing how many pixels the canvas renders (the
 * governor decides, from the frame times). Mounted inside the Canvas.
 */
export function AdaptiveResolution({
  max,
  software,
  native,
  onStuck,
}: {
  max: number
  software: boolean
  native: boolean
  /** Called when the frames are still too slow at the lowest resolution: lower the quality tier. */
  onStuck?: () => void
}) {
  const setDpr = useThree((s) => s.setDpr)
  // A software renderer starts at a low resolution instead of finding its way down over several seconds.
  const governor = useMemo(
    () =>
      new ResolutionGovernor({
        max,
        // A real GPU never goes much below native: a blurry cockpit is worse than a few lost frames. No GPU: down to half.
        min: software ? 0.5 : native ? max : Math.min(max, 0.85),
        start: software ? Math.min(max, 0.65) : max,
      }),
    [max, software, native],
  )
  const applied = useRef(0)

  useEffect(() => {
    applied.current = governor.current
    setDpr(governor.current)
    setPerfScale(governor.current)
  }, [governor, setDpr])

  useFrame((_, delta) => {
    const r = governor.frame(delta * 1000)
    if (governor.stuckSeconds > STUCK_AFTER && onStuck) {
      governor.resetStuck()
      onStuck()
    }
    if (Math.abs(r - applied.current) > 0.01) {
      applied.current = r
      setDpr(r)
      setPerfScale(r)
    }
  })
  return null
}
