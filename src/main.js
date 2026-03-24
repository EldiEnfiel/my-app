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
const shipButton = document.querySelector("#toggle-ships");
const mapStyleButton = document.querySelector("#toggle-map-style");
const trafficInfoModeButton = document.querySelector("#toggle-traffic-info-mode");
const resetButton = document.querySelector("#reset-view");
const syncValue = document.querySelector("#sync-value");
const clockValue = document.querySelector("#clock-value");
const flightStatusValue = document.querySelector("#flight-status-value");
const shipStatusValue = document.querySelector("#ship-status-value");
const locationLogStatusValue = document.querySelector("#location-log-status-value");
const mapStyleValue = document.querySelector("#map-style-value");
const flightTooltip = document.querySelector("#flight-tooltip");
const locationSearchForm = document.querySelector("#location-search-form");
const locationSearchInput = document.querySelector("#location-search-input");
const locationSearchSubmit = document.querySelector("#location-search-submit");
const searchStatusValue = document.querySelector("#search-status-value");
const searchResults = document.querySelector("#search-results");
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
const pointerDownPoint = new THREE.Vector2();
const sunDirection = new THREE.Vector3(1, 0, 0);
const flightMarkerVector = new THREE.Vector3();
const flightDirectionVector = new THREE.Vector3();
const flightNorthVector = new THREE.Vector3();
const flightEastVector = new THREE.Vector3();
const cameraMoveVector = new THREE.Vector3();
const cameraMoveQuaternion = new THREE.Quaternion();
const identityQuaternion = new THREE.Quaternion();
const viewedLocalPoint = new THREE.Vector3();
const viewedWorldPoint = new THREE.Vector3();
const locationLogFocusVector = new THREE.Vector3();
const locationLogAggregateVector = new THREE.Vector3();
const debugEnabled = new URLSearchParams(window.location.search).has("debug");
const compactTrafficMediaQuery = window.matchMedia(
  `(max-width: ${APP_CONFIG.trafficInfo.compactBreakpoint}px)`
);
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
let shipLayer;
let shipPoints;
let shipPointsMaterial;
let locationLogLayer;
let locationLogTrailLine;
let locationLogTrailMaterial;
let locationLogPoints;
let locationLogPointsMaterial;
let locationLogLatestPoint;
let locationLogLatestPointMaterial;
let activeRegionalTexture = null;
let activeRegionalBounds = null;
let currentViewedLatitude = null;
let currentViewedLongitude = null;
let flightsVisible = false;
let shipsVisible = false;
let isLoadingFlights = false;
let isLoadingShips = false;
let activeFlightAbortController = null;
let activeShipAbortController = null;
let flightRequestId = 0;
let shipRequestId = 0;
let hoveredTooltipKey = "";
let pendingRegionalKey = "";
let regionalRequestId = 0;
let lastClockText = "";
let lastFlightStatusText = "表示オフ";
let lastShipStatusText = "表示オフ";
let lastLocationLogStatusText = "Waiting to load";
let lastLatitudeText = "";
let lastLongitudeText = "";
let lastSearchStatusText = "";
let mapStyleMode = APP_CONFIG.mapStyle.defaultMode;
let trafficInfoMode = compactTrafficMediaQuery.matches
  ? APP_CONFIG.trafficInfo.mobileDefaultMode
  : APP_CONFIG.trafficInfo.defaultMode;
let hoveredTrafficInfo = null;
let selectedTrafficInfo = null;
let activePointerType = "mouse";
let isCanvasPointerDown = false;
let isCanvasDragging = false;
let lastPointerClientX = 0;
let lastPointerClientY = 0;
let activeSearchAbortController = null;
let searchRequestId = 0;
let currentSearchResults = [];
let cameraMoveAnimation = null;

regionalTextureLoader.setCrossOrigin("anonymous");

syncValue.textContent = "PCの現在時刻と同期中";
clockValue.textContent = "--";
flightStatusValue.textContent = "表示オフ";
shipStatusValue.textContent = "表示オフ";
locationLogStatusValue.textContent = "Waiting to load";
mapStyleValue.textContent = "地形";
searchStatusValue.textContent = "日本語でも検索できます。Enter で座標へ移動します。";
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
    clearTrafficInfoState("flight");
    updateFlightToggleUI();
    return;
  }

  flightsVisible = true;
  updateFlightToggleUI();
  loadFlightSnapshot();
});

shipButton.addEventListener("click", () => {
  if (isLoadingShips) {
    return;
  }

  if (shipsVisible) {
    shipsVisible = false;
    shipRequestId += 1;
    activeShipAbortController?.abort();
    activeShipAbortController = null;
    clearShipMarkers();
    setShipStatus("表示オフ");
    clearTrafficInfoState("ship");
    updateShipToggleUI();
    return;
  }

  shipsVisible = true;
  updateShipToggleUI();
  loadShipSnapshot();
});

mapStyleButton.addEventListener("click", () => {
  mapStyleMode = mapStyleMode === "terrain" ? "simplified" : "terrain";
  updateMapStyleUI();
  applyMapStyleMode();
});

trafficInfoModeButton.addEventListener("click", () => {
  trafficInfoMode = trafficInfoMode === "detail" ? "simple" : "detail";
  updateTrafficInfoModeUI();
  refreshTrafficTooltip();
});

resetButton.addEventListener("click", () => {
  cancelCameraMoveAnimation();
  controls.reset();
});

locationSearchForm.addEventListener("submit", handleLocationSearchSubmit);
searchResults.addEventListener("click", handleSearchResultClick);

canvas.addEventListener("pointerdown", handleCanvasPointerDown);
canvas.addEventListener("pointermove", handleCanvasPointerMove);
canvas.addEventListener("pointerup", handleCanvasPointerUp);
canvas.addEventListener("pointercancel", handleCanvasPointerCancel);
canvas.addEventListener("pointerleave", handleCanvasPointerLeave);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(
    Math.min(window.devicePixelRatio, APP_CONFIG.renderer.maxPixelRatio)
  );
  refreshTrafficTooltip();
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

  shipLayer = new THREE.Group();
  surfaceGroup.add(shipLayer);

  locationLogLayer = new THREE.Group();
  surfaceGroup.add(locationLogLayer);

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
  updateShipToggleUI();
  updateMapStyleUI();
  applyMapStyleMode();
  await loadLocationLogMarkers();
  updateTrafficInfoModeUI();
  setSearchStatus(searchStatusValue.textContent);
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
    updateCameraMoveAnimation();
    updateTrafficMarkerScale();
    updateViewedLocation();
    renderer.render(scene, camera);
  });
}

function updateControlSensitivity() {
  const distance = camera.position.distanceTo(controls.target);
  const rampSpan = Math.max(
    APP_CONFIG.controls.precisionRampDistance - controls.minDistance,
    0.0001
  );
  const rampRatio = smooth01(
    (distance - controls.minDistance) / rampSpan
  );
  const rotateRampRatio = Math.pow(
    rampRatio,
    APP_CONFIG.controls.rotatePrecisionExponent
  );
  const inputRotateFactor = getInputRotateFactor(rampRatio);
  const viewportRotateFactor = getViewportRotateFactor();

  controls.rotateSpeed = THREE.MathUtils.lerp(
    APP_CONFIG.controls.closeRotateSpeed,
    APP_CONFIG.controls.rotateSpeed,
    rotateRampRatio
  );
  controls.rotateSpeed *= inputRotateFactor * viewportRotateFactor;
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

  const targetFov = THREE.MathUtils.lerp(
    APP_CONFIG.camera.closeFov,
    APP_CONFIG.camera.fov,
    rampRatio
  );
  if (Math.abs(camera.fov - targetFov) > 0.001) {
    camera.fov = targetFov;
    camera.updateProjectionMatrix();
  }
}

function getInputRotateFactor(rampRatio) {
  if (activePointerType === "touch") {
    return THREE.MathUtils.lerp(
      APP_CONFIG.controls.closeTouchRotateFactor,
      APP_CONFIG.controls.touchRotateFactor,
      rampRatio
    );
  }

  if (activePointerType === "pen") {
    return APP_CONFIG.controls.penRotateFactor;
  }

  return 1;
}

function getViewportRotateFactor() {
  if (activePointerType !== "touch") {
    return 1;
  }

  const referenceHeight = Math.max(APP_CONFIG.controls.touchReferenceHeight, 1);
  const viewportHeight = Math.max(canvas.clientHeight || window.innerHeight, 1);

  return THREE.MathUtils.clamp(
    viewportHeight / referenceHeight,
    APP_CONFIG.controls.touchMinViewportFactor,
    1
  );
}

function clearControlMotion() {
  controls._sphericalDelta?.set(0, 0, 0);
  controls._panOffset?.set(0, 0, 0);
  controls._scale = 1;
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

  if (camera.position.lengthSq() <= 0) {
    currentViewedLatitude = null;
    currentViewedLongitude = null;
    setCoordinateLabels("--", "--");
    updateDetailFocus(null);
    return;
  }

  surfaceGroup.updateWorldMatrix(true, false);
  viewedWorldPoint
    .copy(camera.position)
    .sub(controls.target)
    .normalize();
  viewedLocalPoint.copy(viewedWorldPoint);
  surfaceGroup.worldToLocal(viewedLocalPoint);
  viewedLocalPoint.normalize();

  const latitude = THREE.MathUtils.radToDeg(Math.asin(viewedLocalPoint.y));
  const longitude = normalizeLongitude(
    THREE.MathUtils.radToDeg(
      Math.atan2(-viewedLocalPoint.z, viewedLocalPoint.x)
    )
  );
  currentViewedLatitude = latitude;
  currentViewedLongitude = longitude;

  setCoordinateLabels(formatLatitude(latitude), formatLongitude(longitude));
  updateDetailFocus({ point: viewedWorldPoint }, latitude, longitude);
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

function updateShipToggleUI() {
  shipButton.disabled = isLoadingShips || !shipLayer || !earthMesh;
  shipButton.textContent = isLoadingShips
    ? "船舶を読込中..."
    : shipsVisible
      ? "船舶を非表示"
      : "船舶を表示";
}

function updateMapStyleUI() {
  const isSimplified = mapStyleMode === "simplified";
  mapStyleButton.textContent = isSimplified
    ? "地形表示に戻す"
    : "簡略地図を表示";
  mapStyleValue.textContent = isSimplified ? "簡略地図" : "地形";
}

function applyMapStyleMode() {
  if (!earthMaterial) {
    return;
  }

  earthMaterial.uniforms.mapModeMix.value =
    mapStyleMode === "simplified" ? 1 : 0;
  discardRegionalTexture();

  if (
    Number.isFinite(currentViewedLatitude) &&
    Number.isFinite(currentViewedLongitude)
  ) {
    updateRegionalTexture(currentViewedLatitude, currentViewedLongitude);
    earthMaterial.uniforms.hiResMix.value = activeRegionalTexture
      ? getRegionalTextureStrength()
      : 0;
  }
}

function updateTrafficInfoModeUI() {
  trafficInfoModeButton.textContent = `情報表示: ${
    trafficInfoMode === "detail" ? "詳細" : "簡易"
  }`;
}

function setFlightStatus(text) {
  if (text === lastFlightStatusText) {
    return;
  }

  lastFlightStatusText = text;
  flightStatusValue.textContent = text;
}

function setShipStatus(text) {
  if (text === lastShipStatusText) {
    return;
  }

  lastShipStatusText = text;
  shipStatusValue.textContent = text;
}

function setLocationLogStatus(text) {
  if (text === lastLocationLogStatusText) {
    return;
  }

  lastLocationLogStatusText = text;
  locationLogStatusValue.textContent = text;
}

function setSearchStatus(text) {
  if (text === lastSearchStatusText) {
    return;
  }

  lastSearchStatusText = text;
  searchStatusValue.textContent = text;
}

function handleCanvasPointerDown(event) {
  activePointerType = event.pointerType || "mouse";
  isCanvasPointerDown = true;
  isCanvasDragging = false;
  pointerDownPoint.set(event.clientX, event.clientY);
  lastPointerClientX = event.clientX;
  lastPointerClientY = event.clientY;
  updatePointer(event.clientX, event.clientY);
  cancelCameraMoveAnimation();
}

function handleCanvasPointerMove(event) {
  activePointerType = event.pointerType || activePointerType;
  lastPointerClientX = event.clientX;
  lastPointerClientY = event.clientY;

  if (
    (!flightsVisible || !flightPoints) &&
    (!shipsVisible || !shipPoints)
  ) {
    clearHoveredTrafficInfo();
    return;
  }

  updatePointer(event.clientX, event.clientY);

  if (
    isCanvasPointerDown &&
    !isCanvasDragging &&
    Math.hypot(
      event.clientX - pointerDownPoint.x,
      event.clientY - pointerDownPoint.y
    ) >= APP_CONFIG.trafficInfo.dragThreshold
  ) {
    isCanvasDragging = true;
  }

  const trafficInfo = findTrafficAtPointer();

  if (activePointerType === "mouse") {
    hoveredTrafficInfo = trafficInfo;
    refreshTrafficTooltip(event.clientX, event.clientY);
    return;
  }

  if (isCanvasDragging) {
    hoveredTrafficInfo = trafficInfo;
    refreshTrafficTooltip(event.clientX, event.clientY);
    return;
  }

  if (!selectedTrafficInfo) {
    hoveredTrafficInfo = null;
    hideFlightTooltip();
    return;
  }

  refreshTrafficTooltip(event.clientX, event.clientY);
}

function handleCanvasPointerUp(event) {
  activePointerType = event.pointerType || activePointerType;
  lastPointerClientX = event.clientX;
  lastPointerClientY = event.clientY;
  updatePointer(event.clientX, event.clientY);

  const trafficInfo = findTrafficAtPointer();
  const endedDragging = isCanvasDragging;
  isCanvasPointerDown = false;
  isCanvasDragging = false;

  if (activePointerType === "mouse") {
    hoveredTrafficInfo = trafficInfo;
    refreshTrafficTooltip(event.clientX, event.clientY);
    return;
  }

  if (!endedDragging) {
    selectedTrafficInfo = trafficInfo;
    hoveredTrafficInfo = trafficInfo;
  } else {
    hoveredTrafficInfo = null;
  }

  if (!selectedTrafficInfo && !hoveredTrafficInfo) {
    hideFlightTooltip();
    return;
  }

  refreshTrafficTooltip(event.clientX, event.clientY);
}

function handleCanvasPointerCancel() {
  isCanvasPointerDown = false;
  isCanvasDragging = false;
  hoveredTrafficInfo = null;
  refreshTrafficTooltip();
}

function handleCanvasPointerLeave() {
  if (activePointerType !== "mouse") {
    hoveredTrafficInfo = null;
    refreshTrafficTooltip();
    return;
  }

  clearHoveredTrafficInfo();
}

function updatePointer(clientX, clientY) {
  pointer.x = (clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(clientY / window.innerHeight) * 2 + 1;
}

function refreshTrafficTooltip(clientX = lastPointerClientX, clientY = lastPointerClientY) {
  const trafficInfo = hoveredTrafficInfo ?? selectedTrafficInfo;

  if (!trafficInfo) {
    hideFlightTooltip();
    return;
  }

  const compactMode = shouldRenderCompactTrafficInfo();
  const anchored = shouldAnchorTrafficTooltip();
  const html = renderTrafficTooltip(trafficInfo, compactMode);
  const renderKey = `${trafficInfo.key}:${compactMode ? "compact" : "detail"}:${
    anchored ? "anchored" : "pointer"
  }`;

  if (hoveredTooltipKey !== renderKey) {
    hoveredTooltipKey = renderKey;
    flightTooltip.innerHTML = html;
  }

  flightTooltip.classList.toggle("is-compact", compactMode);
  flightTooltip.classList.toggle("is-anchored", anchored);

  if (anchored) {
    flightTooltip.style.left = "";
    flightTooltip.style.top = "";
  } else {
    positionFlightTooltip(clientX, clientY);
  }

  canvas.style.cursor = activePointerType === "mouse" ? "pointer" : "";
  flightTooltip.classList.add("is-visible");
}

function clearHoveredTrafficInfo() {
  hoveredTrafficInfo = null;
  refreshTrafficTooltip();
}

function clearTrafficInfoState(kind = null) {
  if (!kind) {
    hoveredTrafficInfo = null;
    selectedTrafficInfo = null;
    hideFlightTooltip();
    return;
  }

  if (hoveredTrafficInfo?.kind === kind) {
    hoveredTrafficInfo = null;
  }

  if (selectedTrafficInfo?.kind === kind) {
    selectedTrafficInfo = null;
  }

  refreshTrafficTooltip();
}

function shouldRenderCompactTrafficInfo() {
  return trafficInfoMode === "simple" || isCanvasDragging;
}

function shouldAnchorTrafficTooltip() {
  return compactTrafficMediaQuery.matches || activePointerType !== "mouse";
}

function findTrafficAtPointer() {
  return findHoveredFlight() ?? findHoveredShip();
}

function findHoveredFlight() {
  if (!flightPoints) {
    return null;
  }

  const intersection = findHoveredDirectionalMarker(flightPoints, 0.02, 0.04);
  const record =
    intersection?.index != null
      ? flightPoints.userData.records?.[intersection.index]
      : null;

  if (!record) {
    return null;
  }

  return {
    kind: "flight",
    record,
    key: `flight:${intersection.index}`,
  };
}

function findHoveredShip() {
  if (!shipPoints) {
    return null;
  }

  const intersection = findHoveredDirectionalMarker(shipPoints, 0.018, 0.034);
  const record =
    intersection?.index != null
      ? shipPoints.userData.records?.[intersection.index]
      : null;

  if (!record) {
    return null;
  }

  return {
    kind: "ship",
    record,
    key: `ship:${intersection.index}`,
  };
}

function findHoveredDirectionalMarker(points, minThreshold, maxThreshold) {
  raycaster.params.Points.threshold = THREE.MathUtils.lerp(
    minThreshold,
    maxThreshold,
    smooth01(
      (camera.position.distanceTo(controls.target) - controls.minDistance) /
        (4.9 - controls.minDistance)
    )
  );
  raycaster.setFromCamera(pointer, camera);

  const [intersection] = raycaster.intersectObject(points, false);
  return intersection ?? null;
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
  hoveredTooltipKey = "";
  canvas.style.cursor = "";
  flightTooltip.classList.remove("is-anchored", "is-compact");
  flightTooltip.classList.remove("is-visible");
}

async function loadLocationLogMarkers() {
  if (!locationLogLayer) {
    return;
  }

  setLocationLogStatus("Loading shared log...");
  clearLocationLogMarkers();

  try {
    const response = await fetch(APP_CONFIG.locationLog.snapshotUrl, {
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || data.ok === false) {
      throw new Error(
        data.message || "Location log request failed: " + response.status
      );
    }

    const records = Array.isArray(data.records) ? data.records : [];
    const markerCount = populateLocationLogMarkers(records);
    const invalidLineCount = Number.isFinite(data.invalidLineCount)
      ? data.invalidLineCount
      : 0;

    if (markerCount <= 0) {
      setLocationLogStatus(
        invalidLineCount > 0
          ? `No valid coordinates / invalid ${invalidLineCount} lines`
          : "No location records"
      );
      return;
    }

    const latestRecord = records[records.length - 1];
    const suffix = invalidLineCount > 0 ? ` / invalid ${invalidLineCount} lines` : "";
    setLocationLogStatus(
      latestRecord?.dateText
        ? `${markerCount} markers / latest ${latestRecord.dateText}${suffix}`
        : `${markerCount} markers${suffix}`
    );

    focusCameraOnLocationLogRecords(records);
  } catch (error) {
    console.error(error);
    clearLocationLogMarkers();
    setLocationLogStatus("Shared log load failed");
  }
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

async function loadShipSnapshot() {
  if (!shipLayer) {
    shipsVisible = false;
    updateShipToggleUI();
    return;
  }

  const requestId = ++shipRequestId;
  isLoadingShips = true;
  activeShipAbortController = new AbortController();
  clearShipMarkers();
  setShipStatus("全世界の船舶 AIS を読込中...");
  updateShipToggleUI();

  try {
    const response = await fetch(APP_CONFIG.ships.snapshotUrl, {
      cache: "no-store",
      signal: activeShipAbortController.signal,
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || data.ok === false) {
      throw new Error(data.message || `Ship snapshot failed: ${response.status}`);
    }

    if (requestId !== shipRequestId || !shipsVisible) {
      return;
    }

    const shipCount = populateShipMarkers(data.records ?? []);
    const snapshotDate =
      typeof data.sampledAt === "string" ? new Date(data.sampledAt) : new Date();

    if (shipCount <= 0) {
      shipsVisible = false;
      setShipStatus("受信できた船舶がありませんでした");
      return;
    }

    setShipStatus(
      `AIS の最新受信 ${shipCount.toLocaleString("ja-JP")} 隻を表示中 (${formatFlightSnapshotTime(snapshotDate)})`
    );
  } catch (error) {
    if (error.name === "AbortError" || requestId !== shipRequestId) {
      return;
    }

    if (!error.message?.includes("AISSTREAM_API_KEY")) {
      console.error(error);
    }
    shipsVisible = false;
    clearShipMarkers();
    setShipStatus(
      error.message?.includes("AISSTREAM_API_KEY")
        ? "AISSTREAM_API_KEY がサーバーに未設定です"
        : "船舶データの取得に失敗"
    );
  } finally {
    if (requestId === shipRequestId) {
      activeShipAbortController = null;
      isLoadingShips = false;
      updateShipToggleUI();
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
    getSurfaceTrackVector(latitude, longitude, track, flightDirectionVector);

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
  updateTrafficMarkerScale();

  return airborneStates.length;
}

function clearFlightMarkers() {
  if (!flightPoints || !flightLayer) {
    return;
  }

  flightLayer.remove(flightPoints);
  clearTrafficInfoState("flight");
  flightPoints.geometry.dispose();
  flightPoints = null;
}

function populateShipMarkers(records) {
  if (!shipLayer) {
    return 0;
  }

  const visibleRecords = records.filter(
    (record) =>
      Number.isFinite(record?.latitude) && Number.isFinite(record?.longitude)
  );

  if (visibleRecords.length <= 0) {
    clearShipMarkers();
    return 0;
  }

  const positions = new Float32Array(visibleRecords.length * 3);
  const directions = new Float32Array(visibleRecords.length * 3);

  visibleRecords.forEach((record, index) => {
    const heading = Number.isFinite(record.heading)
      ? record.heading
      : Number.isFinite(record.course)
        ? record.course
        : 0;

    latLonToSurfaceVector(
      record.latitude,
      record.longitude,
      flightMarkerVector
    ).multiplyScalar(APP_CONFIG.ships.markerBaseRadius);
    getSurfaceTrackVector(
      record.latitude,
      record.longitude,
      heading,
      flightDirectionVector
    );

    const positionIndex = index * 3;
    positions[positionIndex] = flightMarkerVector.x;
    positions[positionIndex + 1] = flightMarkerVector.y;
    positions[positionIndex + 2] = flightMarkerVector.z;
    directions[positionIndex] = flightDirectionVector.x;
    directions[positionIndex + 1] = flightDirectionVector.y;
    directions[positionIndex + 2] = flightDirectionVector.z;
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("direction", new THREE.BufferAttribute(directions, 3));
  geometry.computeBoundingSphere();

  clearShipMarkers();

  shipPoints = new THREE.Points(geometry, getShipMarkerMaterial());
  shipPoints.userData.records = visibleRecords;
  shipLayer.add(shipPoints);
  updateTrafficMarkerScale();

  return visibleRecords.length;
}

function clearShipMarkers() {
  if (!shipPoints || !shipLayer) {
    return;
  }

  shipLayer.remove(shipPoints);
  clearTrafficInfoState("ship");
  shipPoints.geometry.dispose();
  shipPoints = null;
}

function populateLocationLogMarkers(records) {
  if (!locationLogLayer) {
    return 0;
  }

  const visibleRecords = records.filter(
    (record) =>
      Number.isFinite(record?.latitude) && Number.isFinite(record?.longitude)
  );

  if (visibleRecords.length <= 0) {
    clearLocationLogMarkers();
    return 0;
  }

  const historyRecords = visibleRecords.slice(0, -1);
  const latestRecord = visibleRecords[visibleRecords.length - 1];
  const historyPositions = new Float32Array(historyRecords.length * 3);
  const trailPositions = new Float32Array(visibleRecords.length * 3);

  historyRecords.forEach((record, index) => {
    latLonToSurfaceVector(
      record.latitude,
      record.longitude,
      flightMarkerVector
    ).multiplyScalar(APP_CONFIG.locationLog.markerBaseRadius);

    const positionIndex = index * 3;
    historyPositions[positionIndex] = flightMarkerVector.x;
    historyPositions[positionIndex + 1] = flightMarkerVector.y;
    historyPositions[positionIndex + 2] = flightMarkerVector.z;
  });

  visibleRecords.forEach((record, index) => {
    latLonToSurfaceVector(
      record.latitude,
      record.longitude,
      flightMarkerVector
    ).multiplyScalar(APP_CONFIG.locationLog.trailRadius);

    const positionIndex = index * 3;
    trailPositions[positionIndex] = flightMarkerVector.x;
    trailPositions[positionIndex + 1] = flightMarkerVector.y;
    trailPositions[positionIndex + 2] = flightMarkerVector.z;
  });

  clearLocationLogMarkers();

  if (visibleRecords.length > 1) {
    const trailGeometry = new THREE.BufferGeometry();
    trailGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(trailPositions, 3)
    );
    trailGeometry.computeBoundingSphere();

    locationLogTrailLine = new THREE.Line(
      trailGeometry,
      getLocationLogTrailMaterial()
    );
    locationLogLayer.add(locationLogTrailLine);
  }

  if (historyRecords.length > 0) {
    const historyGeometry = new THREE.BufferGeometry();
    historyGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(historyPositions, 3)
    );
    historyGeometry.computeBoundingSphere();

    locationLogPoints = new THREE.Points(
      historyGeometry,
      getLocationLogMarkerMaterial()
    );
    locationLogPoints.userData.records = historyRecords;
    locationLogLayer.add(locationLogPoints);
  }

  if (latestRecord) {
    latLonToSurfaceVector(
      latestRecord.latitude,
      latestRecord.longitude,
      flightMarkerVector
    ).multiplyScalar(APP_CONFIG.locationLog.markerBaseRadius);

    const latestGeometry = new THREE.BufferGeometry();
    latestGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(
        new Float32Array([
          flightMarkerVector.x,
          flightMarkerVector.y,
          flightMarkerVector.z,
        ]),
        3
      )
    );
    latestGeometry.computeBoundingSphere();

    locationLogLatestPoint = new THREE.Points(
      latestGeometry,
      getLocationLogLatestMarkerMaterial()
    );
    locationLogLatestPoint.userData.record = latestRecord;
    locationLogLayer.add(locationLogLatestPoint);
  }

  updateTrafficMarkerScale();

  return visibleRecords.length;
}

function clearLocationLogMarkers() {
  if (locationLogTrailLine && locationLogLayer) {
    locationLogLayer.remove(locationLogTrailLine);
    locationLogTrailLine.geometry.dispose();
    locationLogTrailLine = null;
  }

  if (locationLogPoints && locationLogLayer) {
    locationLogLayer.remove(locationLogPoints);
    locationLogPoints.geometry.dispose();
    locationLogPoints = null;
  }

  if (locationLogLatestPoint && locationLogLayer) {
    locationLogLayer.remove(locationLogLatestPoint);
    locationLogLatestPoint.geometry.dispose();
    locationLogLatestPoint = null;
  }
}

function getLocationLogTrailMaterial() {
  if (!locationLogTrailMaterial) {
    locationLogTrailMaterial = new THREE.LineBasicMaterial({
      color: 0x82f4e1,
      depthWrite: false,
      transparent: true,
      opacity: APP_CONFIG.locationLog.trailOpacity,
    });
  }

  return locationLogTrailMaterial;
}

function getFlightMarkerMaterial() {
  if (!flightPointsMaterial) {
    flightPointsMaterial = createDirectionalMarkerMaterial(
      createFlightMarkerTexture(),
      APP_CONFIG.flights.markerMaxSize
    );
  }

  return flightPointsMaterial;
}

function getShipMarkerMaterial() {
  if (!shipPointsMaterial) {
    shipPointsMaterial = createDirectionalMarkerMaterial(
      createShipMarkerTexture(),
      APP_CONFIG.ships.markerMaxSize
    );
  }

  return shipPointsMaterial;
}

function getLocationLogMarkerMaterial() {
  if (!locationLogPointsMaterial) {
    locationLogPointsMaterial = createStaticMarkerMaterial(
      createLocationLogHistoryMarkerTexture(),
      APP_CONFIG.locationLog.markerMaxSize,
      {
        maxScreenSize: APP_CONFIG.locationLog.markerMaxScreenSize,
        minScreenSize: APP_CONFIG.locationLog.markerMinScreenSize,
      }
    );
  }

  return locationLogPointsMaterial;
}

function getLocationLogLatestMarkerMaterial() {
  if (!locationLogLatestPointMaterial) {
    locationLogLatestPointMaterial = createStaticMarkerMaterial(
      createLocationLogLatestMarkerTexture(),
      APP_CONFIG.locationLog.latestMarkerMaxSize,
      {
        maxScreenSize: APP_CONFIG.locationLog.latestMarkerMaxScreenSize,
        minScreenSize: APP_CONFIG.locationLog.latestMarkerMinScreenSize,
      }
    );
  }

  return locationLogLatestPointMaterial;
}

function createStaticMarkerMaterial(markerMap, markerSize, options = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      markerMap: { value: markerMap },
      markerSize: { value: markerSize },
      pointScale: { value: renderer.getPixelRatio() * window.innerHeight * 0.5 },
      maxScreenSize: { value: options.maxScreenSize ?? Infinity },
      minScreenSize: { value: options.minScreenSize ?? 0 },
    },
    vertexShader: `
      uniform float markerSize;
      uniform float pointScale;
      uniform float maxScreenSize;
      uniform float minScreenSize;

      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        float screenSize =
          markerSize * pointScale / max(-mvPosition.z, 0.0001);
        gl_PointSize = clamp(screenSize, minScreenSize, maxScreenSize);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform sampler2D markerMap;

      void main() {
        vec4 marker = texture2D(markerMap, gl_PointCoord);

        if (marker.a < 0.12) {
          discard;
        }

        gl_FragColor = marker;
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    blending: THREE.NormalBlending,
    depthWrite: false,
    depthTest: true,
  });
}

function createLocationLogHistoryMarkerTexture() {
  const size = 96;
  const markerCanvas = document.createElement("canvas");
  markerCanvas.width = size;
  markerCanvas.height = size;

  const context = markerCanvas.getContext("2d");
  context.clearRect(0, 0, size, size);
  context.translate(size / 2, size / 2);
  context.fillStyle = "rgba(84, 245, 221, 0.58)";

  context.beginPath();
  context.arc(0, 0, 9, 0, Math.PI * 2);
  context.fill();

  context.lineWidth = 2;
  context.strokeStyle = "rgba(202, 255, 246, 0.7)";
  context.beginPath();
  context.arc(0, 0, 12.5, 0, Math.PI * 2);
  context.stroke();

  const texture = new THREE.CanvasTexture(markerCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createLocationLogLatestMarkerTexture() {
  const size = 128;
  const markerCanvas = document.createElement("canvas");
  markerCanvas.width = size;
  markerCanvas.height = size;

  const context = markerCanvas.getContext("2d");
  context.clearRect(0, 0, size, size);
  context.translate(size / 2, size / 2);
  context.shadowColor = "rgba(112, 255, 231, 0.28)";
  context.shadowBlur = 12;

  const halo = context.createRadialGradient(0, 0, 6, 0, 0, 44);
  halo.addColorStop(0, "rgba(186, 255, 244, 0.48)");
  halo.addColorStop(0.35, "rgba(84, 245, 221, 0.2)");
  halo.addColorStop(1, "rgba(84, 245, 221, 0)");
  context.fillStyle = halo;
  context.beginPath();
  context.arc(0, 0, 44, 0, Math.PI * 2);
  context.fill();

  context.shadowBlur = 0;
  context.strokeStyle = "rgba(234, 255, 251, 0.92)";
  context.lineWidth = 6;
  context.beginPath();
  context.arc(0, 0, 28, 0, Math.PI * 2);
  context.stroke();

  context.strokeStyle = "rgba(112, 255, 231, 0.85)";
  context.lineWidth = 2.5;
  context.beginPath();
  context.arc(0, 0, 17, 0, Math.PI * 2);
  context.stroke();

  context.fillStyle = "rgba(244, 255, 252, 0.96)";
  context.beginPath();
  context.arc(0, 0, 6, 0, Math.PI * 2);
  context.fill();

  const texture = new THREE.CanvasTexture(markerCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createDirectionalMarkerMaterial(markerMap, markerSize) {
  return new THREE.ShaderMaterial({
    uniforms: {
      markerMap: { value: markerMap },
      markerSize: { value: markerSize },
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

function createShipMarkerTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext("2d");
  context.clearRect(0, 0, size, size);
  context.translate(size / 2, size / 2);
  context.shadowColor = "rgba(124, 227, 255, 0.4)";
  context.shadowBlur = 16;
  context.fillStyle = "rgba(227, 249, 255, 0.98)";
  context.strokeStyle = "rgba(67, 196, 255, 0.92)";
  context.lineWidth = 4;

  context.beginPath();
  context.moveTo(0, -52);
  context.lineTo(16, -14);
  context.lineTo(14, 26);
  context.lineTo(26, 42);
  context.lineTo(26, 52);
  context.lineTo(0, 60);
  context.lineTo(-26, 52);
  context.lineTo(-26, 42);
  context.lineTo(-14, 26);
  context.lineTo(-16, -14);
  context.closePath();
  context.fill();
  context.stroke();

  context.beginPath();
  context.moveTo(-6, -4);
  context.lineTo(6, -4);
  context.lineTo(10, 18);
  context.lineTo(-10, 18);
  context.closePath();
  context.fillStyle = "rgba(18, 67, 110, 0.78)";
  context.fill();

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

function renderTrafficTooltip(trafficInfo, compactMode) {
  if (compactMode) {
    return trafficInfo.kind === "flight"
      ? renderCompactFlightTooltip(trafficInfo.record)
      : renderCompactShipTooltip(trafficInfo.record);
  }

  return trafficInfo.kind === "flight"
    ? renderFlightTooltip(trafficInfo.record)
    : renderShipTooltip(trafficInfo.record);
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

function renderCompactFlightTooltip(record) {
  const title = record.callsign || record.icao24 || "UNKNOWN";
  const route = `${formatFlightCoordinate(record.latitude, true)} / ${formatFlightCoordinate(
    record.longitude,
    false
  )}`;

  return `
    <p class="flight-tooltip__eyebrow">航空機</p>
    <p class="flight-tooltip__title">${escapeHtml(title)}</p>
    <p class="flight-tooltip__meta">${escapeHtml(route)}</p>
    <div class="flight-tooltip__inline">
      <span>${escapeHtml(formatFlightHeading(record.track))}</span>
      <span>${escapeHtml(formatFlightSpeed(record.speed))}</span>
    </div>
  `;
}

function renderCompactShipTooltip(record) {
  const title = record.name || record.callsign || record.id || "UNKNOWN";
  const route = `${formatFlightCoordinate(record.latitude, true)} / ${formatFlightCoordinate(
    record.longitude,
    false
  )}`;

  return `
    <p class="flight-tooltip__eyebrow">船舶</p>
    <p class="flight-tooltip__title">${escapeHtml(title)}</p>
    <p class="flight-tooltip__meta">${escapeHtml(route)}</p>
    <div class="flight-tooltip__inline">
      <span>${escapeHtml(formatFlightHeading(record.heading ?? record.course))}</span>
      <span>${escapeHtml(formatShipSpeed(record.speedKnots))}</span>
    </div>
  `;
}

function renderShipTooltip(record) {
  const title = record.name || record.callsign || record.id || "UNKNOWN";
  const subtitle = record.callsign
    ? `${record.callsign} / MMSI ${record.id}`
    : `MMSI ${record.id}`;

  return `
    <p class="flight-tooltip__eyebrow">Live Vessel Snapshot</p>
    <p class="flight-tooltip__title">${escapeHtml(title)}</p>
    <p class="flight-tooltip__meta">${escapeHtml(subtitle)}</p>
    <div class="flight-tooltip__grid">
      ${renderFlightTooltipCell("緯度", formatFlightCoordinate(record.latitude, true))}
      ${renderFlightTooltipCell("経度", formatFlightCoordinate(record.longitude, false))}
      ${renderFlightTooltipCell("速力", formatShipSpeed(record.speedKnots))}
      ${renderFlightTooltipCell("進行方向", formatFlightHeading(record.heading))}
      ${renderFlightTooltipCell("船種", record.shipType || "--")}
      ${renderFlightTooltipCell("目的地", record.destination || "--")}
      ${renderFlightTooltipCell("最終受信", formatFlightContact(parseShipContact(record.lastUpdate)))}
      ${renderFlightTooltipCell("進路", formatFlightHeading(record.course))}
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

function getSurfaceTrackVector(latitude, longitude, track, target) {
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

function updateTrafficMarkerScale() {
  const distance = camera.position.distanceTo(controls.target);
  const distanceFactor = smooth01(
    (distance - controls.minDistance) / (4.9 - controls.minDistance)
  );

  updateDirectionalMarkerScale(
    flightPointsMaterial,
    APP_CONFIG.flights.markerMinSize,
    APP_CONFIG.flights.markerMaxSize,
    distanceFactor
  );
  updateDirectionalMarkerScale(
    shipPointsMaterial,
    APP_CONFIG.ships.markerMinSize,
    APP_CONFIG.ships.markerMaxSize,
    distanceFactor
  );
  updateDirectionalMarkerScale(
    locationLogPointsMaterial,
    APP_CONFIG.locationLog.markerMinSize,
    APP_CONFIG.locationLog.markerMaxSize,
    distanceFactor
  );
  updateDirectionalMarkerScale(
    locationLogLatestPointMaterial,
    APP_CONFIG.locationLog.latestMarkerMinSize,
    APP_CONFIG.locationLog.latestMarkerMaxSize,
    distanceFactor
  );
}

function updateDirectionalMarkerScale(material, minSize, maxSize, distanceFactor) {
  if (!material) {
    return;
  }

  material.uniforms.markerSize.value = THREE.MathUtils.lerp(
    minSize,
    maxSize,
    distanceFactor
  );
  material.uniforms.pointScale.value =
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

async function handleLocationSearchSubmit(event) {
  event.preventDefault();

  const query = locationSearchInput.value.trim();
  if (!query) {
    clearSearchResults();
    setSearchStatus("地域名・建物名・座標を入力してください。");
    return;
  }

  const coordinateMatch = parseCoordinateQuery(query);
  if (coordinateMatch) {
    activeSearchAbortController?.abort();
    clearSearchResults();
    moveCameraToLocation(coordinateMatch.latitude, coordinateMatch.longitude);
    setSearchStatus(
      `${formatLatitude(coordinateMatch.latitude)} / ${formatLongitude(
        coordinateMatch.longitude
      )} に移動しました。`
    );
    return;
  }

  const requestId = ++searchRequestId;
  activeSearchAbortController?.abort();
  activeSearchAbortController = new AbortController();
  locationSearchSubmit.disabled = true;
  setSearchStatus(`「${query}」を検索中...`);

  try {
    const results = await requestGeocodeResults(
      query,
      activeSearchAbortController.signal
    );

    if (requestId !== searchRequestId) {
      return;
    }

    renderSearchResults(results);

    if (results.length <= 0) {
      setSearchStatus(`「${query}」に一致する候補が見つかりませんでした。`);
      return;
    }

    moveCameraToLocation(results[0].latitude, results[0].longitude);
    setSearchStatus(
      `「${results[0].title}」へ移動しました。候補 ${results.length} 件から選び直せます。`
    );
  } catch (error) {
    if (error.name === "AbortError" || requestId !== searchRequestId) {
      return;
    }

    console.error(error);
    clearSearchResults();
    setSearchStatus("場所検索に失敗しました。時間をおいて再試行してください。");
  } finally {
    if (requestId === searchRequestId) {
      activeSearchAbortController = null;
      locationSearchSubmit.disabled = false;
    }
  }
}

async function requestGeocodeResults(query, signal) {
  const requestUrl = new URL(APP_CONFIG.search.geocodeUrl, window.location.origin);
  requestUrl.searchParams.set("q", query);
  requestUrl.searchParams.set("limit", String(APP_CONFIG.search.resultLimit));
  requestUrl.searchParams.set("lang", "ja,en");

  const response = await fetch(requestUrl, {
    cache: "no-store",
    signal,
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.ok === false) {
    throw new Error(data.message || `Geocode request failed: ${response.status}`);
  }

  return Array.isArray(data.results)
    ? data.results.filter(
        (result) =>
          Number.isFinite(result?.latitude) &&
          Number.isFinite(result?.longitude)
      )
    : [];
}

function handleSearchResultClick(event) {
  const button = event.target.closest("[data-search-index]");
  if (!button) {
    return;
  }

  const index = Number.parseInt(button.dataset.searchIndex ?? "", 10);
  const result = currentSearchResults[index];

  if (!result) {
    return;
  }

  moveCameraToLocation(result.latitude, result.longitude);
  setSearchStatus(`「${result.title}」へ移動しました。`);
}

function renderSearchResults(results) {
  currentSearchResults = results;

  if (results.length <= 0) {
    clearSearchResults();
    return;
  }

  searchResults.hidden = false;
  searchResults.innerHTML = results
    .map((result, index) => {
      const subtitle =
        result.subtitle && result.subtitle !== result.title
          ? result.subtitle
          : `${formatLatitude(result.latitude)} / ${formatLongitude(
              result.longitude
            )}`;

      return `
        <button
          type="button"
          class="search-result"
          data-search-index="${index}"
        >
          <span class="search-result__title">${escapeHtml(result.title)}</span>
          <span class="search-result__meta">${escapeHtml(subtitle)}</span>
        </button>
      `;
    })
    .join("");
}

function clearSearchResults() {
  currentSearchResults = [];
  searchResults.hidden = true;
  searchResults.innerHTML = "";
}

function focusCameraOnLocationLogRecords(records) {
  const visibleRecords = Array.isArray(records)
    ? records.filter(
        (record) =>
          Number.isFinite(record?.latitude) && Number.isFinite(record?.longitude)
      )
    : [];

  if (visibleRecords.length <= 0) {
    return;
  }

  const latestRecord = visibleRecords[visibleRecords.length - 1];
  if (visibleRecords.length === 1) {
    moveCameraToLocation(latestRecord.latitude, latestRecord.longitude, {
      distance: APP_CONFIG.locationLog.focusSingleDistance,
      durationMs: APP_CONFIG.locationLog.focusDurationMs,
    });
    return;
  }

  locationLogAggregateVector.set(0, 0, 0);

  visibleRecords.forEach((record) => {
    latLonToSurfaceVector(
      record.latitude,
      record.longitude,
      locationLogFocusVector
    );
    locationLogAggregateVector.add(locationLogFocusVector);
  });

  if (locationLogAggregateVector.lengthSq() <= 0.000001) {
    moveCameraToLocation(latestRecord.latitude, latestRecord.longitude, {
      distance: APP_CONFIG.locationLog.focusSingleDistance,
      durationMs: APP_CONFIG.locationLog.focusDurationMs,
    });
    return;
  }

  locationLogAggregateVector.normalize();

  let maxAngularDistance = 0;
  visibleRecords.forEach((record) => {
    latLonToSurfaceVector(
      record.latitude,
      record.longitude,
      locationLogFocusVector
    );
    maxAngularDistance = Math.max(
      maxAngularDistance,
      locationLogAggregateVector.angleTo(locationLogFocusVector)
    );
  });

  const verticalHalfFov = THREE.MathUtils.degToRad(camera.fov * 0.5);
  const horizontalHalfFov = Math.atan(
    Math.tan(verticalHalfFov) * camera.aspect
  );
  const usableHalfFov = Math.min(verticalHalfFov, horizontalHalfFov) * 0.78;
  const paddedAngularDistance = Math.min(
    maxAngularDistance +
      THREE.MathUtils.degToRad(APP_CONFIG.locationLog.focusPaddingDegrees),
    usableHalfFov * 0.94
  );
  const requiredDistance =
    paddedAngularDistance > 0.0001
      ? Math.cos(paddedAngularDistance) +
        Math.sin(paddedAngularDistance) / Math.tan(usableHalfFov)
      : APP_CONFIG.locationLog.focusSingleDistance;
  const targetDistance = THREE.MathUtils.clamp(
    requiredDistance,
    Math.max(APP_CONFIG.locationLog.focusMinDistance, controls.minDistance),
    APP_CONFIG.locationLog.focusMaxDistance
  );
  const targetCoordinates = surfaceVectorToLatLon(locationLogAggregateVector);

  moveCameraToLocation(targetCoordinates.latitude, targetCoordinates.longitude, {
    distance: targetDistance,
    durationMs: APP_CONFIG.locationLog.focusDurationMs,
  });
}

function moveCameraToLocation(latitude, longitude, options = {}) {
  clearControlMotion();

  const currentDistance = camera.position.distanceTo(controls.target);
  const targetDistance = THREE.MathUtils.clamp(
    options.distance ?? Math.min(currentDistance, APP_CONFIG.search.focusDistance),
    controls.minDistance,
    controls.maxDistance
  );
  const targetDirection = latLonToSurfaceVector(
    latitude,
    longitude,
    new THREE.Vector3()
  ).normalize();

  surfaceGroup.updateWorldMatrix(true, false);
  surfaceGroup.localToWorld(targetDirection);
  targetDirection.normalize();

  cameraMoveAnimation = {
    durationMs: options.durationMs ?? APP_CONFIG.search.moveDurationMs,
    fromDirection: camera.position.clone().sub(controls.target).normalize(),
    fromDistance: currentDistance,
    rotation: new THREE.Quaternion(),
    startTime: performance.now(),
    toDirection: targetDirection.clone(),
    toDistance: targetDistance,
  };
  cameraMoveAnimation.rotation.setFromUnitVectors(
    cameraMoveAnimation.fromDirection,
    cameraMoveAnimation.toDirection
  );

  selectedTrafficInfo = null;
  hoveredTrafficInfo = null;
  hideFlightTooltip();
}

function surfaceVectorToLatLon(vector) {
  const normalizedVector = vector.clone().normalize();

  return {
    latitude: THREE.MathUtils.radToDeg(Math.asin(normalizedVector.y)),
    longitude: normalizeLongitude(
      THREE.MathUtils.radToDeg(
        Math.atan2(-normalizedVector.z, normalizedVector.x)
      )
    ),
  };
}

function updateCameraMoveAnimation() {
  if (!cameraMoveAnimation) {
    return;
  }

  const elapsed = performance.now() - cameraMoveAnimation.startTime;
  const progress = smooth01(
    elapsed / Math.max(cameraMoveAnimation.durationMs, 1)
  );
  const distance = THREE.MathUtils.lerp(
    cameraMoveAnimation.fromDistance,
    cameraMoveAnimation.toDistance,
    progress
  );
  const direction = cameraMoveVector
    .copy(cameraMoveAnimation.fromDirection)
    .applyQuaternion(
      cameraMoveQuaternion
        .copy(identityQuaternion)
        .slerp(cameraMoveAnimation.rotation, progress)
    )
    .normalize();

  camera.position.copy(direction.multiplyScalar(distance).add(controls.target));

  if (progress >= 1) {
    camera.position.copy(
      cameraMoveVector
        .copy(cameraMoveAnimation.toDirection)
        .multiplyScalar(cameraMoveAnimation.toDistance)
        .add(controls.target)
    );
    clearControlMotion();
    cameraMoveAnimation = null;
  }
}

function cancelCameraMoveAnimation() {
  clearControlMotion();
  cameraMoveAnimation = null;
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

function getCurrentRegionalTextureStyle() {
  return (
    APP_CONFIG.regionalTexture.styles[mapStyleMode] ??
    APP_CONFIG.regionalTexture.styles.terrain
  );
}

function updateRegionalTexture(latitude, longitude) {
  const hiResStrength = getRegionalTextureStrength();
  const regionalStyle = getCurrentRegionalTextureStyle();

  if (hiResStrength <= 0) {
    discardRegionalTexture();
    return;
  }

  const requestBounds = buildRegionalBounds(
    latitude,
    longitude,
    hiResStrength,
    regionalStyle
  );

  if (!requestBounds) {
    discardRegionalTexture();
    return;
  }

  if (activeRegionalBounds?.key === requestBounds.key) {
    earthMaterial.uniforms.hiResMix.value = hiResStrength;
    return;
  }

  if (
    activeRegionalBounds &&
    isCurrentViewRelevantForBounds(activeRegionalBounds) &&
    isRegionalTextureDetailSufficient(activeRegionalBounds, requestBounds)
  ) {
    earthMaterial.uniforms.hiResMix.value = hiResStrength;
    return;
  }

  if (pendingRegionalKey === requestBounds.key) {
    return;
  }

  pendingRegionalKey = requestBounds.key;
  regionalRequestId += 1;
  const requestId = regionalRequestId;

  regionalTextureLoader.load(
    buildRegionalTextureUrl(requestBounds, regionalStyle),
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

      if (activeRegionalTexture) {
        activeRegionalTexture.dispose();
      }

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
      earthMaterial.uniforms.hiResOpacity.value = regionalStyle.opacity;
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
    earthMaterial.uniforms.hiResOpacity.value = 0;
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
  earthMaterial.uniforms.hiResOpacity.value = 0;
}

function buildRegionalBounds(latitude, longitude, hiResStrength, regionalStyle) {
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
    APP_CONFIG.regionalTexture.minSnapStep
  );
  const longitudeStep = Math.max(
    lonRadius * APP_CONFIG.regionalTexture.snapRatio,
    APP_CONFIG.regionalTexture.minSnapStep
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

  if (
    east - west < APP_CONFIG.regionalTexture.minSpan ||
    north - south < APP_CONFIG.regionalTexture.minSpan
  ) {
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
    styleKey: regionalStyle.layer,
    key: [regionalStyle.layer, centerLatitude, centerLongitude, latRadius, lonRadius]
      .map((value) =>
        typeof value === "number" ? value.toFixed(2) : String(value)
      )
      .join(":"),
  };
}

function buildRegionalTextureUrl(bounds, regionalStyle) {
  const params = new URLSearchParams({
    SERVICE: "WMS",
    REQUEST: "GetMap",
    VERSION: "1.1.1",
    SRS: "EPSG:4326",
    LAYERS: regionalStyle.layer,
    STYLES: "",
    BBOX: `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`,
    WIDTH: String(APP_CONFIG.regionalTexture.requestSize),
    HEIGHT: String(APP_CONFIG.regionalTexture.requestSize),
    FORMAT: regionalStyle.format,
    TRANSPARENT: regionalStyle.transparent ? "TRUE" : "FALSE",
  });

  return `${regionalStyle.url}?${params.toString()}`;
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

function isRegionalTextureDetailSufficient(activeBounds, requestBounds) {
  if (!activeBounds || !requestBounds) {
    return false;
  }

  return (
    activeBounds.styleKey === requestBounds.styleKey &&
    activeBounds.latRadius <= requestBounds.latRadius + 0.0001 &&
    activeBounds.lonRadius <= requestBounds.lonRadius + 0.0001
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
        cameraFov: Number(camera.fov.toFixed(3)),
        controlRotateSpeed: Number(controls.rotateSpeed.toFixed(4)),
        controlZoomSpeed: Number(controls.zoomSpeed.toFixed(4)),
        controlPointerType: activePointerType,
        detailStrength: earthMaterial
          ? Number(earthMaterial.uniforms.detailStrength.value.toFixed(4))
          : 0,
        hiResMix: earthMaterial
          ? Number(earthMaterial.uniforms.hiResMix.value.toFixed(4))
          : 0,
        hiResOpacity: earthMaterial
          ? Number(earthMaterial.uniforms.hiResOpacity.value.toFixed(4))
          : 0,
        hasRegionalTexture: Boolean(activeRegionalTexture),
        activeRegionalKey: activeRegionalBounds?.key ?? null,
        pendingRegionalKey: pendingRegionalKey || null,
        mapStyleMode,
        cameraMoveActive: Boolean(cameraMoveAnimation),
        flightsVisible,
        flightStatus: lastFlightStatusText,
        flightMarkers: flightPoints?.geometry?.attributes?.position?.count ?? 0,
        shipMarkers: shipPoints?.geometry?.attributes?.position?.count ?? 0,
        locationLogMarkers:
          (locationLogPoints?.geometry?.attributes?.position?.count ?? 0) +
          (locationLogLatestPoint?.geometry?.attributes?.position?.count ?? 0),
        locationLogStatus: lastLocationLogStatusText,
        latitude: currentViewedLatitude,
        longitude: currentViewedLongitude,
        cameraPosition: [
          Number(camera.position.x.toFixed(6)),
          Number(camera.position.y.toFixed(6)),
          Number(camera.position.z.toFixed(6)),
        ],
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
    projectLatLon(latitude, longitude) {
      const worldPoint = latLonToSurfaceVector(
        latitude,
        longitude,
        new THREE.Vector3()
      ).normalize();
      surfaceGroup.updateWorldMatrix(true, false);
      surfaceGroup.localToWorld(worldPoint);
      worldPoint.normalize();
      return [
        Number(worldPoint.x.toFixed(6)),
        Number(worldPoint.y.toFixed(6)),
        Number(worldPoint.z.toFixed(6)),
      ];
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

function parseCoordinateQuery(query) {
  const normalized = query
    .trim()
    .replaceAll("、", ",")
    .replaceAll("，", ",")
    .replace(/\s+/gu, " ");
  const tokens = normalized
    .split(/[,\s]+/u)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length !== 2) {
    return null;
  }

  const firstOrientation = detectCoordinateOrientation(tokens[0]);
  const secondOrientation = detectCoordinateOrientation(tokens[1]);
  const firstAsLatitude = parseCoordinateToken(tokens[0], "lat");
  const firstAsLongitude = parseCoordinateToken(tokens[0], "lon");
  const secondAsLatitude = parseCoordinateToken(tokens[1], "lat");
  const secondAsLongitude = parseCoordinateToken(tokens[1], "lon");

  if (
    (firstOrientation === "lat" || firstOrientation === null) &&
    (secondOrientation === "lon" || secondOrientation === null) &&
    Number.isFinite(firstAsLatitude) &&
    Number.isFinite(secondAsLongitude)
  ) {
    return {
      latitude: firstAsLatitude,
      longitude: normalizeLongitude(secondAsLongitude),
    };
  }

  if (
    (firstOrientation === "lon" || firstOrientation === null) &&
    (secondOrientation === "lat" || secondOrientation === null) &&
    Number.isFinite(firstAsLongitude) &&
    Number.isFinite(secondAsLatitude)
  ) {
    return {
      latitude: secondAsLatitude,
      longitude: normalizeLongitude(firstAsLongitude),
    };
  }

  return null;
}

function detectCoordinateOrientation(token) {
  const normalized = token.toUpperCase();

  if (/[NS]/u.test(normalized)) {
    return "lat";
  }

  if (/[EW]/u.test(normalized)) {
    return "lon";
  }

  return null;
}

function parseCoordinateToken(token, orientation) {
  const normalized = token.toUpperCase().replaceAll("°", "").trim();
  const letterPattern = orientation === "lat" ? /[NS]/gu : /[EW]/gu;
  const signLetters =
    orientation === "lat"
      ? { negative: "S", positive: "N" }
      : { negative: "W", positive: "E" };
  const letters = normalized.match(letterPattern) ?? [];
  const signFromLetter = letters.some((letter) => letter === signLetters.negative)
    ? -1
    : letters.some((letter) => letter === signLetters.positive)
      ? 1
      : null;
  const numericValue = Number.parseFloat(normalized.replace(/[NSEW]/gu, ""));

  if (!Number.isFinite(numericValue)) {
    return null;
  }

  const signedValue =
    signFromLetter === null
      ? numericValue
      : Math.abs(numericValue) * signFromLetter;
  const limit = orientation === "lat" ? 90 : 180;

  if (Math.abs(signedValue) > limit) {
    return null;
  }

  return signedValue;
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

function formatShipSpeed(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }

  return `${value.toLocaleString("ja-JP", {
    maximumFractionDigits: 1,
  })} kn`;
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

function parseShipContact(value) {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }

  return null;
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
