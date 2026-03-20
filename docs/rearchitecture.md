# 3D Earth Explorer Rearchitecture Notes

## Review

The current app works, but the original structure concentrated too much in `src/main.js`.
Before this pass, one file handled:

- scene bootstrapping
- shader creation
- input/UI state
- flight-data fetching
- regional texture streaming
- coordinate formatting
- debug helpers

That made new features expensive to add and especially awkward for Blender-based assets, because there was no stable asset pipeline or model registration point.

## What Changed

This redesign pass introduces a safer first-stage split:

- `src/config/app-config.js`
  central tuning values for renderer, camera, controls, flights, and regional imagery
- `src/render/scene-factories.js`
  Earth, cloud, atmosphere, and starfield materials/meshes
- `src/blender/manifest.js`
  a single manifest for optional Blender-exported assets
- `src/blender/load-blender-assets.js`
  a loader that mounts `.glb/.gltf` assets either onto the globe surface or into the free scene

The Blender reference in `shared-docs` also makes the intended intake path clearer:

- inspect `FBX` structure in Blender first
- record bones / meshes / materials / morphs if the source asset is complex
- export a web-friendly `glTF / GLB`
- register the final web asset in this project

`src/main.js` remains the application orchestrator, but it no longer owns every rendering primitive or future asset decision.

## Blender-Oriented Direction

For Blender-backed expansion, the project should move toward three layers:

1. `app orchestration`
   UI wiring, time sync, feature toggles, and high-level lifecycle
2. `runtime services`
   flight snapshot fetcher, regional texture cache, debug bridge
3. `scene assets`
   shader materials, procedural layers, and Blender-authored glTF assets

That separation allows us to add landmarks, custom aircraft meshes, satellites, or atmospheric meshes from Blender without threading asset-specific logic through every other system.

## Recommended Next Steps

1. Move flight-data loading and tooltip rendering into a dedicated `src/features/flights/` area.
2. Move regional texture streaming into its own cache/service module.
3. Extract geo/math/format helpers from `main.js`.
4. Add a lightweight smoke test that loads the app and checks for WebGL/runtime errors.
5. If animated Blender assets are introduced, split asset playback from asset loading.

This pass is intentionally conservative: it improves structure and opens a Blender asset path without destabilizing the current globe behavior.
