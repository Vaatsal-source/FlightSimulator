import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { setPerfScale } from './perfStats'
import { ResolutionGovernor } from './resolutionGovernor'

/**
 * Keeps the frame rate up by changing how many pixels the canvas renders (the
 * governor decides, from the frame times). Mounted inside the Canvas.
 */
export function AdaptiveResolution({ max, software }: { max: number; software: boolean }) {
  const setDpr = useThree((s) => s.setDpr)
  // A software renderer starts at a low resolution instead of finding its way down over several seconds.
  const governor = useMemo(() => new ResolutionGovernor({ max, min: 0.5, start: software ? Math.min(max, 0.65) : max }), [max, software])
  const applied = useRef(0)

  useEffect(() => {
    applied.current = governor.current
    setDpr(governor.current)
    setPerfScale(governor.current)
  }, [governor, setDpr])

  useFrame((_, delta) => {
    const r = governor.frame(delta * 1000)
    if (Math.abs(r - applied.current) > 0.01) {
      applied.current = r
      setDpr(r)
      setPerfScale(r)
    }
  })
  return null
}
