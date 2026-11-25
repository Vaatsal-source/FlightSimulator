/**
 * The glTF airliners used for AI traffic (amvlab, CC BY 4.0: see
 * public/models/traffic/CREDITS.md). The numbers were measured from the files:
 * every model has its nose along +X and its origin off-centre, in arbitrary units.
 */

export type TrafficModelId = 'a320' | 'a350' | 'a380' | 'b737' | 'b787'

export interface TrafficModelSpec {
  id: TrafficModelId
  /** File name under /models/traffic/. */
  file: string
  /** Real overall length the model is scaled to (m). */
  lengthM: number
  /** Measured in the file's own units. */
  modelLength: number
  /** Middle of the model on X and Z, and the height of the lowest point (the wheels), in the file's units. */
  centreX: number
  centreZ: number
  minY: number
}

export const TRAFFIC_MODELS: readonly TrafficModelSpec[] = [
  { id: 'a320', file: 'a320.glb', lengthM: 37.57, modelLength: 37.68, centreX: -3.06, centreZ: -0.04, minY: -2.821 },
  { id: 'b737', file: 'b737.glb', lengthM: 39.5, modelLength: 37.87, centreX: -0.69, centreZ: 0, minY: -2.692 },
  { id: 'b787', file: 'b787.glb', lengthM: 56.7, modelLength: 56.58, centreX: -2.5, centreZ: 0, minY: -4.388 },
  { id: 'a350', file: 'a350.glb', lengthM: 66.8, modelLength: 67.41, centreX: 0, centreZ: 0.03, minY: -4.072 },
  { id: 'a380', file: 'a380.glb', lengthM: 72.72, modelLength: 175.95, centreX: -9.55, centreZ: 0, minY: -9.15 },
]

/** Scale from the file's units to metres. */
export function modelScale(spec: TrafficModelSpec): number {
  return spec.lengthM / spec.modelLength
}

/** Which model aircraft number `index` uses: a spread of types, stable for the session. */
export function trafficModelFor(index: number): TrafficModelSpec {
  return TRAFFIC_MODELS[index % TRAFFIC_MODELS.length]
}
