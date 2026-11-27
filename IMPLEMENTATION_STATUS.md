# Implementation Status

_Last updated: Phase 4 complete (verification + audit fixes)._ Spec: [SPEC.md](SPEC.md) (reconstructed - original not found).

## Stack (pinned)
Vite 8.3.5, React 19.3.1, TypeScript 6.0.3 (TS 7 is incompatible with typescript-eslint 8.72),
three 0.186.1, @react-three/fiber 9.8.2 (no drei), zustand 5.0.15, Vitest 5.0.5, jsdom 30, ESLint 10.

## File ownership
| Area | Owner | Paths |
| --- | --- | --- |
| Shared contracts | Orchestrator | `src/simulation/types.ts`, `src/config/{aircraftGeometry,world,quality}.ts`, `src/world/types.ts`, `src/game/{types,modes,courses}.ts`, `src/state/*` |
| Integration | Orchestrator | `src/App.tsx`, `src/main.tsx`, `src/session/**`, `src/input/**`, `src/game/challenges.ts`, `src/world/terrain/terrainGrid.ts` |
| Physics | Agent A (Opus, high) | `src/simulation/**` (except types.ts), `src/config/aircraft.ts` |
| World | Agent B (Sonnet, medium) | `src/world/**` (except types.ts) |
| UI | Agent C (Sonnet, medium) | `src/components/**` |
| QA | Agent D (Sonnet, medium) | `src/state/__tests__/**`, `src/__tests__/**`, `QA_CHECKLIST.md` |

## Key decisions
- World/body frames follow three.js (Y up, nose = -Z); the renderer copies the pose with no conversion.
- Fixed 1/120 s physics step driven from an R3F `useFrame` at priority -1; render pose is interpolated.
- Telemetry is a separate ~30 Hz external store (`useTelemetry`); zustand holds only low-frequency state.
- The canvas stays mounted between restart and results; restart resets the session in place (`flightId`).
- The simulation is frozen while paused, while an overlay is open, or on the results screen.
- **What you see is what you hit:** physics, trees and cameras sample the same triangulated grid as the
  drawn terrain mesh at the current quality (`terrainGrid.ts`); quality changes swap the physics sampler.
- Persisted settings and scores are validated on load.

## Verification (latest run)
- `npm run typecheck`, `npm run lint`: clean. `npm test`: 14 files, 170 tests passing. `npm run build`: OK (1.23 MB JS, 342 kB gzip).
- Session integration tests fly a scripted take-off, landing and the full ring course (263 s of the
  360 s limit) to challenge success on the real terrain, plus crash reporting, pause freeze and reset.
- Ring radius widened 20 m -> 30 m: with 20 m the scripted pilot missed rings and ran out of time.
- Browser (dev server): menus, mode select, flight, pause, settings/quality switch, controls, results,
  restart and chase/cockpit/free cameras checked. The only console warning is `THREE.Clock` deprecated (inside R3F).

## Audit fixes (Opus cross-system audit)
1. Tail-strike point moved to the drawn tail (it struck ~0.4 m below the visible tail).
2. Terrain away from the airport differed by up to 33 m between physics and mesh; now identical (test < 1 mm).
3. A crashed engine kept 2700 rpm; it now stops. The propeller holds still while paused.
4. A held Space (brakes) could auto-repeat into the focused Retry button; now suppressed.
5. Objective text aligned with scoring (bank/sink limits are score bonuses, not failures).

## Phase 1: world and terrain (branch `feature/phase1-world`)
- 100 km world: a 38 km main island with islets, lakes and rivers, and peaks to ~1,800 m. The airport, corridors and ring course are kept.
- Streaming quadtree terrain: levels 0-7, 32x32-cell chunks, built in Web Workers. Level 0 is the 30 m physics grid
  and always covers at least 1.5 km around the camera, so the ground near the aircraft is exactly the ground physics hits.
- Height/slope terrain material, three tree types streamed by chunk, time-of-day sky/lighting/fog (morning, noon, evening),
  animated water shader, clouds over the whole world.
- Quality now sets view distance, LOD bias, tree density, cloud count, shadows and fog; it never changes physics.
- Gate: 205 tests passing; build bundles the terrain worker.

## Phase 2: multiple airports (same branch)
- 10 airports: Central Field, Harbor and North Bay Internationals, Ridgeback Air Base, Westport, Southgate,
  Eastshore, Pine Ridge, Gull Island and Cedar Valley. The data lives in `src/config/airports.ts` and the
  geometry in `src/game/airportGeometry.ts`.
- Terrain flattens every airport exactly and keeps a sloped clear surface 10 km out from both runway ends.
  Sites were moved up to 2.5 km onto suitable ground.
- Every airport is drawn: markings, runway numbers, edge, threshold and taxi lights, PAPI, buildings by class.
- Airport and runway picker for Free Flight, Take-off and Landing; world map (M); HUD minimap,
  nearest-airport readout and ILS-style approach guidance.
- Gate: 292 tests passing.

## Phase 3: selectable aircraft (same branch)
- Five aircraft: FS-1 Trainer, F-22 Raptor, A220-300, A350-900, Global 8000. The catalog is
  `src/config/aircraftCatalog.ts` (published specs and sources); physics configs are in `src/config/aircraft/`.
- One physics model with:
  - piston, turbofan and afterburning engines; ISA atmosphere to 20 km; Mach drag rise;
  - retractable gear (refused on the ground), speed brakes, auto ground spoilers, reverse thrust;
  - fly-by-wire (airliners: bank and AoA protection; F-22: 9 g limit, thrust vectoring).
- Calibrated against published data; all targets are met. The A350 flies at MTOW (283 t), so its take-off reproduces
  the published 2,600 m field length: lift-off ~1,950 m, 35 ft at ~2,220 m, x1.15 = ~2,560 m.
  Its speeds were raised for the weight (Vr 155 kt, approach 148 kt), and jets spawn on the 3° glide path.
  Rotate gently: the heavy A350 tail-strikes at ~11° on the ground.
- Procedural models for all four jets with gear, surface, nozzle and afterburner animation; per-aircraft cameras.
- Hangar picker, inline map preview with runway-length warnings, HUD gear/N1/Mach/AB/SPD BRK/REV, per-aircraft
  instrument scales, jet engine sounds. Keys: G gear, V speed brake, Y reverse.
- Gate: 476 tests passing.

## Flight School (before Phase 4, at the user's request)
- Guided take-off and landing lessons for every aircraft (`src/game/lessons.ts`, technique per aircraft in
  `src/game/technique.ts`), with a coach panel: steps, instruction, keys, live target gauge and warnings.
  A crash ends the lesson with a specific coaching tip.
- Assists: tail-strike guard (height-aware, settable), plus approach autothrust and a flare assist in the landing lesson.
- Physics: FBW flare mode, derotation law, gear-down g limits, nose-wheel hard-landing fix.
- Voice callouts (Rotate, Positive rate, 500/100/50/40/30/20/10, Retard) and a step chime.
- Every take-off and landing lesson is completed end-to-end by a coach-following scripted student (512 tests).
- Phase 4 (off-runway crash rule) is on hold.

## Visual upgrade, Phase 0 and 1 (cockpit)
- **F3 stats overlay** (`src/session/PerfOverlay.tsx`): fps, 1% low, worst frame, draw calls, triangles, geometries, textures, heap.
  First software-rendered reading (headless, so only a floor): ~98-120 draws, ~470k triangles.
- **3D flight deck** (`src/world/cockpit/`), cockpit view only. Three styles from `cockpitSpec.ts`:
  light (trainer: six round gauges), airliner (A220, A350, Global 8000: PFD, EICAS, MCP strip, overhead, pedestal) and fighter (F-22: HUD, three MFDs, canopy arches).
  Screens are 2D-canvas textures redrawn when a new telemetry snapshot arrives (~30 Hz); yoke, stick and throttle levers follow the controls.
- **Head** (`headMotion.ts`, `CameraRig.tsx`): sags under g, bumps on touchdown, drag with the mouse to look around (140° yaw), springs back on release. Cockpit FOV 78 → 72.
- The flat SVG instrument overlay is hidden in the cockpit view (the 3D deck replaces it).
- Fixed: the A220's eye point sat 2 cm above the fuselage crown, so its skin showed as a grey polygon across the view. Eye y 1.2 → 1.0 (test: airliner eye points are inside the envelope).
- Cockpit builder must create its meshes inside an effect: StrictMode's mount/unmount/remount disposes a `useMemo`'d deck.
- Known gaps: the cockpits are generic (not per-type panels), no night panel lighting, no ND / map display, instruments read `settings.units`.

### Performance pass and cockpit v2
- **Measured first** (dev-only `window.__flysim` hook + a triangle census of the visible scene): trees and clouds were ~75% of the triangles; terrain was the cheap part.
  Trees were one un-culled instanced mesh per type (every tree within 4-6 km at 70-140 triangles, including those behind the camera, plus again in the shadow pass); clouds were 252-triangle spheres.
- **Fixed:** far trees use 8-10 triangle shapes (near ring 700 m keeps the detailed model and the shadows), far trees outside the view cone are not written at all (rewritten when the view turns 8.6 degrees), clouds are 120-triangle spheres.
  Result (1280x720, same scene): medium 468k -> 159k triangles (-66%), high 729k -> 224k (-69%). Rules and tests in `src/world/terrain/treeLod.ts`.
- **WebGPU was not used:** the terrain, water, sky and airport materials are custom GLSL, which WebGPURenderer cannot run without a rewrite to TSL, and the cost was triangle count, not the API.
- Not done, may be worth testing on real hardware: `logarithmicDepthBuffer` (disables early-z) vs a reversed depth buffer, MSAA at dpr 2.
- **Cockpit v2:** switch-bank and avionics textures (sized to their planes), screen bezels, slim glare-shield, round pillars, windscreen header, HUD glass tint, smaller levers.

## Phase 2 (started): AI traffic
- `src/world/traffic/`: `trafficPlan.ts` (pure, deterministic flight legs between airports: line up, roll, climb with terrain clearance, 3 degree approach, touchdown, stop; arcs sized for ~32 degrees of bank; runway ends chosen to face the direction of travel),
  `trafficModels.ts` (measured scale/centre/ground offset of each glTF), `TrafficFleet.tsx` (loads the models, moves them; hidden beyond fog distance and while paused).
  Count by quality: low 2, medium 5, high 8. They are scenery only: no physics, no collision with the player.
- Models: A320, B737, B787, A350, A380 from amvlab (CC BY 4.0), in `public/models/traffic/` with `LICENSE.txt` and `CREDITS.md`. Gear is baked into each mesh, so it stays down in flight.
- Dev only: `window.__flysimTraffic` lets a script pin aircraft in front of the camera to inspect them.

### Graphics pass 2 and cockpit v3
- **Cockpit rebuilt as a closed room** (floor, ceiling, back/side/front walls, openings only at the windows) after the v2 deck showed the world through gaps under the dash. Static parts are merged per material (draw calls per deck under 40); soft interior light from a `RoomEnvironment` prefiltered map (`CockpitModel.tsx`); quiet switch-bank textures instead of the noisy grid.
- **Clouds** are camera-facing sprites with a lit highlight offset towards the sun and a shaded base (2 triangles each, was 120); correct under the log depth buffer and fog (`Clouds.tsx`).
- **Terrain** (`terrainMaterial.ts`): a field patchwork with hedgerows on flat lowland (kept clear of airfields), micro-relief from the noise, and a distance-scaled grass speckle (cells stay ~2-3 px wide, stepping by octave like mipmaps). Measured fine detail on the near grass 0.65 -> 2.3 (mean neighbour-pixel difference, 0-255). Far trees are lighter so they stop reading as black specks.
- `window.__flysim` / `__flysimTraffic` are dev-only hooks used by the profiling and screenshot scripts.

## A320-200 (first new playable aircraft)
- `src/config/aircraft/a320.ts`, catalog entry, procedural model (`transport.ts`, sharklets, CFM56 nacelles, red-tail generic livery), airliner cockpit, lessons, autopilot tuning, hangar card.
- Game weight 62,400 kg (80 % of MTOW). Measured against the published figures: take-off field at MTOW 78 t = 2,160 m (published ~2,090 m, +3 %), clean stall 69 m/s EAS, cruise Mach 0.779 at 11 km, approach 68 m/s. Flaps use the shared 4-detent lever (UP / 1 / 2 / FULL, 35 degrees at full).
- Added to every parametrised aircraft test (types, landing, field landing, atmosphere, models) plus an A320 block in `airliners.test.ts`.

## Ground operations, part 1: gate departure
- **Engine start / shutdown** in the flight model (`startEngines`, `stopEngines`, `engineStartProgress`): about 30 s on a jet (N1 rises through the start, no thrust until it lights), 3 s on the piston; a shutdown only on the ground below 3 m/s. Keys: `N` engines, `K` parking brake.
- **Gate Departure mode** (`game/groundOps.ts`): spawn parked cold and dark on the apron stand, taxi route planner (stand -> taxiway -> connector -> hold-short -> line-up; verified on all 20 primary runway ends), phase machine with ATC calls and an auto-checked 6-item checklist, speed and runway-incursion warnings. A gate departure always uses the primary runway (asking for a secondary-runway end uses the primary end that points the same way).
- **UI/world:** `GroundOpsPanel` (ATC, checklist, taxi distance and arrow, start progress), green centreline lights and a red stop bar (`TaxiRoute.tsx`).
- **Not built yet:** pushback, refuelling and boarding, weight and balance from fuel and passengers, taxiing around other traffic, ATC voice, checklists for the other phases (shutdown, arrival), night/weather modes, taxi to a gate after landing.

## Ground operations, part 2 (menu, weight and balance, turnaround, arrival, night and weather)
- **Menu:** Take-off and Landing challenges are no longer offered (the modes remain for the Flight School lesson code), and Flight School and Multiplayer are gone from the main menu (their screens and the server are untouched). Main menu: Gate Departure, Quick Flight, Fly; icons, aircraft fact chips, weather chips, layered horizon.
- **Weight and balance** (`game/loading.ts`, `AircraftPhysics.setLoad`): OEW + fuel + passengers give mass and CG (% MAC) for the A220, A320, A350 and Global 8000. The flight model scales mass and inertia, re-seats the gear, and shifts `cm0`/`cmAlpha` for the CG. Fuel burns from thrust (about 14 mg per newton-second) and the engines stop when the tanks are empty. Loadsheet shows gross weight, CG limits and weight-scaled rotate/approach speeds. The A350 uses its real ~142 t operating empty weight (the hangar card shows 115.7 t).
- **Turnaround at the gate** (`game/gateServices.ts`): jet bridge (14 s), doors, refuelling and boarding/deplaning (about 90 s for a full load) with interlocks: the bridge only moves when parked (brake set, engines off), doors only open at a docked bridge, boarding only through open doors, the bridge cannot retract with the doors open, and the brake cannot be released, nor the engines started, until the turnaround is finished. The bridge in the world is real geometry that extends, swings and docks at the aircraft's door (`world/airport/JetBridge.tsx`, `bridgeGeometry.ts`).
- **Gate Arrival mode** (`game/arrivalOps.ts`): land on the 3 degree final, vacate at a connector, taxi in along the lights, park square on the stand with the brake set and the engines off, then run the turnaround to deplane. The route is verified on every primary runway end.
- **Night and weather:** `night` time of day (stars, moon) and weather presets `clear` / `overcast` / `fog` (light, haze, cloud cover; visual only, there is no wind in the flight model yet).
- **Airports:** a third parallel runway at Harbor and North Bay, larger aprons, a longer international terminal with eleven gates, each a pod plus a retracted bridge on a 60 m pitch; the gate at your stand is the working one. The terminals are still plain boxes.
- **Not built:** new maps; pushback; parked aircraft, vehicles and detailed terminal architecture like the reference photo; working bridges at gates other than yours; taxiing around other traffic; wind.

### Research for the next phases
- **Aircraft models:** [amvlab/aircraft-models](https://github.com/amvlab/aircraft-models), CC BY 4.0 (credit required): A320, A350, A380, B737, B787, each 2.7-5.2k triangles, one mesh, one material, one texture, ~200-250 kB, with logo-free variants.
  No separate gear or control surfaces, so animated parts would need splitting or our procedural rigs. Good for AI traffic and new airliners. Nothing found yet for F-22, a light trainer, A220 or Global 8000.
- **Terrain:** Copernicus GLO-30 (free licence, attribution) or Mapzen/AWS Terrarium tiles (no key; confirm attribution before shipping). Tested: one z8 Terrarium tile decodes with
  `h = r*256 + g + b/256 - 32768` (Swiss Alps tile: 45-3550 m) and packs to ~90 kB with brotli. Plan: pre-process offline into chunks for the existing streaming terrain, never call a live service in-game.

## Airport revamp, wind, pushback, ground traffic, scenery (part 3)
- **Airport look** (`world/airport/airportDetail.ts`, `AirportProps.tsx`, `vehicleGeometry.ts`): glass curtain-wall terminals with piers, control tower, hangars, fuel farm, car parks with parked cars, stand lines, apron markings; ground vehicles (tractors, baggage carts, fuel trucks, buses, stairs, catering) instanced; real airliner models parked at the gates (shared glTF cache with the AI traffic). Larger aprons and extra parallel runways at the big fields. Verified on screen at Harbor and Central.
- **Wind** (`game/wind.ts`, `AircraftPhysics.setWind`): settings `calm/light/moderate/strong` (0, 9, 18, 30 kt mean) with gusts and a slowly veering direction that sits 20-60 degrees off each airport's runway, so there is always some crosswind. The flight model uses air-relative velocity for aerodynamics and air data, ground-relative velocity for the gear. HUD WIND row, Settings > Wind, animated windsocks at every airfield (`Windsocks.tsx`), turbine rotors face the wind.
- **Pushback** (`game/pushback.ts`, `AircraftPhysics.setTug`): from the stand with the turnaround finished and the engines off, press `T`; the tug drags the aircraft tail-first about 55 m while swinging the nose towards the taxiway, then stops with the parking brake set. `T` again calls it off. The engines cannot be started while pushing.
- **Ground traffic** (`game/groundTraffic.ts`, `world/traffic/GroundTraffic.tsx`): two airliners taxi in from behind the stand, wait at the hold-short line, line up and take off on a repeating cycle (closed form in simulation time). The player gets a "traffic ahead" warning inside 90 m and a "too close" warning inside 30 m, and the tower holds the take-off clearance while an aircraft is on the runway. Departures only (not arrival mode).
- **Scenery** (`world/scenery/`): about 40 villages (houses, church or silo), roads draped over the ground between them, wind farms on high ground and red-lit radio masts, all kept off the airports, approach corridors and water.
- **Cockpit polish:** seats with bolsters, armrests and harnesses, rudder pedals, warning lights, sun visors, pedestal levers and trim wheels, overhead module frames, ceiling fittings, window seals, yoke and stick grips (all three styles).
- **Not done / honest limits:** no ATC wind calls on arrival, no taxi conflict physics (traffic is a warning, not a collision), ground traffic does not appear in arrival mode, the new maps (real-terrain pipeline) are still only prototyped, only the player's gate has a working jet bridge, wind gusts are not applied to AI traffic. Terrain footprint tests for the enlarged airports were re-run in the background.

## Performance pass 3 (F3 metrics)
- **Adaptive resolution** (`session/resolutionGovernor.ts`, `AdaptiveResolution.tsx`): the canvas pixel ratio follows the frame time (down fast when over about 27 ms, back up slowly, remembers the level that failed). F3 shows `res`.
- **No-GPU detection** (`gpuInfo.ts`): SwiftShader, llvmpipe and similar renderers start at a low resolution and switch the quality to Low once (`flysim-auto-low` in localStorage). Low also drops MSAA and uses the lite ground shader (`terrainDetail: 'lite'`).
- **UI re-render cost:** the HUD and panels re-render from a copy of the telemetry at 10 Hz instead of 30 Hz (`useTelemetry`); the cockpit screens redraw at about 16 Hz. In a 12 s profile at small size, garbage collection fell from 12% to under 1% and React element creation from 19% to 3%.
- **Terrain shader:** the nearest-airfield distance moved from every pixel (10 distance calculations) to every vertex.
- **Measured with:** headless Chrome on the CPU rasteriser (SwiftShader), CDP CPU and heap profiles. That machine is not a GPU, so absolute frame rates there say little; counts (draws, triangles, GC share) do carry over.

## Graphics pass 3 (sky, cloud shadows, glow, fighter deck)
- **Fighter cockpit:** HUD on posts over a sloped hood, a keypad and data display (DED), three MFDs with bezel buttons (attitude, engines, compass), a standby cluster, tapered tub, canopy bows and rails. Still built from boxes: no free fighter-cockpit model with a usable licence was found.
- **Sky:** bluer zenith, a bright haze band at the horizon, high cirrus streaks (off on the Low quality setting), dithering against banding; cumulus puffs are flat-bottomed.
- **Terrain:** drifting cloud shadows (`uCloudShade`, off in fog and at night, soft under overcast; not in the Low shader); village houses stand on garden and yard plots.
- **Glow:** soft additive halos around runway, taxiway and floodlight lights (`light-glow`).
- **Not done:** shadows inside the cockpit (the sun's shadow map covers 340 m, too coarse for the deck), a different tone mapper (the fog and sky colours are matched to the current one), real land-cover data.

## Performance pass 4 and the photographic F-22
- **Measured:** the CPU was idle about 87% of the time in a fast F-22 flight, so the limit is GPU work, mostly triangles. Triangles in a Harbor cockpit view fell from about 188k to 92k and draw calls from 146 to 82.
- **Changes:** far airfields no longer draw their lights and halos (16 km range; each cost a draw call and thousands of triangles); terrain level-of-detail distances tightened (low 0.6, medium 0.8, high 1.15); a real `mid` ground shader for Medium (no relief) and a `lite` one for Low (the earlier `lite` define was never actually applied; fixed); the game lowers the quality tier by itself after 6 s at the lowest resolution and still slow (not more than once every 20 s).
- **F-22:** the body, canopy and cockpit interior come from a CC BY-NC-SA 4.0 Sketchfab model (`public/models/f22/f22.glb`, 4.6 MB after shrinking 23 MB of textures); the rig keeps its animated gear, afterburner flames and lights. The model's own control surfaces do not move. Original downloads live in `assets-src/` (git-ignored, not deployed).
- **Hornet cockpit scan:** tried (decimated to 80k triangles, 3.6 MB), then removed at the user's request; the procedural fighter deck is back. The original download is in `assets-src/hornet-cockpit` (git-ignored).
- **Player airliners:** A220, A320, A350 and the business jet (a Learjet 60 model standing in for the Global 8000) now use Sketchfab airframes (`scripts/prepare-aircraft.mjs`, `world/aircraft/photoBody.ts`): about 82k, 45k, 12.5k and 25k triangles. The A320 and A220 files carry their own landing gear, split out by `scripts/prepare-aircraft.mjs` into `gear_nose` / `gear_ml` / `gear_mr` meshes that the game folds up and in as the gear retracts (they shrink towards the leg's hinge while turning); the A350 and the jet keep the rig's animated gear. The A220 has a livery (blue tail, wingtips and cheat line as vertex colours on a white body) and smoothed normals; because it is over 50k triangles it casts its shadow through the rig's simple hull instead of its own mesh. The cloud shadows on the ground were switched off (the old ground look).

## Tooling note
- On this machine `vitest run` fails in the default pool ("Cannot read properties of undefined (reading 'config')"); use `--pool=vmThreads`.
  Under that pool the heavy terrain tests need `--testTimeout=240000`, and the sampler's 400 ms wall-clock budget can fail on a slow machine.

## Known limitations
- No prop torque/P-factor or asymmetric stall wing-drop; gear force is vertical.
- No audio, gamepad or touch controls; keyboard + mouse (free-look) only.
- No 3D cockpit panel (cockpit view uses the 2D instrument overlay).
- Real-time FPS could not be measured: the in-app browser pane was backgrounded (rAF throttled to ~1 Hz).
- The bundle is a single 1.2 MB chunk (three.js); the warning limit is raised in vite.config.ts.

## Next
- Optional: audio (engine, stall horn), gamepad support, code-splitting three.js, wind.

### Aircraft detail and auto quality (follow-up)
- The A320 and A220 have a standard file (about 60k and 83k triangles, used on Low) and a high-detail file (`a320-hi.glb`, `a220-hi.glb`, about 130k triangles, used on Medium and High; chosen when the aircraft is built). Both come from `scripts/prepare-aircraft.mjs`.
- Bug fixed: the gear meshes share a vertex buffer with the body, and centring their hinges edited that buffer, which shifted and shrank the A220. Hinges are now computed from each gear mesh's own triangles and the gear turns on a pivot.
- The automatic quality step-down is now a setting (Settings > Auto quality, off by default). F3 shows the current quality tier next to the resolution.

### Menu redesign and wingtip lights
- The main menu follows the user's reference: a full-bleed photograph (`public/BackdropImageMenu.jpg`, a screenshot of another product supplied by the user; do not publish it in a public repo or deploy without checking its rights), a logo and tagline, angled buttons down the left (the first in red), and a compact flight-setup panel (aircraft, time, weather, pilot log) on the right. All labels, test ids and the mode-select screen's shared `ready-label` class are unchanged.
- The navigation lights and strobes of the photographic airliners (`photoBody.ts` `placeNavLights`) are placed at the fitted model's real wingtips and tail instead of the procedural wing's.
