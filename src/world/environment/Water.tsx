import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  Color,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
} from 'three'
import type { QualityProfile } from '../../config/quality'
import type { TimeOfDay, Weather } from '../types'
import { displayColor, environmentFor } from './constants'
import { snapWaterCenter } from './envMath'

/** Side of the water square (m). Covers the 100 km world and the horizon beyond the 60 km far plane. */
const WATER_SIZE = 140000

/** The sea's waves: direction, wavelength (m), height (m) and the distances over which each fades out. */
const WAVES = [
  { dir: [1.0, 0.35], len: 90, amp: 0.9, from: 4000, to: 12000 },
  { dir: [-0.4, 1.0], len: 37, amp: 0.36, from: 1800, to: 6000 },
  { dir: [0.8, -0.7], len: 15, amp: 0.14, from: 700, to: 2500 },
  { dir: [-0.9, -0.3], len: 6.3, amp: 0.05, from: 250, to: 900 },
  { dir: [0.2, 1.0], len: 2.6, amp: 0.02, from: 80, to: 350 },
] as const

const f = (n: number) => n.toFixed(6)
const WAVE_CODE = WAVES.map((w) => {
  const l = Math.hypot(w.dir[0], w.dir[1])
  const k = (2 * Math.PI) / w.len
  const speed = Math.sqrt(9.81 * k)
  const fade = `(1.0 - smoothstep(${f(w.from)}, ${f(w.to)}, dist))`
  return `  if (dist < ${f(w.to)}) s += wave(p, vec2(${f(w.dir[0] / l)}, ${f(w.dir[1] / l)}), ${f(k)}, ${f(speed)}, ${f(w.amp)} * ${fade});`
}).join('\n')

const VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}
`

// Waves only bend the normal; the surface itself stays flat at y = 0 for physics.
// Output is final display values (no tone mapping), matching the sky and fog.
const FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform float uLight;
varying vec3 vWorld;

// Slope (d height / d xz) of one sine wave: the direction, wavenumber k, angular speed w (both constants, worked out in JS, not per pixel)
// and the amplitude already faded for distance.
vec2 wave(vec2 p, vec2 dir, float k, float w, float amp) {
  return dir * (amp * k * cos(dot(dir, p) * k + uTime * w));
}

void main() {
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  vec2 p = vWorld.xz;

  // Fine octaves fade out with distance, so the far sea does not shimmer; beyond their range they cost nothing at all.
  vec2 s = vec2(0.0);
${WAVE_CODE}

  vec3 N = normalize(vec3(-s.x, 1.0, -s.y));
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fres = mix(0.05, 1.0, pow(1.0 - ndv, 4.0));

  vec3 R = reflect(-V, N);
  float ry = clamp(R.y, 0.0, 1.0);
  vec3 sky = mix(uHorizon, uZenith, pow(ry, 0.5));

  // Depth-free shallow tint: lighter at glancing angles and on wave faces.
  float tint = clamp(0.2 + 0.55 * pow(1.0 - ndv, 1.5) + length(s) * 1.2, 0.0, 1.0);
  vec3 body = mix(uDeep, uShallow, tint) * uLight;
  vec3 col = mix(body, sky, fres);

  float sd = max(dot(R, uSunDir), 0.0) * step(0.0, R.y);
  // Sun glitter: the sharp core is kept but capped, so it sparkles instead of burning white patches into the sea.
  float sd2 = sd * sd;
  float sd4 = sd2 * sd2;
  float sd8 = sd4 * sd4;
  float sd64 = sd8 * sd8 * sd8 * sd8 * sd8 * sd8 * sd8 * sd8;
  float glint = min(pow(sd, 700.0) * 4.0, 1.6) + sd64 * sd8 * 0.35;
  col += uSunColor * glint;

  // Slightly see-through only right next to the camera, so the seabed tints the shallows. Further out the water is solid:
  // the sea floor is coarse chunks there, and through even a thin film they showed as dark square patches.
  float alpha = clamp(mix(0.84, 1.0, smoothstep(120.0, 600.0, dist)) + 0.16 * fres, 0.0, 1.0);
  alpha = max(alpha, clamp(glint, 0.0, 1.0));

  gl_FragColor = vec4(col, alpha);
  #include <logdepthbuf_fragment>
  #include <fog_fragment>
}
`

/**
 * Ocean plane at y = 0 that follows the camera in x/z (snapped), so it always
 * reaches the horizon. 'animated' is a wave shader (normals only, Fresnel sky
 * reflection, sun glint, fog and log depth aware); 'simple' is a tinted
 * standard material. Terrain under the sea is negative, so the shore is
 * resolved by the logarithmic depth buffer.
 */
export function Water({ profile, timeOfDay, weather = 'clear' }: { profile: QualityProfile; timeOfDay: TimeOfDay; weather?: Weather }) {
  const ref = useRef<Mesh>(null)
  const camera = useThree((s) => s.camera)
  const animated = profile.waterDetail === 'animated'

  const geometry = useMemo(() => {
    const g = new PlaneGeometry(WATER_SIZE, WATER_SIZE, 1, 1)
    g.rotateX(-Math.PI / 2)
    return g
  }, [])

  const material = useMemo(() => {
    const look = environmentFor('noon')
    if (animated) {
      return new ShaderMaterial({
        uniforms: UniformsUtils.merge([
          UniformsLib.fog,
          {
            uTime: { value: 0 },
            uSunDir: { value: new Vector3() },
            uSunColor: { value: new Color() },
            uDeep: { value: new Color() },
            uShallow: { value: new Color() },
            uHorizon: { value: new Color() },
            uZenith: { value: new Color() },
            uLight: { value: look.waterLight },
          },
        ]),
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        fog: true,
        transparent: true,
      })
    }
    return new MeshStandardMaterial({ roughness: 0.3, metalness: 0.05, transparent: true, opacity: 0.86 })
  }, [animated])

  useEffect(() => {
    const look = environmentFor(timeOfDay, weather)
    if (material instanceof ShaderMaterial) {
      const u = material.uniforms
      u.uSunDir.value.copy(look.sunDirection)
      u.uSunColor.value.copy(displayColor(look.sunColor))
      u.uDeep.value.copy(displayColor(look.waterDeep))
      u.uShallow.value.copy(displayColor(look.waterShallow))
      u.uHorizon.value.copy(displayColor(look.horizonColor))
      u.uZenith.value.copy(displayColor(look.zenithColor))
      u.uLight.value = look.waterLight
    } else {
      material.color.set(look.waterDeep).lerp(new Color(look.waterShallow), 0.35).multiplyScalar(look.waterLight)
    }
  }, [material, timeOfDay, weather])

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  useFrame((state) => {
    const m = ref.current
    if (!m) return
    m.position.x = snapWaterCenter(camera.position.x)
    m.position.z = snapWaterCenter(camera.position.z)
    if (material instanceof ShaderMaterial) material.uniforms.uTime.value = state.clock.elapsedTime
  })

  return <mesh ref={ref} geometry={geometry} material={material} position={[0, 0, 0]} renderOrder={1} frustumCulled={false} />
}
