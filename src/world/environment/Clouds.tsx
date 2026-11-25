import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  CanvasTexture,
  Color,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
} from 'three'
import type { QualityProfile } from '../../config/quality'
import type { TimeOfDay } from '../types'
import { environmentFor } from './constants'
import { generateClouds, puffLight, type CloudSpec } from './envMath'

/** Clouds are grouped into square cells of this size (m), each one instanced mesh. */
const CELL = 20000
/** Half the diagonal of a cell, plus cloud extent: a cell is skipped when even its nearest edge is out of range. */
const CELL_RADIUS = CELL * 0.72

const VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
#include <fog_pars_vertex>
attribute float aLight;
varying vec2 vUv;
varying float vLight;
varying float vFade;
void main() {
  vUv = uv;
  vLight = aLight;
  vec4 centre = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec2 size = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
  vec4 mvPosition = modelViewMatrix * centre;
  float d = -mvPosition.z;
  // Face the camera, and thin out when the camera is inside or very close to a puff.
  mvPosition.xy += position.xy * size;
  vFade = smoothstep(0.1, 0.8, d / (size.x * 0.9));
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}
`

const FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uLit;
uniform vec3 uShade;
uniform float uOpacity;
varying vec2 vUv;
varying float vLight;
varying float vFade;
#include <common>
#include <logdepthbuf_pars_fragment>
#include <fog_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * vFade * uOpacity;
  if (a < 0.01) discard;
  vec3 col = mix(uShade, uLit, vLight) * (0.88 + 0.12 * t.r);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`

/** A soft, lumpy white blob: several overlapping radial gradients, painted once. */
function makePuffTexture(): CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx) {
    let seed = 1234567
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
    const blob = (x: number, y: number, r: number, a: number) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, `rgba(255,255,255,${a})`)
      g.addColorStop(0.55, `rgba(255,255,255,${a * 0.55})`)
      g.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, size, size)
    }
    blob(size / 2, size / 2, size * 0.46, 0.9)
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + rnd() * 0.5
      const d = size * (0.14 + rnd() * 0.14)
      blob(size / 2 + Math.cos(a) * d, size / 2 + Math.sin(a) * d * 0.85, size * (0.16 + rnd() * 0.12), 0.75)
    }
  }
  const texture = new CanvasTexture(canvas)
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.generateMipmaps = false
  return texture
}

interface Cell {
  mesh: InstancedMesh
  cx: number
  cz: number
  /** The clouds of this cell, kept so the lighting can be redone when the sun moves. */
  clouds: CloudSpec[]
  puffCount: number
}

/**
 * Deterministic soft clouds between 800 and 2500 m over the whole world.
 * Each puff is a camera-facing sprite with a shaded base and a sunlit
 * highlight (two triangles each). Clouds are split into 20 km cells (one
 * instanced mesh each), so the frustum culls cells off-screen and cells beyond
 * the fog distance are hidden.
 */
export function Clouds({ profile, timeOfDay }: { profile: QualityProfile; timeOfDay: TimeOfDay }) {
  const camera = useThree((s) => s.camera)
  const count = profile.cloudCount
  const cullDistance = profile.fogFar * 1.05

  const resources = useMemo(() => {
    const geometry = new PlaneGeometry(1, 1)
    const texture = makePuffTexture()
    const material = new ShaderMaterial({
      uniforms: UniformsUtils.merge([
        UniformsLib.fog,
        { uMap: { value: texture }, uLit: { value: new Color(0xffffff) }, uShade: { value: new Color(0x8394a8) }, uOpacity: { value: 0.92 } },
      ]),
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      fog: true,
    })
    const clouds = generateClouds(count)

    const byCell = new Map<string, CloudSpec[]>()
    for (const c of clouds) {
      const key = `${Math.floor(c.x / CELL)},${Math.floor(c.z / CELL)}`
      const list = byCell.get(key)
      if (list) list.push(c)
      else byCell.set(key, [c])
    }

    const cells: Cell[] = []
    for (const [key, list] of byCell) {
      const [ix, iz] = key.split(',').map(Number)
      const puffCount = list.reduce((n, c) => n + c.puffs.length, 0)
      // Shaded bases first, then the sunlit highlights, so the highlights draw on top.
      const mesh = new InstancedMesh(geometry, material, puffCount * 2)
      cells.push({ mesh, cx: (ix + 0.5) * CELL, cz: (iz + 0.5) * CELL, clouds: list, puffCount })
    }
    return { geometry, material, texture, cells }
  }, [count])

  // Placement and lighting depend on the sun, so they are redone per time of day.
  useEffect(() => {
    const look = environmentFor(timeOfDay)
    const u = resources.material.uniforms
    u.uLit.value.set(look.cloudColor)
    u.uShade.value.set(look.cloudShade)
    const d = new Object3D()
    const sx = look.sunDirection.x
    const sz = look.sunDirection.z
    const sl = Math.hypot(sx, sz) || 1
    for (const cell of resources.cells) {
      const { mesh, puffCount } = cell
      const light = new Float32Array(puffCount * 2)
      let k = 0
      for (const c of cell.clouds) {
        for (const p of c.puffs) {
          d.position.set(p.x, p.y, p.z)
          d.scale.set(p.rx * 2.5, p.rx * 1.45, 1)
          d.updateMatrix()
          mesh.setMatrixAt(k, d.matrix)
          const ox = p.x - c.x
          const oz = p.z - c.z
          const ol = Math.hypot(ox, oz) || 1
          const toward = ((ox / ol) * (sx / sl) + (oz / ol) * (sz / sl)) * 0.5 + 0.5
          const h = Math.max(0, Math.min(1, (p.y - (c.y - 30)) / 60))
          light[k] = puffLight(h, toward)
          // Highlight: smaller, higher and shifted towards the sun.
          d.position.set(p.x + (sx / sl) * p.rx * 0.45, p.y + p.rx * 0.2, p.z + (sz / sl) * p.rx * 0.45)
          d.scale.set(p.rx * 1.5, p.rx * 0.95, 1)
          d.updateMatrix()
          mesh.setMatrixAt(puffCount + k, d.matrix)
          light[puffCount + k] = Math.min(1, light[k] + 0.35)
          k++
        }
      }
      // One light value per instance, as an instanced attribute of this mesh's own geometry copy.
      mesh.geometry = resources.geometry.clone()
      mesh.geometry.setAttribute('aLight', new InstancedBufferAttribute(light, 1))
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
    }
  }, [resources, timeOfDay])

  useEffect(
    () => () => {
      resources.geometry.dispose()
      resources.material.dispose()
      resources.texture.dispose()
      for (const c of resources.cells) {
        if (c.mesh.geometry !== resources.geometry) c.mesh.geometry.dispose()
        c.mesh.dispose()
      }
    },
    [resources],
  )

  useFrame(() => {
    const p = camera.position
    const reach = cullDistance + CELL_RADIUS
    const reach2 = reach * reach
    for (const c of resources.cells) {
      const dx = c.cx - p.x
      const dz = c.cz - p.z
      c.mesh.visible = dx * dx + dz * dz < reach2
    }
  })

  return (
    <group>
      {resources.cells.map((c, i) => (
        <primitive key={i} object={c.mesh} />
      ))}
    </group>
  )
}
