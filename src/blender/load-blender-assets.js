import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import { BLENDER_ASSET_MANIFEST } from "./manifest.js";

const surfaceNormal = new THREE.Vector3();

export async function loadBlenderAssets({
  loadingManager,
  maxAnisotropy,
  scene,
  earthSystem,
  surfaceGroup,
  manifest = BLENDER_ASSET_MANIFEST,
}) {
  if (!Array.isArray(manifest) || manifest.length <= 0) {
    return [];
  }

  const loader = new GLTFLoader(loadingManager);
  const settledResults = await Promise.allSettled(
    manifest.map((entry) =>
      loadSingleBlenderAsset(entry, {
        loader,
        maxAnisotropy,
        scene,
        earthSystem,
        surfaceGroup,
      })
    )
  );

  settledResults.forEach((result) => {
    if (result.status === "rejected") {
      console.warn("Blender asset skipped:", result.reason);
    }
  });

  return settledResults
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);
}

async function loadSingleBlenderAsset(
  entry,
  { loader, maxAnisotropy, scene, earthSystem, surfaceGroup }
) {
  if (!entry?.url) {
    throw new Error("Missing Blender asset url.");
  }

  const gltf = await loader.loadAsync(entry.url);
  const assetRoot = gltf.scene || gltf.scenes?.[0];

  if (!assetRoot) {
    throw new Error(`Unable to read scene from ${entry.url}`);
  }

  assetRoot.name = entry.id || assetRoot.name || "blender-asset";
  optimizeMaterials(assetRoot, maxAnisotropy);
  applyLocalTransform(assetRoot, entry);
  const assetSummary = summarizeAssetContents(assetRoot);
  assetRoot.userData.blenderAsset = {
    id: assetRoot.name,
    sourceUrl: entry.url,
    sourceFormat: entry.sourceFormat ?? "glb",
    notesPath: entry.notesPath ?? null,
    animations: gltf.animations ?? [],
    summary: assetSummary,
  };

  const mountedRoot = buildMountedRoot(assetRoot, entry);
  const targetGroup = resolveTargetGroup(entry, {
    scene,
    earthSystem,
    surfaceGroup,
  });

  targetGroup.add(mountedRoot);

  return {
    id: assetRoot.name,
    root: mountedRoot,
    summary: assetSummary,
    animations: gltf.animations ?? [],
  };
}

function optimizeMaterials(root, maxAnisotropy) {
  root.traverse((node) => {
    if (!node.isMesh) {
      return;
    }

    const materials = Array.isArray(node.material)
      ? node.material
      : [node.material];

    materials.forEach((material) => {
      if (!material) {
        return;
      }

      [
        material.map,
        material.normalMap,
        material.roughnessMap,
        material.metalnessMap,
        material.emissiveMap,
        material.aoMap,
      ]
        .filter(Boolean)
        .forEach((texture) => {
          texture.anisotropy = Math.max(texture.anisotropy ?? 1, maxAnisotropy);
        });
    });
  });
}

function applyLocalTransform(root, entry) {
  const scale = entry.scale ?? 1;
  const offset = entry.offset ?? [0, 0, 0];
  const rotationDegrees = entry.rotationDegrees ?? [0, 0, 0];

  if (Array.isArray(scale)) {
    root.scale.fromArray(scale);
  } else {
    root.scale.setScalar(scale);
  }

  if (Array.isArray(offset)) {
    root.position.fromArray(offset);
  }

  if (Array.isArray(rotationDegrees)) {
    root.rotation.set(
      THREE.MathUtils.degToRad(rotationDegrees[0] ?? 0),
      THREE.MathUtils.degToRad(rotationDegrees[1] ?? 0),
      THREE.MathUtils.degToRad(rotationDegrees[2] ?? 0)
    );
  }
}

function buildMountedRoot(root, entry) {
  if (entry.anchor !== "surface") {
    return root;
  }

  if (!Number.isFinite(entry.latitude) || !Number.isFinite(entry.longitude)) {
    throw new Error(
      `Surface-anchored Blender asset "${entry.id || entry.url}" needs latitude and longitude.`
    );
  }

  const mountedRoot = new THREE.Group();
  const radius = Number.isFinite(entry.radius) ? entry.radius : 1.002;

  latLonToSurfaceVector(entry.latitude, entry.longitude, surfaceNormal);
  mountedRoot.position.copy(surfaceNormal).multiplyScalar(radius);
  mountedRoot.quaternion.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, surfaceNormal.normalize());

  if (Number.isFinite(entry.headingDegrees)) {
    mountedRoot.rotateY(THREE.MathUtils.degToRad(entry.headingDegrees));
  }

  mountedRoot.add(root);
  mountedRoot.name = `${root.name}-anchor`;

  return mountedRoot;
}

function resolveTargetGroup(entry, { scene, earthSystem, surfaceGroup }) {
  if (entry.anchor === "surface") {
    return surfaceGroup;
  }

  if (entry.target === "earthSystem") {
    return earthSystem;
  }

  if (entry.target === "surfaceGroup") {
    return surfaceGroup;
  }

  return scene;
}

function summarizeAssetContents(root) {
  const materialNames = new Set();
  let meshCount = 0;
  let skinnedMeshCount = 0;
  let morphTargetMeshCount = 0;
  let armatureNodeCount = 0;

  root.traverse((node) => {
    if (node.type === "Bone" || node.type === "SkeletonHelper") {
      armatureNodeCount += 1;
    }

    if (!node.isMesh) {
      return;
    }

    meshCount += 1;

    if (node.isSkinnedMesh) {
      skinnedMeshCount += 1;
    }

    if (node.morphTargetInfluences?.length) {
      morphTargetMeshCount += 1;
    }

    const materials = Array.isArray(node.material)
      ? node.material
      : [node.material];

    materials.filter(Boolean).forEach((material) => {
      if (material.name) {
        materialNames.add(material.name);
      }
    });
  });

  return {
    meshCount,
    skinnedMeshCount,
    morphTargetMeshCount,
    armatureNodeCount,
    materialCount: materialNames.size,
    materialNames: [...materialNames].sort(),
  };
}

function latLonToSurfaceVector(latitude, longitude, target = new THREE.Vector3()) {
  const latitudeRad = THREE.MathUtils.degToRad(latitude);
  const phi = THREE.MathUtils.degToRad(longitude + 180);
  const cosLatitude = Math.cos(latitudeRad);

  return target.set(
    -Math.cos(phi) * cosLatitude,
    Math.sin(latitudeRad),
    Math.sin(phi) * cosLatitude
  );
}
