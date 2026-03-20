Place Blender-exported `.glb` or `.gltf` assets here.

Recommended workflow:

1. Export from Blender as `glTF 2.0` (`.glb` is easiest).
2. Keep the model centered and apply transforms before export.
3. Register the asset in `src/blender/manifest.js`.

Example manifest entry:

```js
{
  id: "tokyo-tower",
  url: "./assets/models/tokyo-tower.glb",
  anchor: "surface",
  latitude: 35.6586,
  longitude: 139.7454,
  radius: 1.002,
  headingDegrees: 0,
  scale: 0.0025,
}
```

`anchor: "surface"` mounts the asset to a latitude/longitude on the globe.
If you need a free-floating asset, omit `anchor` and use `target: "scene"` or `target: "earthSystem"`.
