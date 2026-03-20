import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { loadBlenderAssets } from "./blender/load-blender-assets.js";
import { APP_CONFIG } from "./config/app-config.js";
import {
  createAtmosphereMaterial,
  createCloudMaterial,
  createEarthMaterial,
  createStars,
} from "./render/scene-factories.js";

const canvas = document.querySelector("#earth-canvas");
const loadingLabel = document.querySelector("#loading");
const timeSyncButton = document.querySelector("#toggle-time-sync");
const cloudButton = document.querySelector("#toggle-clouds");
const flightButton = document.querySelector("#toggle-flights");
const resetButton = document.querySelector("#reset-view");
const syncValue = document.querySelector("#sync-value");
const clockValue = document.querySelector("#clock-value");
const flightStatusValue = document.querySelector("#flight-status-value");
const flightTooltip = document.querySelector("#flight-tooltip");
const latitudeValue = document.querySelector("#latitude-value");
const longitudeValue = document.querySelector("#longitude-value");

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
});

renderer.setPixelRatio(
  Math.min(window.devicePixelRatio, APP_CONFIG.renderer.maxPixelRatio)
);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(APP_CONFIG.renderer.clearColor, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = APP_CONFIG.renderer.toneMappingExposure;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  APP_CONFIG.camera.fov,
  window.innerWidth / window.innerHeight,
  APP_CONFIG.camera.near,
  APP_CONFIG.camera.far
);
camera.position.fromArray(APP_CONFIG.camera.initialPosition);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = APP_CONFIG.controls.minDistance;
controls.maxDistance = APP_CONFIG.controls.maxDistance;
controls.rotateSpeed = APP_CONFIG.controls.rotateSpeed;
controls.zoomSpeed = APP_CONFIG.controls.zoomSpeed;
controls.dampingFactor = APP_CONFIG.controls.dampingFactor;
controls.minPolarAngle = APP_CONFIG.controls.minPolarAngle;
controls.maxPolarAngle = APP_CONFIG.controls.maxPolarAngle;
controls.target.set(0, 0, 0);
controls.update();
controls.saveState();

const earthSystem = new THREE.Group();
earthSystem.rotation.z = THREE.MathUtils.degToRad(APP_CONFIG.earth.tiltDegrees);
scene.add(earthSystem);

const surfaceGroup = new THREE.Group();
surfaceGroup.rotation.y = THREE.MathUtils.degToRad(
  APP_CONFIG.earth.surfaceRotationDegrees
);
earthSystem.add(surfaceGroup);

scene.add(createStars());

const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
const loadingManager = new THREE.LoadingManager();
const textureLoader = new THREE.TextureLoader(loadingManager);
const regionalTextureLoader = new THREE.TextureLoader();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2(2, 2);
const screenCenter = new THREE.Vector2(0, 0);
const sunDirection = new THREE.Vector3(1, 0, 0);
const flightMarkerVector = new THREE.Vector3();
const flightDirectionVector = new THREE.Vector3();
const flightNorthVector = new THREE.Vector3();
const flightEastVector = new THREE.Vector3();
const debugEnabled = new URLSearchParams(window.location.search).has("debug");
const clockFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
const flightSnapshotFormatter = new Intl.DateTimeFormat("ja-JP", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
const regionalViewProjectionMatrix = new THREE.Matrix4();
const regionalViewFrustum = new THREE.Frustum();
const regionalWorldCenter = new THREE.Vector3();
const regionalVisibilitySphere = new THREE.Sphere();

let cloudsVisible = true;
let isTimeSynced = true;
let activeDate = new Date();
let dayTexture;
let earthMesh;
let cloudMesh;
let earthMaterial;
let cloudMaterial;
let atmosphereMaterial;
let flightLayer;
let flightPoints;
let flightPointsMaterial;
let activeRegionalTexture = null;
let activeRegionalBounds = null;
let currentViewedLatitude = null;
let currentViewedLongitude = null;
let flightsVisible = false;
let isLoadingFlights = false;
let activeFlightAbortController = null;
let flightRequestId = 0;
let hoveredFlightIndex = -1;
let pendingRegionalKey = "";
let regionalRequestId = 0;
let lastClockText = "";
let lastFlightStatusText = "表示オフ";
let lastLatitudeText = "";
let lastLongitudeText = "";

regionalTextureLoader.setCrossOrigin("anonymous");

syncValue.textContent = "PCの現在時刻と同期中";
clockValue.textContent = "--";
flightStatusValue.textContent = "表示オフ";
latitudeValue.textContent = "--";
longitudeValue.textContent = "--";

loadingManager.onProgress = (_, loaded, total) => {
  loadingLabel.textContent = `Loading earth textures... ${loaded}/${total}`;
};

loadingManager.onLoad = () => {
  loadingLabel.classList.add("is-hidden");
};

loadingManager.onError = (url) => {
  loadingLabel.textContent = `Failed to load: ${url}`;
};

timeSyncButton.addEventListener("click", () => {
  isTimeSynced = !isTimeSynced;

  if (isTimeSynced) {
    activeDate = new Date();
  }

  updateTimeSyncUI();
  updateClockLabel(activeDate);
});

cloudButton.addEventListener("click", () => {
  cloudsVisible = !cloudsVisible;

  if (cloudMesh) {
    cloudMesh.visible = cloudsVisible;
  }

  cloudButton.textContent = cloudsVisible ? "雲を非表示" : "雲を表示";
});

flightButton.addEventListener("click", () => {
  if (isLoadingFlights) {
    return;
  }

  if (flightsVisible) {
    flightsVisible = false;
    flightRequestId += 1;
    activeFlightAbortController?.abort();
    activeFlightAbortController = null;
    clearFlightMarkers();
    setFlightStatus("表示オフ");
    hideFlightTooltip();
    updateFlightToggleUI();
    return;
  }

  flightsVisible = true;
  updateFlightToggleUI();
  loadFlightSnapshot();
});

resetButton.addEventListener("click", () => {
  controls.reset();
});

canvas.addEventListener("pointermove", handleCanvasPointerMove);
canvas.addEventListener("pointerleave", hideFlightTooltip);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(
    Math.min(window.devicePixelRatio, APP_CONFIG.renderer.maxPixelRatio)
  );
  hideFlightTooltip();
});

init().catch((error) => {
  console.error(error);
  loadingLabel.textContent = "Unable to initialize the 3D Earth scene.";
});

async function init() {
  const [dayMap, cloudMap, lightsMap, reliefMap] =
    await Promise.all([
      loadTexture("./assets/textures/earth-day.jpg", { color: true }),
      loadTexture("./assets/textures/earth-clouds.png", { color: true }),
      loadTexture("./assets/textures/earth-lights.png", { color: true }),
      loadTexture("./assets/textures/earth-normal.jpg"),
    ]);

  dayTexture = dayMap;

  const earthGeometry = new THREE.SphereGeometry(
    APP_CONFIG.earth.radius,
    APP_CONFIG.earth.geometrySegments,
    APP_CONFIG.earth.geometrySegments
  );
  earthMaterial = createEarthMaterial(dayMap, lightsMap, reliefMap);

  earthMesh = new THREE.Mesh(earthGeometry, earthMaterial);
  surfaceGroup.add(earthMesh);

  cloudMaterial = createCloudMaterial(cloudMap);
  cloudMesh = new THREE.Mesh(
    new THREE.SphereGeometry(
      APP_CONFIG.earth.cloudRadius,
      APP_CONFIG.earth.geometrySegments,
      APP_CONFIG.earth.geometrySegments
    ),
    cloudMaterial
  );
  cloudMesh.visible = cloudsVisible;
  surfaceGroup.add(cloudMesh);

  flightLayer = new THREE.Group();
  surfaceGroup.add(flightLayer);

  atmosphereMaterial = createAtmosphereMaterial();
  const atmosphereMesh = new THREE.Mesh(
    new THREE.SphereGeometry(
      APP_CONFIG.earth.atmosphereRadius,
      APP_CONFIG.earth.geometrySegments,
      APP_CONFIG.earth.geometrySegments
    ),
    atmosphereMaterial
  );
  earthSystem.add(atmosphereMesh);
  await loadBlenderAssets({
    loadingManager,
    maxAnisotropy,
    scene,
    earthSystem,
    surfaceGroup,
  });

  scene.updateMatrixWorld(true);
  updateTimeSyncUI();
  updateSolarState(activeDate);
  updateClockLabel(activeDate);
  updateFlightToggleUI();
  updateControlSensitivity();
  updateViewedLocation();
  exposeDebugBridge();
  animate();
}

function animate() {
  renderer.setAnimationLoop(() => {
    if (isTimeSynced) {
      activeDate = new Date();
    }

    updateSolarState(activeDate);
    updateClockLabel(activeDate);
    updateControlSensitivity();
    controls.update();
    updateFlightMarkerScale();
    updateViewedLocation();
    renderer.render(scene, camera);
  });
}

function updateControlSensitivity() {
  const distance = camera.position.distanceTo(controls.target);
  const rampRatio = smooth01(
    (distance - controls.minDistance) /
      (APP_CONFIG.controls.precisionRampDistance - controls.minDistance)
  );

  controls.rotateSpeed = THREE.MathUtils.lerp(
    APP_CONFIG.controls.closeRotateSpeed,
    APP_CONFIG.controls.rotateSpeed,
    rampRatio
  );
  controls.zoomSpeed = THREE.MathUtils.lerp(
    APP_CONFIG.controls.closeZoomSpeed,
    APP_CONFIG.controls.zoomSpeed,
    rampRatio
  );
  controls.dampingFactor = THREE.MathUtils.lerp(
    APP_CONFIG.controls.closeDampingFactor,
    APP_CONFIG.controls.dampingFactor,
    rampRatio
  );
}

function updateSolarState(date) {
  const { subsolarLatitude, subsolarLongitude } = getSubsolarCoordinates(date);
  const localSunVector = latLonToSurfaceVector(
    subsolarLatitude,
    subsolarLongitude,
    sunDirection
  );

  surfaceGroup.updateWorldMatrix(true, false);
  surfaceGroup.localToWorld(localSunVector);
  localSunVector.normalize();

  if (earthMaterial) {
    earthMaterial.uniforms.sunDirection.value.copy(localSunVector);
  }

  if (cloudMaterial) {
    cloudMaterial.uniforms.sunDirection.value.copy(localSunVector);
  }

  if (atmosphereMaterial) {
    atmosphereMaterial.uniforms.sunDirection.value.copy(localSunVector);
  }
}

function updateClockLabel(date) {
  const nextClockText = `${clockFormatter.format(date)} ${formatUtcOffset(date)}`;

  if (nextClockText === lastClockText) {
    return;
  }

  lastClockText = nextClockText;
  clockValue.textContent = nextClockText;
}

function updateViewedLocation() {
  if (!earthMesh) {
    return;
  }

  raycaster.setFromCamera(screenCenter, camera);
  const [intersection] = raycaster.intersectObject(earthMesh, false);

  if (!intersection?.uv) {
    currentViewedLatitude = null;
    currentViewedLongitude = null;
    setCoordinateLabels("--", "--");
    updateDetailFocus(null);
    return;
  }

  const latitude = intersection.uv.y * 180 - 90;
  const longitude = normalizeLongitude(intersection.uv.x * 360 - 180);
  currentViewedLatitude = latitude;
  currentViewedLongitude = longitude;

  setCoordinateLabels(formatLatitude(latitude), formatLongitude(longitude));
  updateDetailFocus(intersection, latitude, longitude);
}

function setCoordinateLabels(latitudeText, longitudeText) {
  if (latitudeText !== lastLatitudeText) {
    lastLatitudeText = latitudeText;
    latitudeValue.textContent = latitudeText;
  }

  if (longitudeText !== lastLongitudeText) {
    lastLongitudeText = longitudeText;
    longitudeValue.textContent = longitudeText;
  }
}

function updateTimeSyncUI() {
  syncValue.textContent = isTimeSynced
    ? "PCの現在時刻と同期中"
    : "表示を固定中";
  timeSyncButton.textContent = isTimeSynced
    ? "時刻同期を停止"
    : "時刻同期を再開";
}

function updateFlightToggleUI() {
  flightButton.disabled = isLoadingFlights || !flightLayer || !earthMesh;
  flightButton.textContent = isLoadingFlights
    ? "航空機を読込中..."
    : flightsVisible
      ? "航空機を非表示"
      : "航空機を表示";
}

function setFlightStatus(text) {
  if (text === lastFlightStatusText) {
    return;
  }

  lastFlightStatusText = text;
  flightStatusValue.textContent = text;
}

function handleCanvasPointerMove(event) {
  if (!flightsVisible || !flightPoints) {
    hideFlightTooltip();
    return;
  }

  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;

  updateFlightTooltip(event.clientX, event.clientY);
}

function updateFlightTooltip(clientX, clientY) {
  if (!flightPoints) {
    hideFlightTooltip();
    return;
  }

  raycaster.params.Points.threshold = THREE.MathUtils.lerp(
    0.02,
    0.04,
    smooth01(
      (camera.position.distanceTo(controls.target) - controls.minDistance) /
        (4.9 - controls.minDistance)
    )
  );
  raycaster.setFromCamera(pointer, camera);

  const [intersection] = raycaster.intersectObject(flightPoints, false);
  const hoveredRecord =
    intersection?.index != null
      ? flightPoints.userData.records?.[intersection.index]
      : null;

  if (!hoveredRecord) {
    hideFlightTooltip();
    return;
  }

  if (hoveredFlightIndex !== intersection.index) {
    hoveredFlightIndex = intersection.index;
    flightTooltip.innerHTML = renderFlightTooltip(hoveredRecord);
  }

  positionFlightTooltip(clientX, clientY);
  canvas.style.cursor = "pointer";
  flightTooltip.classList.add("is-visible");
}

function positionFlightTooltip(clientX, clientY) {
  const offset = 18;
  const tooltipWidth = flightTooltip.offsetWidth || 280;
  const tooltipHeight = flightTooltip.offsetHeight || 220;
  let x = clientX + offset;
  let y = clientY + offset;

  if (x + tooltipWidth > window.innerWidth - 16) {
    x = clientX - tooltipWidth - offset;
  }

  if (y + tooltipHeight > window.innerHeight - 16) {
    y = clientY - tooltipHeight - offset;
  }

  flightTooltip.style.left = `${Math.max(16, x)}px`;
  flightTooltip.style.top = `${Math.max(16, y)}px`;
}

function hideFlightTooltip() {
  hoveredFlightIndex = -1;
  canvas.style.cursor = "";
  flightTooltip.classList.remove("is-visible");
}

async function loadFlightSnapshot() {
  if (!flightLayer) {
    flightsVisible = false;
    updateFlightToggleUI();
    return;
  }

  const requestId = ++flightRequestId;
  isLoadingFlights = true;
  activeFlightAbortController = new AbortController();
  clearFlightMarkers();
  setFlightStatus("全世界の航空機データを読込中...");
  updateFlightToggleUI();

  try {
    const response = await fetch(APP_CONFIG.flights.openSkyStatesUrl, {
      cache: "no-store",
      mode: "cors",
      signal: activeFlightAbortController.signal,
    });
    
    if (!response.ok) {
      throw new Error(`OpenSky request failed: ${response.status}`);
    }

    const data = await response.json();

    if (requestId !== flightRequestId || !flightsVisible) {
      return;
    }

    const flightCount = populateFlightMarkers(data.states ?? []);
    const snapshotDate =
      typeof data.time === "number" ? new Date(data.time * 1000) : new Date();

    if (flightCount <= 0) {
      flightsVisible = false;
      setFlightStatus("飛行中の航空機を取得できませんでした");
      return;
    }

    setFlightStatus(
      `全世界の ${flightCount.toLocaleString("ja-JP")} 機を表示中 (${formatFlightSnapshotTime(snapshotDate)})`
    );
  } catch (error) {
    if (error.name === "AbortError" || requestId !== flightRequestId) {
      return;
    }

    console.error(error);
    flightsVisible = false;
    clearFlightMarkers();
    setFlightStatus("航空機データの取得に失敗");
  } finally {
    if (requestId === flightRequestId) {
      activeFlightAbortController = null;
      isLoadingFlights = false;
      updateFlightToggleUI();
    }
  }
}

function populateFlightMarkers(states) {
  if (!flightLayer) {
    return 0;
  }

  const airborneStates = states.filter(
    (state) => state?.[5] != null && state?.[6] != null && state?.[8] === false
  );

  if (airborneStates.length <= 0) {
    clearFlightMarkers();
    return 0;
  }

  const positions = new Float32Array(airborneStates.length * 3);
  const directions = new Float32Array(airborneStates.length * 3);
  const records = new Array(airborneStates.length);

  airborneStates.forEach((state, index) => {
    const longitude = state[5];
    const latitude = state[6];
    const altitude =
      Number.isFinite(state[7]) && state[7] > 0 ? state[7] : 0;
    const track = Number.isFinite(state[10]) ? state[10] : 0;
    const radius =
      APP_CONFIG.flights.markerBaseRadius +
      THREE.MathUtils.clamp(altitude / 12000, 0, 1) *
        APP_CONFIG.flights.markerAltitudeScale;

    latLonToSurfaceVector(latitude, longitude, flightMarkerVector).multiplyScalar(
      radius
    );
    getFlightTrackVector(latitude, longitude, track, flightDirectionVector);

    const positionIndex = index * 3;
    positions[positionIndex] = flightMarkerVector.x;
    positions[positionIndex + 1] = flightMarkerVector.y;
    positions[positionIndex + 2] = flightMarkerVector.z;
    directions[positionIndex] = flightDirectionVector.x;
    directions[positionIndex + 1] = flightDirectionVector.y;
    directions[positionIndex + 2] = flightDirectionVector.z;
    records[index] = buildFlightRecord(state);
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("direction", new THREE.BufferAttribute(directions, 3));
  geometry.computeBoundingSphere();

  clearFlightMarkers();

  flightPoints = new THREE.Points(geometry, getFlightMarkerMaterial());
  flightPoints.userData.records = records;
  flightLayer.add(flightPoints);
  updateFlightMarkerScale();

  return airborneStates.length;
}

function clearFlightMarkers() {
  if (!flightPoints || !flightLayer) {
    return;
  }

  flightLayer.remove(flightPoints);
  hideFlightTooltip();
  flightPoints.geometry.dispose();
  flightPoints = null;
}

function getFlightMarkerMaterial() {
  if (!flightPointsMaterial) {
    flightPointsMaterial = new THREE.ShaderMaterial({
      uniforms: {
        markerMap: { value: createFlightMarkerTexture() },
        markerSize: { value: APP_CONFIG.flights.markerMaxSize },
        pointScale: { value: renderer.getPixelRatio() * window.innerHeight * 0.5 },
      },
      vertexShader: `
        attribute vec3 direction;

        uniform float markerSize;
        uniform float pointScale;

        varying float vRotation;

        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vec4 clipPosition = projectionMatrix * mvPosition;
          vec4 clipDirection = projectionMatrix * modelViewMatrix * vec4(position + direction * 0.065, 1.0);
          vec2 screenDirection =
            (clipDirection.xy / max(clipDirection.w, 0.0001)) -
            (clipPosition.xy / max(clipPosition.w, 0.0001));
          float directionLength = length(screenDirection);

          vRotation = directionLength > 0.00001
            ? atan(screenDirection.y, screenDirection.x) - 1.57079632679
            : 0.0;

          gl_PointSize = markerSize * pointScale / max(-mvPosition.z, 0.0001);
          gl_Position = clipPosition;
        }
      `,
      fragmentShader: `
        uniform sampler2D markerMap;

        varying float vRotation;

        void main() {
          vec2 centered = gl_PointCoord - 0.5;
          float sine = sin(-vRotation);
          float cosine = cos(-vRotation);
          vec2 rotatedUv =
            mat2(cosine, -sine, sine, cosine) * centered + 0.5;

          if (
            rotatedUv.x < 0.0 || rotatedUv.x > 1.0 ||
            rotatedUv.y < 0.0 || rotatedUv.y > 1.0
          ) {
            discard;
          }

          vec4 marker = texture2D(markerMap, rotatedUv);

          if (marker.a < 0.12) {
            discard;
          }

          gl_FragColor = marker;
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
  }

  return flightPointsMaterial;
}

function createFlightMarkerTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext("2d");
  context.clearRect(0, 0, size, size);
  context.translate(size / 2, size / 2);
  context.shadowColor = "rgba(126, 200, 255, 0.55)";
  context.shadowBlur = 16;
  context.fillStyle = "rgba(255, 255, 255, 0.97)";
  context.strokeStyle = "rgba(126, 200, 255, 0.92)";
  context.lineWidth = 4;

  context.beginPath();
  context.moveTo(0, -54);
  context.lineTo(10, -12);
  context.lineTo(34, -2);
  context.lineTo(34, 8);
  context.lineTo(10, 6);
  context.lineTo(7, 48);
  context.lineTo(18, 56);
  context.lineTo(18, 64);
  context.lineTo(0, 56);
  context.lineTo(-18, 64);
  context.lineTo(-18, 56);
  context.lineTo(-7, 48);
  context.lineTo(-10, 6);
  context.lineTo(-34, 8);
  context.lineTo(-34, -2);
  context.lineTo(-10, -12);
  context.closePath();
  context.fill();
  context.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  return texture;
}

function buildFlightRecord(state) {
  const altitude =
    Number.isFinite(state[13]) && state[13] > 0
      ? state[13]
      : Number.isFinite(state[7]) && state[7] > 0
        ? state[7]
        : null;

  return {
    icao24: String(state[0] ?? "").toUpperCase(),
    callsign: String(state[1] ?? "").trim(),
    country: state[2] ?? "--",
    lastContact: Number.isFinite(state[4]) ? new Date(state[4] * 1000) : null,
    latitude: state[6],
    longitude: state[5],
    altitude,
    speed: Number.isFinite(state[9]) ? state[9] : null,
    track: Number.isFinite(state[10]) ? state[10] : null,
  };
}

function renderFlightTooltip(record) {
  const title = record.callsign || record.icao24 || "UNKNOWN";
  const subtitle = record.callsign
    ? `${record.country} / ${record.icao24}`
    : record.country;

  return `
    <p class="flight-tooltip__eyebrow">Airborne Aircraft</p>
    <p class="flight-tooltip__title">${escapeHtml(title)}</p>
    <p class="flight-tooltip__meta">${escapeHtml(subtitle)}</p>
    <div class="flight-tooltip__grid">
      ${renderFlightTooltipCell("緯度", formatFlightCoordinate(record.latitude, true))}
      ${renderFlightTooltipCell("経度", formatFlightCoordinate(record.longitude, false))}
      ${renderFlightTooltipCell("高度", formatFlightAltitude(record.altitude))}
      ${renderFlightTooltipCell("速度", formatFlightSpeed(record.speed))}
      ${renderFlightTooltipCell("進行方向", formatFlightHeading(record.track))}
      ${renderFlightTooltipCell("最終受信", formatFlightContact(record.lastContact))}
    </div>
  `;
}

function renderFlightTooltipCell(label, value) {
  return `
    <div class="flight-tooltip__cell">
      <span class="flight-tooltip__label">${label}</span>
      <span class="flight-tooltip__value">${escapeHtml(value)}</span>
    </div>
  `;
}

function getFlightTrackVector(latitude, longitude, track, target) {
  const latitudeRad = THREE.MathUtils.degToRad(latitude);
  const longitudeRad = THREE.MathUtils.degToRad(longitude);
  const trackRad = THREE.MathUtils.degToRad(track);

  flightNorthVector.set(
    -Math.cos(longitudeRad) * Math.sin(latitudeRad),
    Math.cos(latitudeRad),
    Math.sin(longitudeRad) * Math.sin(latitudeRad)
  );
  flightEastVector.set(-Math.sin(longitudeRad), 0, -Math.cos(longitudeRad));

  return target
    .copy(flightNorthVector)
    .multiplyScalar(Math.cos(trackRad))
    .addScaledVector(flightEastVector, Math.sin(trackRad))
    .normalize();
}

function updateFlightMarkerScale() {
  if (!flightPointsMaterial) {
    return;
  }

  const distance = camera.position.distanceTo(controls.target);
  const distanceFactor = smooth01(
    (distance - controls.minDistance) / (4.9 - controls.minDistance)
  );

  flightPointsMaterial.uniforms.markerSize.value = THREE.MathUtils.lerp(
    APP_CONFIG.flights.markerMinSize,
    APP_CONFIG.flights.markerMaxSize,
    distanceFactor
  );
  flightPointsMaterial.uniforms.pointScale.value =
    renderer.getPixelRatio() * window.innerHeight * 0.5;
}

function updateDetailFocus(intersection, latitude, longitude) {
  if (!earthMaterial) {
    return;
  }

  const detailStrength = getDetailStrength();
  earthMaterial.uniforms.detailStrength.value = detailStrength;

  if (!intersection || detailStrength <= 0) {
    discardRegionalTexture();
    return;
  }

  earthMaterial.uniforms.focusDirection.value
    .copy(intersection.point)
    .normalize();

  if (activeRegionalBounds && !isRegionalBoundsVisible(activeRegionalBounds)) {
    discardRegionalTexture();
  }

  updateRegionalTexture(latitude, longitude);
  earthMaterial.uniforms.hiResMix.value = activeRegionalTexture
    ? getRegionalTextureStrength()
    : 0;
}

async function loadTexture(path, options = {}) {
  const texture = await textureLoader.loadAsync(path);
  texture.anisotropy = maxAnisotropy;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;

  if (options.color) {
    texture.colorSpace = THREE.SRGBColorSpace;
  }

  return texture;
}

function getSubsolarCoordinates(date) {
  const julianDate = date.getTime() / 86400000 + 2440587.5;
  const daysSinceJ2000 = julianDate - 2451545.0;
  const meanLongitude = normalizeDegrees(280.46 + 0.9856474 * daysSinceJ2000);
  const meanAnomaly = normalizeDegrees(357.528 + 0.9856003 * daysSinceJ2000);
  const meanAnomalyRad = THREE.MathUtils.degToRad(meanAnomaly);
  const eclipticLongitude = normalizeDegrees(
    meanLongitude +
      1.915 * Math.sin(meanAnomalyRad) +
      0.02 * Math.sin(meanAnomalyRad * 2)
  );
  const obliquity = 23.439 - 0.0000004 * daysSinceJ2000;
  const eclipticLongitudeRad = THREE.MathUtils.degToRad(eclipticLongitude);
  const obliquityRad = THREE.MathUtils.degToRad(obliquity);
  const subsolarLatitude = THREE.MathUtils.radToDeg(
    Math.asin(Math.sin(obliquityRad) * Math.sin(eclipticLongitudeRad))
  );
  const rightAscension = normalizeDegrees(
    THREE.MathUtils.radToDeg(
      Math.atan2(
        Math.cos(obliquityRad) * Math.sin(eclipticLongitudeRad),
        Math.cos(eclipticLongitudeRad)
      )
    )
  );
  const centuriesSinceJ2000 = daysSinceJ2000 / 36525;
  const greenwichMeanSiderealTime = normalizeDegrees(
    280.46061837 +
      360.98564736629 * daysSinceJ2000 +
      0.000387933 * centuriesSinceJ2000 ** 2 -
      centuriesSinceJ2000 ** 3 / 38710000
  );
  const subsolarLongitude = normalizeLongitude(
    rightAscension - greenwichMeanSiderealTime
  );

  return { subsolarLatitude, subsolarLongitude };
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

function getDetailStrength() {
  const distance = camera.position.distanceTo(controls.target);
  const detailFadeDistance = APP_CONFIG.detail.fadeDistance;

  if (distance >= detailFadeDistance) {
    return 0;
  }

  return smooth01(
    (detailFadeDistance - distance) /
      (detailFadeDistance - controls.minDistance)
  );
}

function getRegionalTextureStrength() {
  const distance = camera.position.distanceTo(controls.target);

  if (distance >= APP_CONFIG.regionalTexture.activationDistance) {
    return 0;
  }

  return smooth01(
    (APP_CONFIG.regionalTexture.activationDistance - distance) /
      (APP_CONFIG.regionalTexture.activationDistance - controls.minDistance)
  );
}

function updateRegionalTexture(latitude, longitude) {
  const hiResStrength = getRegionalTextureStrength();

  if (hiResStrength <= 0) {
    discardRegionalTexture();
    return;
  }

  if (
    activeRegionalBounds &&
    isCurrentViewRelevantForBounds(activeRegionalBounds)
  ) {
    earthMaterial.uniforms.hiResMix.value = hiResStrength;
    return;
  }

  const requestBounds = buildRegionalBounds(latitude, longitude, hiResStrength);

  if (!requestBounds) {
    discardRegionalTexture();
    return;
  }

  if (activeRegionalBounds?.key === requestBounds.key) {
    earthMaterial.uniforms.hiResMix.value = hiResStrength;
    return;
  }

  if (pendingRegionalKey === requestBounds.key) {
    return;
  }

  pendingRegionalKey = requestBounds.key;
  regionalRequestId += 1;
  const requestId = regionalRequestId;
  disposeActiveRegionalTexture();
  earthMaterial.uniforms.hiResMix.value = 0;

  regionalTextureLoader.load(
    buildRegionalTextureUrl(requestBounds),
    (texture) => {
      if (
        requestId !== regionalRequestId ||
        !earthMaterial ||
        getRegionalTextureStrength() <= 0 ||
        !isCurrentViewRelevantForBounds(requestBounds, 0.02)
      ) {
        texture.dispose();
        return;
      }

      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = maxAnisotropy;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;

      activeRegionalTexture = texture;
      activeRegionalBounds = requestBounds;
      pendingRegionalKey = "";

      earthMaterial.uniforms.hiResMap.value = texture;
      earthMaterial.uniforms.hiResBounds.value.set(
        requestBounds.west,
        requestBounds.south,
        requestBounds.east,
        requestBounds.north
      );
      earthMaterial.uniforms.hiResMix.value = getRegionalTextureStrength();
    },
    undefined,
    () => {
      if (requestId !== regionalRequestId) {
        return;
      }

      pendingRegionalKey = "";
    }
  );
}

function discardRegionalTexture() {
  pendingRegionalKey = "";
  regionalRequestId += 1;
  disposeActiveRegionalTexture();

  if (earthMaterial) {
    earthMaterial.uniforms.hiResMix.value = 0;
  }
}

function disposeActiveRegionalTexture() {
  if (!earthMaterial) {
    return;
  }

  if (activeRegionalTexture) {
    activeRegionalTexture.dispose();
    activeRegionalTexture = null;
  }

  activeRegionalBounds = null;
  earthMaterial.uniforms.hiResMap.value = dayTexture;
  earthMaterial.uniforms.hiResBounds.value.set(-180, -90, 180, 90);
}

function buildRegionalBounds(latitude, longitude, hiResStrength) {
  const latRadius = THREE.MathUtils.lerp(
    APP_CONFIG.regionalTexture.maxRadius,
    APP_CONFIG.regionalTexture.minRadius,
    hiResStrength
  );
  const lonRadius = Math.min(
    latRadius / Math.max(Math.cos(THREE.MathUtils.degToRad(latitude)), 0.26),
    APP_CONFIG.regionalTexture.maxLongitudeRadius
  );
  const latitudeStep = Math.max(
    latRadius * APP_CONFIG.regionalTexture.snapRatio,
    0.35
  );
  const longitudeStep = Math.max(
    lonRadius * APP_CONFIG.regionalTexture.snapRatio,
    0.35
  );
  const centerLatitude = THREE.MathUtils.clamp(
    Math.round(latitude / latitudeStep) * latitudeStep,
    -88.5 + latRadius,
    88.5 - latRadius
  );
  const centerLongitude = THREE.MathUtils.clamp(
    Math.round(longitude / longitudeStep) * longitudeStep,
    -180 + lonRadius,
    180 - lonRadius
  );
  const south = centerLatitude - latRadius;
  const north = centerLatitude + latRadius;
  const west = centerLongitude - lonRadius;
  const east = centerLongitude + lonRadius;

  if (east - west < 1 || north - south < 1) {
    return null;
  }

  return {
    centerLatitude,
    centerLongitude,
    latRadius,
    lonRadius,
    west,
    south,
    east,
    north,
    key: [centerLatitude, centerLongitude, latRadius, lonRadius]
      .map((value) => value.toFixed(2))
      .join(":"),
  };
}

function buildRegionalTextureUrl(bounds) {
  const params = new URLSearchParams({
    SERVICE: "WMS",
    REQUEST: "GetMap",
    VERSION: "1.1.1",
    SRS: "EPSG:4326",
    LAYERS: APP_CONFIG.regionalTexture.layer,
    BBOX: `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`,
    WIDTH: String(APP_CONFIG.regionalTexture.requestSize),
    HEIGHT: String(APP_CONFIG.regionalTexture.requestSize),
    FORMAT: "image/jpeg",
  });

  return `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?${params.toString()}`;
}

function isWithinRegionalBounds(latitude, longitude, bounds, marginRatio = 0) {
  const latMargin = (bounds.north - bounds.south) * marginRatio;
  const lonMargin = (bounds.east - bounds.west) * marginRatio;

  return (
    latitude >= bounds.south + latMargin &&
    latitude <= bounds.north - latMargin &&
    longitude >= bounds.west + lonMargin &&
    longitude <= bounds.east - lonMargin
  );
}

function isCurrentViewRelevantForBounds(
  bounds,
  marginRatio = APP_CONFIG.regionalTexture.keepMargin
) {
  if (currentViewedLatitude === null || currentViewedLongitude === null) {
    return false;
  }

  return (
    isRegionalBoundsVisible(bounds) &&
    isWithinRegionalBounds(
      currentViewedLatitude,
      currentViewedLongitude,
      bounds,
      marginRatio
    )
  );
}

function isRegionalBoundsVisible(bounds) {
  camera.updateMatrixWorld();
  regionalViewProjectionMatrix.multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse
  );
  regionalViewFrustum.setFromProjectionMatrix(regionalViewProjectionMatrix);

  surfaceGroup.updateWorldMatrix(true, false);
  latLonToSurfaceVector(
    bounds.centerLatitude,
    bounds.centerLongitude,
    regionalWorldCenter
  );
  surfaceGroup.localToWorld(regionalWorldCenter);

  return regionalViewFrustum.intersectsSphere(
    regionalVisibilitySphere.set(
      regionalWorldCenter,
      Math.sin(
        THREE.MathUtils.degToRad(Math.max(bounds.latRadius, bounds.lonRadius))
      ) * 1.08
    )
  );
}

function exposeDebugBridge() {
  if (!debugEnabled) {
    return;
  }

  window.__earthDebug = {
    getState() {
      return {
        cameraDistance: Number(
          camera.position.distanceTo(controls.target).toFixed(4)
        ),
        detailStrength: earthMaterial
          ? Number(earthMaterial.uniforms.detailStrength.value.toFixed(4))
          : 0,
        hiResMix: earthMaterial
          ? Number(earthMaterial.uniforms.hiResMix.value.toFixed(4))
          : 0,
        hasRegionalTexture: Boolean(activeRegionalTexture),
        activeRegionalKey: activeRegionalBounds?.key ?? null,
        pendingRegionalKey: pendingRegionalKey || null,
        flightsVisible,
        flightStatus: lastFlightStatusText,
        flightMarkers: flightPoints?.geometry?.attributes?.position?.count ?? 0,
        latitude: currentViewedLatitude,
        longitude: currentViewedLongitude,
      };
    },
    setCameraDistance(distance) {
      const offset = camera.position.clone().sub(controls.target);
      const nextDistance = THREE.MathUtils.clamp(
        distance,
        controls.minDistance,
        controls.maxDistance
      );
      offset.setLength(nextDistance);
      camera.position.copy(controls.target).add(offset);
      controls.update();
      updateViewedLocation();
      return nextDistance;
    },
    orbitByDegrees(deltaAzimuth, deltaPolar = 0) {
      const offset = camera.position.clone().sub(controls.target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      spherical.theta += THREE.MathUtils.degToRad(deltaAzimuth);
      spherical.phi = THREE.MathUtils.clamp(
        spherical.phi + THREE.MathUtils.degToRad(deltaPolar),
        controls.minPolarAngle,
        controls.maxPolarAngle
      );
      offset.setFromSpherical(spherical);
      camera.position.copy(controls.target).add(offset);
      controls.update();
      updateViewedLocation();
      return this.getState();
    },
    toggleFlights() {
      flightButton.click();
      return this.getState();
    },
    getFlightRotationSamples(count = 5) {
      if (!flightPoints) {
        return [];
      }

      const positions = flightPoints.geometry.getAttribute("position");
      const directions = flightPoints.geometry.getAttribute("direction");
      const samples = [];
      const step = Math.max(Math.floor(positions.count / Math.max(count, 1)), 1);

      for (
        let sampleIndex = 0;
        sampleIndex < Math.min(count, positions.count);
        sampleIndex += 1
      ) {
        const index = Math.min(sampleIndex * step, positions.count - 1);
        const localPosition = new THREE.Vector3(
          positions.getX(index),
          positions.getY(index),
          positions.getZ(index)
        );
        const direction = new THREE.Vector3(
          directions.getX(index),
          directions.getY(index),
          directions.getZ(index)
        );
        const clipPosition = flightPoints
          .localToWorld(localPosition.clone())
          .project(camera);
        const clipDirection = flightPoints
          .localToWorld(localPosition.addScaledVector(direction, 0.065))
          .project(camera)
          .sub(clipPosition);

        samples.push(
          Number(
            (Math.atan2(clipDirection.y, clipDirection.x) - Math.PI / 2).toFixed(
              4
            )
          )
        );
      }

      return samples;
    },
    getFlightDirectionSamples(count = 5) {
      if (!flightPoints) {
        return [];
      }

      const directions = flightPoints.geometry.getAttribute("direction");
      const samples = [];
      const step = Math.max(Math.floor(directions.count / Math.max(count, 1)), 1);

      for (
        let sampleIndex = 0;
        sampleIndex < Math.min(count, directions.count);
        sampleIndex += 1
      ) {
        const index = Math.min(sampleIndex * step, directions.count - 1);
        samples.push([
          Number(directions.getX(index).toFixed(4)),
          Number(directions.getY(index).toFixed(4)),
          Number(directions.getZ(index).toFixed(4)),
        ]);
      }

      return samples;
    },
    getFlightHoverTargets(count = 5) {
      if (!flightPoints) {
        return [];
      }

      const positions = flightPoints.geometry.getAttribute("position");
      const records = flightPoints.userData.records ?? [];
      const samples = [];
      const step = Math.max(Math.floor(positions.count / Math.max(count, 1)), 1);

      for (
        let sampleIndex = 0;
        sampleIndex < positions.count && samples.length < count;
        sampleIndex += step
      ) {
        const position = new THREE.Vector3(
          positions.getX(sampleIndex),
          positions.getY(sampleIndex),
          positions.getZ(sampleIndex)
        );
        const clip = flightPoints.localToWorld(position).project(camera);

        if (clip.z < -1 || clip.z > 1) {
          continue;
        }

        samples.push({
          index: sampleIndex,
          x: Number((((clip.x + 1) * 0.5) * window.innerWidth).toFixed(1)),
          y: Number((((1 - clip.y) * 0.5) * window.innerHeight).toFixed(1)),
          title: records[sampleIndex]?.callsign || records[sampleIndex]?.icao24,
        });
      }

      return samples;
    },
  };
}

function normalizeDegrees(value) {
  return ((value % 360) + 360) % 360;
}

function normalizeLongitude(value) {
  const normalized = ((value + 180) % 360 + 360) % 360 - 180;
  return normalized === -180 ? 180 : normalized;
}

function formatLatitude(value) {
  return `${Math.abs(value).toFixed(2)}° ${value >= 0 ? "N" : "S"}`;
}

function formatLongitude(value) {
  return `${Math.abs(value).toFixed(2)}° ${value >= 0 ? "E" : "W"}`;
}

function formatFlightCoordinate(value, isLatitude) {
  if (!Number.isFinite(value)) {
    return "--";
  }

  return isLatitude ? formatLatitude(value) : formatLongitude(value);
}

function formatFlightAltitude(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }

  return `${value.toLocaleString("ja-JP", { maximumFractionDigits: 0 })} m`;
}

function formatFlightSpeed(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }

  return `${(value * 3.6).toLocaleString("ja-JP", {
    maximumFractionDigits: 0,
  })} km/h`;
}

function formatFlightHeading(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }

  return `${value.toFixed(0)}°`;
}

function formatFlightContact(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return "--";
  }

  return `${flightSnapshotFormatter.format(value)} ${formatUtcOffset(value)}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatFlightSnapshotTime(date) {
  return `${flightSnapshotFormatter.format(date)} ${formatUtcOffset(date)}`;
}

function formatUtcOffset(date) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteMinutes = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absoluteMinutes / 60)).padStart(2, "0");
  const minutes = String(absoluteMinutes % 60).padStart(2, "0");

  return `UTC${sign}${hours}:${minutes}`;
}

function smooth01(value) {
  const clamped = THREE.MathUtils.clamp(value, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}
