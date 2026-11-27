# F-16-inspired browser-game cockpit (GLB)

A lightweight, fictionalized fighter cockpit interior generated procedurally for use as a game asset.

## Files

- `f16_inspired_cockpit.glb` — binary glTF 2.0 asset (recommended for browser loading)
- `generate_f16_style_cockpit.py` — procedural source used to generate the asset (requires Python, NumPy, and trimesh)

## Geometry and scale

- **18,936 triangles**
- **10,226 vertices**
- **392 mesh parts / nodes**
- **14 PBR material variants**
- Approximate bounding dimensions: **1.5 m wide × 2.0 m high × 2.83 m long**
- Model uses glTF's **+Y up** convention; the cockpit's forward direction is **-Z**.
- No external textures are required; materials are embedded in the GLB.

Included details: cockpit tub and sidewalls, instrument panel, three MFD-style displays with simple emissive symbology, backup analog gauges, HUD combiner, control stick, throttle quadrant, side consoles, rudder pedals, ejection seat, harness, canopy rails and bow.

## Three.js loading example

```js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
loader.load('/assets/f16_inspired_cockpit.glb', (gltf) => {
  const cockpit = gltf.scene;
  cockpit.name = 'F16InspiredCockpit';
  cockpit.scale.setScalar(1); // Asset dimensions are already in meters.
  scene.add(cockpit);
});
```

For a first-person cockpit camera, place the camera roughly near the seat at **(0, 1.0, 0.9)** in the asset's local coordinates, then adjust the position and rotation to fit your aircraft camera rig. The pilot faces toward **-Z**.

## Notes

- This is a stylized, fictionalized **F-16-inspired** cockpit, not an exact technical replica or an official Lockheed Martin asset.
- The asset is deliberately well below a 100k-triangle budget, leaving room for game-side decals, labels, animated controls, and interaction markers.
- Displays are geometric/emissive placeholders. Replace or overlay them with live render targets, HTML/canvas textures, or your own cockpit UI.
- For better runtime performance, merge static meshes by material and keep moving controls (stick, throttle, switches, canopy) as separate objects in a production version. This first export keeps parts separate for easier editing.
