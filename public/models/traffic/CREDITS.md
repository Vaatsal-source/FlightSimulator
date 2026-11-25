# Traffic aircraft models

The airliner models in this folder (`a320.glb`, `a350.glb`, `a380.glb`, `b737.glb`, `b787.glb`)
are the logo-free variants of **amvlab's open-source aircraft models**:

- Source: https://github.com/amvlab/aircraft-models (also https://amvlab.eu/projects/aircraft-models)
- Author: amvlab
- Licence: Creative Commons Attribution 4.0 International (CC BY 4.0), see `LICENSE.txt`
  and https://creativecommons.org/licenses/by/4.0/

Changes made for FlySim: none to the files themselves. At load time the game rotates each model
so its nose points along -Z, scales it to the real aircraft length, and lowers its material
metalness so it reads without an environment map.
