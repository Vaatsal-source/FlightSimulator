/**
 * Terrain ground material: a MeshStandardMaterial patched in onBeforeCompile,
 * so scene lights, shadows and fog keep working. The fragment colour blends
 * seabed, sand, grass, dry grass, forest floor, alpine meadow, rock on steep
 * slopes and snow on high, flatter ground, with procedural detail noise that
 * fades in near the camera.
 */

import { Color, MeshLambertMaterial, Vector2 } from 'three'
import { AIRPORTS } from '../../config/airports'

const PALETTE = {
  uSeabedDeep: 0x2d5a5c,
  uSeabed: 0x8a9a7a,
  uSand: 0xd8c896,
  uGrass: 0x5d8f3a,
  uGrassLush: 0x4a8233,
  uDryGrass: 0x9b9b52,
  uForest: 0x3b5a2a,
  uAlpine: 0x7f8452,
  uRock: 0x7c766e,
  uRockDark: 0x57524c,
  uSnow: 0xf2f5fa,
} as const

const VERTEX_PARS = /* glsl */ `
attribute vec2 biome;
varying vec2 vBiome;
varying vec3 vTerrainPos;
varying vec3 vTerrainNormal;
varying float vAirDist;
uniform vec2 uAirports[AIRPORT_COUNT];
`

const VERTEX_MAIN = /* glsl */ `
vBiome = biome;
// Chunks are only translated, so the object normal is the world normal.
vTerrainNormal = normal;
vTerrainPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
// Distance to the nearest airfield, per vertex (the fields fade over thousands of metres, so interpolating is exact enough).
float airDist = 1.0e9;
for (int i = 0; i < AIRPORT_COUNT; i++) airDist = min(airDist, distance(vTerrainPos.xz, uAirports[i]));
vAirDist = airDist;
`

const FRAGMENT_PARS = /* glsl */ `
varying vec2 vBiome;
varying vec3 vTerrainPos;
varying vec3 vTerrainNormal;
varying float vAirDist;
uniform float uTime;
uniform float uCloudShade;
uniform vec3 uSeabedDeep;
uniform vec3 uSeabed;
uniform vec3 uSand;
uniform vec3 uGrass;
uniform vec3 uGrassLush;
uniform vec3 uDryGrass;
uniform vec3 uForest;
uniform vec3 uAlpine;
uniform vec3 uRock;
uniform vec3 uRockDark;
uniform vec3 uSnow;
uniform vec2 uAirports[AIRPORT_COUNT];

float tHash(vec2 p) {
  p = mod(p, 4096.0);
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float tNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = tHash(i);
  float b = tHash(i + vec2(1.0, 0.0));
  float c = tHash(i + vec2(0.0, 1.0));
  float d = tHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
`

const FRAGMENT_COLOR = /* glsl */ `
{
  vec2 wp = vTerrainPos.xz;
  float h = vTerrainPos.y;
  vec3 tn = normalize(vTerrainNormal);
  float slope = 1.0 - tn.y;
  float dist = length(vTerrainPos - cameraPosition);
  float forest = vBiome.x;
  float dry = vBiome.y;

  float macro = tNoise(wp * 0.0021);
  float mid = tNoise(wp * 0.017);
  float nearFade = 1.0 - smoothstep(250.0, 1400.0, dist);
  float fineFade = 1.0 - smoothstep(25.0, 220.0, dist);
#ifdef TERRAIN_LITE
  float d1 = 0.5;
  float d2 = 0.5;
#else
  float d1 = nearFade > 0.0 ? tNoise(wp * 0.21) : 0.5;
  float d2 = fineFade > 0.0 ? tNoise(wp * 1.3) : 0.5;
#endif

  // Grassland: lush / dry patches, forest floor under the woods, alpine meadow up high.
  vec3 col = mix(uGrass, uGrassLush, smoothstep(0.3, 0.8, mid));
  col = mix(col, uDryGrass, clamp(dry * (0.35 + 0.9 * macro) - 0.1, 0.0, 0.85));
  float alpine = smoothstep(650.0, 1050.0, h + 180.0 * (macro - 0.5));
  col = mix(col, uForest, forest * 0.85 * (1.0 - alpine) * (1.0 - smoothstep(0.14, 0.26, slope)));
  col = mix(col, uAlpine, alpine);

  // Fields: a rotated grid of patches, each with its own crop colour and ploughed rows, hedgerows between
  // them. Flat lowland only, fading out with distance and kept clear of the airfields.
  {
    float flatLand = 1.0 - smoothstep(0.04, 0.12, slope);
    float lowland = 1.0 - smoothstep(320.0, 620.0, h);
    float airDist = vAirDist;
    float fieldW = flatLand * lowland * (1.0 - forest) * step(3.8, h)
      * (1.0 - smoothstep(7000.0, 16000.0, dist)) * smoothstep(1500.0, 3200.0, airDist);
    if (fieldW > 0.01) {
      vec2 q = mat2(0.8660, -0.5, 0.5, 0.8660) * wp;
      vec2 cellSize = vec2(230.0, 160.0);
      vec2 g = q / cellSize;
      vec2 id = floor(g);
      vec2 f = fract(g);
      float h1 = tHash(id + 3.7);
      float h2 = tHash(id + 41.3);
      vec3 crop = h1 < 0.22 ? vec3(0.30, 0.52, 0.18)
                : h1 < 0.42 ? vec3(0.70, 0.60, 0.27)
                : h1 < 0.58 ? vec3(0.46, 0.35, 0.22)
                : h1 < 0.80 ? vec3(0.52, 0.66, 0.30)
                : vec3(0.22, 0.40, 0.17);
      crop *= 0.88 + 0.24 * h2;
      // Ploughed rows, only close up.
#ifdef TERRAIN_LITE
      float rowFade = 0.0;
#else
      float rowFade = 1.0 - smoothstep(300.0, 1800.0, dist);
#endif
      float rows = sin((h2 > 0.5 ? q.x : q.y) * 1.1) * 0.5 + 0.5;
      crop *= 1.0 - 0.10 * rows * rowFade * step(0.3, h1) * (1.0 - step(0.58, h1) * step(h1, 0.62));
      // Hedgerows along the edges.
      vec2 edgeDist = min(f, 1.0 - f) * cellSize;
      float e = min(edgeDist.x, edgeDist.y);
      float aa = length(fwidth(q)) * 1.2;
      float hedge = 1.0 - smoothstep(0.9 + aa * 0.5, 2.6 + aa, e);
      hedge *= 1.0 - smoothstep(2500.0, 9000.0, dist);
      crop = mix(crop, vec3(0.14, 0.26, 0.11), hedge * 0.75);
      col = mix(col, crop * (0.92 + 0.16 * macro), fieldW * 0.9);
    }
  }

  // Rock on steep slopes and above the meadows.
  float rockiness = smoothstep(0.14, 0.3, slope + 0.1 * (mid - 0.5));
  rockiness = max(rockiness, smoothstep(1150.0, 1450.0, h + 200.0 * (macro - 0.5)) * 0.85);
  vec3 rock = mix(uRockDark, uRock, smoothstep(0.2, 0.8, mid * 0.6 + d1 * 0.4));
  col = mix(col, rock, rockiness);

  // Snow on high, flat-ish ground.
  float snow = smoothstep(1280.0, 1460.0, h + 160.0 * (macro - 0.5)) * (1.0 - smoothstep(0.3, 0.5, slope));
  col = mix(col, uSnow, snow);

  // Beaches and shallow sea floor.
  float beach = 1.0 - smoothstep(1.6, 3.8 + 2.0 * mid, h);
  col = mix(col, uSand, beach * (1.0 - smoothstep(0.35, 0.6, slope)));
  if (h < 0.0) {
    col = mix(uSand, uSeabed, smoothstep(0.0, -6.0, h));
    col = mix(col, uSeabedDeep, smoothstep(-6.0, -60.0, h));
  }

  // Close-up detail: blotches at a few metres, grain below a metre.
  col *= mix(1.0, 0.8 + 0.4 * d1, nearFade * 0.9);
  col *= mix(1.0, 0.88 + 0.24 * d2, fineFade);
  col *= 0.92 + 0.16 * macro;
  // Grass grain at every range: a speckle whose cells stay about 2-3 pixels wide, stepping up by octaves with
  // distance (like mipmaps for noise) and crossfading between steps, so it neither swims nor turns to blur.
#ifndef TERRAIN_LITE
  // Cloud shadows: soft dark patches drifting with the wind, fading out with distance.
  {
    if (dist < 22000.0) {
      vec2 sp = wp * 0.00042 + vec2(uTime * 0.0011, uTime * 0.0004);
      float sn = 0.62 * tNoise(sp) + 0.38 * tNoise(sp * 2.7 + 11.0);
      float shadow = smoothstep(0.52, 0.74, sn) * (1.0 - smoothstep(9000.0, 22000.0, dist));
      col *= 1.0 - uCloudShade * shadow;
    }
  }
  {
    float px = max(dist * 0.0018 * 2.5, 0.2);
    float lv = log2(px / 0.2);
    float s0 = 0.2 * exp2(floor(lv));
    float mixT = smoothstep(0.0, 1.0, fract(lv));
    float n0 = tHash(floor(wp / s0));
    float n1 = tHash(floor(wp / (s0 * 2.0)) + 91.0);
    float speck = mix(n0, n1, mixT) - 0.5;
    float amp = 0.34 * (1.0 - smoothstep(500.0, 3500.0, dist)) * (1.0 - 0.75 * rockiness) * (1.0 - snow * 0.6);
    col *= 1.0 + amp * speck;
  }
#endif
  diffuseColor.rgb *= col;
}
`

const FRAGMENT_NORMAL = /* glsl */ `
#if !defined(TERRAIN_LITE) && !defined(TERRAIN_MID)
// Fine relief: a tilt of the normal from the detail noise, so the ground catches low sun instead of reading flat.
{
  float bf = 1.0 - smoothstep(40.0, 900.0, length(vTerrainPos - cameraPosition));
  if (bf > 0.0) {
    vec2 bp = vTerrainPos.xz * 0.32;
    float e = 0.45;
    float n0 = tNoise(bp);
    vec3 tilt = vec3(tNoise(bp + vec2(e, 0.0)) - n0, 0.0, tNoise(bp + vec2(0.0, e)) - n0) * (-1.1 * bf);
    normal = normalize(normal + (viewMatrix * vec4(tilt, 0.0)).xyz);
  }
  float bg = 1.0 - smoothstep(6.0, 70.0, length(vTerrainPos - cameraPosition));
  if (bg > 0.0) {
    vec2 bp2 = vTerrainPos.xz * 2.4;
    float m0 = tNoise(bp2);
    vec3 tilt2 = vec3(tNoise(bp2 + vec2(0.35, 0.0)) - m0, 0.0, tNoise(bp2 + vec2(0.0, 0.35)) - m0) * (-1.6 * bg);
    normal = normalize(normal + (viewMatrix * vec4(tilt2, 0.0)).xyz);
  }
}
#endif
`

/** Shared terrain material; dispose it when the terrain unmounts. */
export function createTerrainMaterial(detail: 'lite' | 'mid' | 'full' = 'full'): MeshLambertMaterial {
  const lite = detail === 'lite'
  const defines = lite ? '#define TERRAIN_LITE\n' : detail === 'mid' ? '#define TERRAIN_MID\n' : ''
  // Lambert, not PBR: the ground is matte, and this skips the specular terms for every pixel of the screen it covers.
  const material = new MeshLambertMaterial({ color: 0xffffff })
  const uniforms: Record<string, { value: Color }> = {}
  for (const [name, hex] of Object.entries(PALETTE)) uniforms[name] = { value: new Color(hex) }
  // Animated from outside: the clock and how strong the cloud shadows are (weather and time of day).
  const live = { uTime: { value: 0 }, uCloudShade: { value: 0.16 } }
  material.userData.live = live
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, live)
    shader.uniforms.uAirports = { value: AIRPORTS.map((a) => new Vector2(a.center.x, a.center.z)) }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
#define AIRPORT_COUNT ${AIRPORTS.length}
${VERTEX_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_MAIN}`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n#define AIRPORT_COUNT ${AIRPORTS.length}\n${defines}${FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAGMENT_COLOR}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAGMENT_NORMAL}`)
  }
  material.customProgramCacheKey = () => `flysim-terrain-v7-${detail}`
  return material
}
