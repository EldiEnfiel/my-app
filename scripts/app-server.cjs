const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const WebSocket = require("ws");

const projectRoot = path.resolve(__dirname, "..");
const sharedFilesRoot = path.resolve(projectRoot, "..", "shared-files");
const myLocationLogPath = path.join(sharedFilesRoot, "mylocation.log");
const defaultHost = "127.0.0.1";
const defaultPort = 4173;
const AISSTREAM_URL = process.env.AISSTREAM_URL || "wss://stream.aisstream.io/v0/stream";
const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
const worldBoundingBoxes = [[[-90, -180], [90, 180]]];
const shipMessageTypes = [
  "PositionReport",
  "StandardClassBPositionReport",
  "ExtendedClassBPositionReport",
  "ShipStaticData",
  "StaticDataReport",
];
const geocodeCache = new Map();
let geocodeQueue = Promise.resolve();
const shipCacheState = {
  activeApiKey: "",
  connection: null,
  connectedAt: 0,
  isStarting: false,
  isWarm: false,
  lastError: "",
  lastMessageAt: 0,
  pruneTimer: null,
  reconnectTimer: null,
  records: new Map(),
  startPromise: null,
  waiters: new Set(),
};

const mimeTypes = new Map([
  [".css", "text/css; charset=UTF-8"],
  [".cjs", "text/javascript; charset=UTF-8"],
  [".html", "text/html; charset=UTF-8"],
  [".ico", "image/x-icon"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".js", "text/javascript; charset=UTF-8"],
  [".json", "application/json; charset=UTF-8"],
  [".map", "application/json; charset=UTF-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=UTF-8"],
]);

function parseArguments(argv) {
  const options = {
    host: defaultHost,
    openBrowserOnStart: false,
    port: defaultPort,
    useNextAvailablePort: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    switch (value) {
      case "--host":
        options.host = argv[index + 1] ?? options.host;
        index += 1;
        break;
      case "--port":
        options.port = Number.parseInt(argv[index + 1] ?? options.port, 10);
        index += 1;
        break;
      case "--next-available":
        options.useNextAvailablePort = true;
        break;
      case "--open":
        options.openBrowserOnStart = true;
        break;
      default:
        break;
    }
  }

  return options;
}

function loadEnvironmentFiles(rootDir) {
  const envFileNames = [
    ".env",
    ".env.local",
    ".env.production",
    ".env.production.local",
  ];
  const loadedValues = {};

  for (const fileName of envFileNames) {
    const filePath = path.join(rootDir, fileName);

    if (!fs.existsSync(filePath)) {
      continue;
    }

    const content = fs.readFileSync(filePath, "utf8");
    Object.assign(loadedValues, parseEnvFile(content));
  }

  for (const [key, value] of Object.entries(loadedValues)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function parseEnvFile(content) {
  const values = {};

  const normalizedContent = String(content).replace(/^\uFEFF/u, "");

  for (const rawLine of normalizedContent.split(/\r?\n/u)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    let value = rawValue.trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}

function resolveFilePath(requestPathname) {
  const decodedPath = decodeURIComponent(requestPathname);
  const normalizedPath = path
    .normalize(decodedPath)
    .replace(/^[/\\]+/u, "")
    .replace(/^(\.\.[/\\])+/u, "");
  let resolvedPath = path.join(projectRoot, normalizedPath);

  if (resolvedPath.endsWith(path.sep)) {
    resolvedPath = path.join(resolvedPath, "index.html");
  }

  if (!resolvedPath.startsWith(projectRoot)) {
    return null;
  }

  return resolvedPath;
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-cache",
    "Content-Type": "application/json; charset=UTF-8",
  });
  response.end(JSON.stringify(payload));
}

async function serveStaticFile(requestPathname, response) {
  const targetPath = requestPathname === "/" ? "/index.html" : requestPathname;
  let filePath = resolveFilePath(targetPath);

  if (!filePath) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=UTF-8" });
    response.end("Forbidden");
    return;
  }

  try {
    const stats = await fs.promises.stat(filePath);

    if (stats.isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }

    const extension = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes.get(extension) || "application/octet-stream";

    response.writeHead(200, {
      "Cache-Control": "no-cache",
      "Content-Type": contentType,
    });

    fs.createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=UTF-8" });
    response.end("Not Found");
  }
}

function parseLocationLogDate(dateText) {
  const match = String(dateText || "").match(
    /^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})$/u
  );

  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute] = match;
  const parsedDate = new Date(
    Number.parseInt(year, 10),
    Number.parseInt(month, 10) - 1,
    Number.parseInt(day, 10),
    Number.parseInt(hour, 10),
    Number.parseInt(minute, 10),
    0,
    0
  );

  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

function parseLocationLogEntries(content) {
  const records = [];
  let invalidLineCount = 0;

  for (const [index, rawLine] of content.split(/\r?\n/u).entries()) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    const match = line.match(
      /^(\d{4}\/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2})(?:\s+|\t+)([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)$/u
    );

    if (!match) {
      invalidLineCount += 1;
      continue;
    }

    const [, dateText, latitudeText, longitudeText] = match;
    const latitude = Number.parseFloat(latitudeText);
    const longitude = Number.parseFloat(longitudeText);

    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      invalidLineCount += 1;
      continue;
    }

    const parsedDate = parseLocationLogDate(dateText);
    records.push({
      dateText,
      latitude,
      lineNumber: index + 1,
      longitude,
      timestampMs: parsedDate ? parsedDate.getTime() : null,
    });
  }

  records.sort((left, right) => {
    const leftTime = Number.isFinite(left.timestampMs) ? left.timestampMs : Infinity;
    const rightTime = Number.isFinite(right.timestampMs) ? right.timestampMs : Infinity;

    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }

    return left.lineNumber - right.lineNumber;
  });

  return { invalidLineCount, records };
}

async function handleMyLocationRequest(request, response) {
  if (!["GET", "HEAD"].includes(request.method ?? "GET")) {
    response.writeHead(405, {
      Allow: "GET, HEAD",
      "Content-Type": "text/plain; charset=UTF-8",
    });
    response.end("Method Not Allowed");
    return;
  }

  try {
    if (!fs.existsSync(myLocationLogPath)) {
      sendJson(response, 200, {
        ok: true,
        invalidLineCount: 0,
        message: "mylocation.log was not found.",
        recordCount: 0,
        records: [],
        source: "mylocation.log",
      });
      return;
    }

    const content = await fs.promises.readFile(myLocationLogPath, "utf8");
    const { invalidLineCount, records } = parseLocationLogEntries(content);

    sendJson(response, 200, {
      ok: true,
      invalidLineCount,
      message:
        records.length > 0
          ? "Location log records loaded."
          : "No valid latitude/longitude records were found in mylocation.log.",
      recordCount: records.length,
      records,
      source: "mylocation.log",
    });
  } catch (error) {
    sendJson(response, 500, {
      code: "MYLOCATION_LOG_READ_FAILED",
      message: error.message || "Failed to read mylocation.log.",
      ok: false,
    });
  }
}
async function handleShipSnapshotRequest(request, response) {
  if (!["GET", "HEAD"].includes(request.method ?? "GET")) {
    response.writeHead(405, {
      Allow: "GET, HEAD",
      "Content-Type": "text/plain; charset=UTF-8",
    });
    response.end("Method Not Allowed");
    return;
  }

  const apiKey = process.env.AISSTREAM_API_KEY;
  if (!apiKey) {
    sendJson(response, 200, {
      code: "SHIPS_NOT_CONFIGURED",
      message:
        "AISSTREAM_API_KEY is not configured on the server. Add it to .env.local or .env.production.",
      ok: false,
    });
    return;
  }

  try {
    const options = getShipCollectorOptions();
    ensureShipCacheCollector(apiKey, options);

    let snapshot = getShipCacheSnapshot(options);
    if (snapshot.records.length <= 0) {
      await waitForShipCacheWarmup(options.initialWaitMs);
      snapshot = getShipCacheSnapshot(options);
    }

    if (snapshot.records.length <= 0 && shipCacheState.lastError) {
      throw new Error(shipCacheState.lastError);
    }

    sendJson(response, 200, {
      ok: true,
      provider: "AISStream",
      collectionMode: "background-cache",
      cacheAgeMs: snapshot.cacheAgeMs,
      cacheTtlMs: options.cacheTtlMs,
      cachedRecordCount: snapshot.cachedRecordCount,
      connectedAt: snapshot.connectedAt,
      initialWaitMs: options.initialWaitMs,
      lastMessageAt: snapshot.lastMessageAt,
      recordCount: snapshot.records.length,
      responseMaxRecords: options.responseMaxRecords,
      sampledAt: snapshot.sampledAt,
      records: snapshot.records,
    });
  } catch (error) {
    sendJson(response, 502, {
      code: "SHIPS_REQUEST_FAILED",
      message: error.message || "Failed to collect ship positions.",
      ok: false,
    });
  }
}

async function handleGeocodeRequest(requestUrl, request, response) {
  if (!["GET", "HEAD"].includes(request.method ?? "GET")) {
    response.writeHead(405, {
      Allow: "GET, HEAD",
      "Content-Type": "text/plain; charset=UTF-8",
    });
    response.end("Method Not Allowed");
    return;
  }

  const query = String(requestUrl.searchParams.get("q") ?? "").trim();
  if (!query) {
    sendJson(response, 400, {
      code: "GEOCODE_QUERY_REQUIRED",
      message: "Specify q=<place name> or use direct coordinates on the client.",
      ok: false,
    });
    return;
  }

  const limit = clampInteger(
    requestUrl.searchParams.get("limit"),
    5,
    1,
    8
  );
  const acceptLanguage = sanitizeAcceptLanguage(
    requestUrl.searchParams.get("lang") || "ja,en"
  );
  const cacheKey = `${acceptLanguage}:${limit}:${query.toLowerCase()}`;
  const cachedPayload = getCachedGeocodePayload(cacheKey);

  if (cachedPayload) {
    sendJson(response, 200, cachedPayload);
    return;
  }

  try {
    const results = await queueGeocodeRequest(async () =>
      requestGeocodeResults({
        acceptLanguage,
        limit,
        query,
      })
    );
    const payload = {
      attribution: "Search data © OpenStreetMap contributors",
      ok: true,
      provider: "Nominatim",
      query,
      results,
    };

    setCachedGeocodePayload(cacheKey, payload);
    sendJson(response, 200, payload);
  } catch (error) {
    sendJson(response, 502, {
      code: "GEOCODE_REQUEST_FAILED",
      message: error.message || "Failed to resolve the place name.",
      ok: false,
    });
  }
}

function clampInteger(rawValue, fallback, min, max) {
  const parsed = Number.parseInt(rawValue ?? "", 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}

function getCachedGeocodePayload(cacheKey) {
  const cached = geocodeCache.get(cacheKey);

  if (!cached) {
    return null;
  }

  if (Date.now() > cached.expiresAt) {
    geocodeCache.delete(cacheKey);
    return null;
  }

  return cached.payload;
}

function setCachedGeocodePayload(cacheKey, payload) {
  geocodeCache.set(cacheKey, {
    expiresAt: Date.now() + 1000 * 60 * 60 * 6,
    payload,
  });

  if (geocodeCache.size <= 120) {
    return;
  }

  const oldestKey = geocodeCache.keys().next().value;
  if (oldestKey) {
    geocodeCache.delete(oldestKey);
  }
}

function queueGeocodeRequest(task) {
  const minIntervalMs = clampInteger(
    process.env.NOMINATIM_MIN_INTERVAL_MS,
    1200,
    1000,
    10000
  );

  geocodeQueue = geocodeQueue
    .catch(() => undefined)
    .then(async () => {
      const currentTime = Date.now();
      const lastAllowedAt = queueGeocodeRequest.lastAllowedAt ?? 0;
      const waitTime = Math.max(0, lastAllowedAt + minIntervalMs - currentTime);

      if (waitTime > 0) {
        await delay(waitTime);
      }

      queueGeocodeRequest.lastAllowedAt = Date.now();
      return task();
    });

  return geocodeQueue;
}

function delay(waitTime) {
  return new Promise((resolve) => {
    setTimeout(resolve, waitTime);
  });
}

function sanitizeAcceptLanguage(rawValue) {
  return String(rawValue || "ja,en")
    .replace(/[^A-Za-z0-9,\-;.= ]/gu, "")
    .trim()
    .slice(0, 64) || "ja,en";
}

async function requestGeocodeResults({ acceptLanguage, limit, query }) {
  const requestUrl = new URL(
    process.env.NOMINATIM_SEARCH_URL || NOMINATIM_SEARCH_URL
  );
  requestUrl.searchParams.set("q", query);
  requestUrl.searchParams.set("format", "jsonv2");
  requestUrl.searchParams.set("addressdetails", "1");
  requestUrl.searchParams.set("namedetails", "1");
  requestUrl.searchParams.set("limit", String(limit));
  requestUrl.searchParams.set("accept-language", acceptLanguage);

  if (process.env.NOMINATIM_EMAIL) {
    requestUrl.searchParams.set("email", process.env.NOMINATIM_EMAIL);
  }

  const headers = {
    "Accept-Language": acceptLanguage,
    "User-Agent":
      process.env.NOMINATIM_USER_AGENT ||
      "3D Earth Explorer/1.0 (+https://github.com/EldiEnfiel/my-app)",
  };

  const response = await fetch(requestUrl, {
    headers,
  });

  if (!response.ok) {
    throw new Error(`Nominatim request failed: ${response.status}`);
  }

  const data = await response.json();
  if (!Array.isArray(data)) {
    return [];
  }

  return data
    .map(normalizeGeocodeResult)
    .filter(Boolean)
    .sort(
      (left, right) =>
        Number(right.importance ?? 0) - Number(left.importance ?? 0)
    );
}

function normalizeGeocodeResult(result) {
  const latitude = Number.parseFloat(result?.lat);
  const longitude = Number.parseFloat(result?.lon);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  const namedetails = result.namedetails ?? {};
  const address = result.address ?? {};
  const title =
    cleanLabel(
      namedetails["name:ja"] ||
        namedetails.name ||
        address.city ||
        address.town ||
        address.village ||
        address.state ||
        address.country ||
        result.display_name
    ) || "Unknown location";
  const subtitle = cleanLabel(
    result.display_name || result.name || `${latitude}, ${longitude}`
  );

  return {
    displayName: subtitle,
    importance: Number(result.importance ?? 0),
    latitude,
    longitude,
    subtitle,
    title,
    type: cleanLabel(result.type || result.addresstype || result.class),
  };
}

function cleanLabel(value) {
  return String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim();
}

function getShipCollectorOptions() {
  return {
    cacheMaxRecords: clampInteger(
      process.env.AISSTREAM_CACHE_MAX_RECORDS,
      12000,
      1000,
      50000
    ),
    cacheTtlMs: clampInteger(
      process.env.AISSTREAM_CACHE_TTL_MS,
      1000 * 60 * 20,
      1000 * 60 * 2,
      1000 * 60 * 60 * 6
    ),
    initialWaitMs: clampInteger(
      process.env.AISSTREAM_INITIAL_WAIT_MS ?? process.env.AISSTREAM_SAMPLE_DURATION_MS,
      4500,
      500,
      15000
    ),
    reconnectDelayMs: clampInteger(
      process.env.AISSTREAM_RECONNECT_DELAY_MS,
      3000,
      500,
      30000
    ),
    responseMaxRecords: clampInteger(
      process.env.AISSTREAM_RESPONSE_MAX_RECORDS ?? process.env.AISSTREAM_MAX_RECORDS,
      6000,
      300,
      20000
    ),
  };
}

function ensureShipCacheCollector(apiKey, options = getShipCollectorOptions()) {
  if (!apiKey) {
    return null;
  }

  if (shipCacheState.activeApiKey && shipCacheState.activeApiKey !== apiKey) {
    resetShipCacheCollector();
  }

  shipCacheState.activeApiKey = apiKey;

  if (shipCacheState.pruneTimer == null) {
    shipCacheState.pruneTimer = setInterval(() => {
      pruneShipCache(options);
    }, 60 * 1000);

    shipCacheState.pruneTimer.unref?.();
  }

  if (
    shipCacheState.connection &&
    (shipCacheState.connection.readyState === WebSocket.OPEN ||
      shipCacheState.connection.readyState === WebSocket.CONNECTING)
  ) {
    return shipCacheState.startPromise;
  }

  if (shipCacheState.isStarting) {
    return shipCacheState.startPromise;
  }

  shipCacheState.isStarting = true;
  shipCacheState.startPromise = new Promise((resolve) => {
    const socket = new WebSocket(AISSTREAM_URL, {
      handshakeTimeout: 10000,
    });

    shipCacheState.connection = socket;

    const finishStart = () => {
      if (!shipCacheState.isStarting) {
        return;
      }

      shipCacheState.isStarting = false;
      resolve();
    };

    socket.on("open", () => {
      shipCacheState.connectedAt = Date.now();
      shipCacheState.lastError = "";
      socket.send(
        JSON.stringify({
          APIKey: apiKey,
          BoundingBoxes: worldBoundingBoxes,
          FilterMessageTypes: shipMessageTypes,
        })
      );
      finishStart();
    });

    socket.on("message", (rawData) => {
      let payload;

      try {
        payload = JSON.parse(String(rawData));
      } catch {
        return;
      }

      if (typeof payload?.error === "string") {
        shipCacheState.lastError = payload.error;
        socket.close();
        return;
      }

      const normalized = normalizeShipMessage(payload);
      if (!normalized?.id) {
        return;
      }

      const current = shipCacheState.records.get(normalized.id) ?? {
        id: normalized.id,
        lastUpdateMs: 0,
      };

      mergeShipRecord(current, normalized);
      shipCacheState.records.set(normalized.id, current);
      shipCacheState.lastMessageAt = Date.now();
      shipCacheState.isWarm = true;

      if (shipCacheState.records.size > options.cacheMaxRecords * 1.05) {
        pruneShipCache(options);
      }

      resolveShipCacheWaiters();
    });

    socket.on("error", (error) => {
      shipCacheState.lastError = error?.message || "AIS stream connection failed.";
    });

    socket.on("close", () => {
      if (shipCacheState.connection === socket) {
        shipCacheState.connection = null;
      }

      finishStart();
      scheduleShipCacheReconnect(options);
    });
  });

  return shipCacheState.startPromise;
}

function scheduleShipCacheReconnect(options = getShipCollectorOptions()) {
  if (!shipCacheState.activeApiKey || shipCacheState.reconnectTimer != null) {
    return;
  }

  shipCacheState.reconnectTimer = setTimeout(() => {
    shipCacheState.reconnectTimer = null;
    ensureShipCacheCollector(shipCacheState.activeApiKey, options);
  }, options.reconnectDelayMs);

  shipCacheState.reconnectTimer.unref?.();
}

function waitForShipCacheWarmup(timeoutMs) {
  if (shipCacheState.isWarm && shipCacheState.records.size > 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const waiter = () => {
      cleanup();
      resolve();
    };

    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      shipCacheState.waiters.delete(waiter);
    };

    shipCacheState.waiters.add(waiter);
  });
}

function resolveShipCacheWaiters() {
  const waiters = Array.from(shipCacheState.waiters);
  shipCacheState.waiters.clear();

  for (const waiter of waiters) {
    waiter();
  }
}

function pruneShipCache(options = getShipCollectorOptions()) {
  const expiryCutoff = Date.now() - options.cacheTtlMs;

  for (const [id, record] of shipCacheState.records) {
    if (!Number.isFinite(record.lastUpdateMs) || record.lastUpdateMs < expiryCutoff) {
      shipCacheState.records.delete(id);
    }
  }

  if (shipCacheState.records.size <= options.cacheMaxRecords) {
    return;
  }

  const newestRecords = Array.from(shipCacheState.records.values()).sort(
    (left, right) => right.lastUpdateMs - left.lastUpdateMs
  );
  shipCacheState.records.clear();

  newestRecords.slice(0, options.cacheMaxRecords).forEach((record) => {
    shipCacheState.records.set(record.id, record);
  });
}

function getShipCacheSnapshot(options = getShipCollectorOptions()) {
  pruneShipCache(options);

  const sampledAt = shipCacheState.lastMessageAt || shipCacheState.connectedAt || Date.now();
  const visibleRecords = Array.from(shipCacheState.records.values())
    .filter(
      (record) =>
        Number.isFinite(record.latitude) &&
        Number.isFinite(record.longitude) &&
        Number.isFinite(record.lastUpdateMs)
    )
    .sort((left, right) => right.lastUpdateMs - left.lastUpdateMs)
    .slice(0, options.responseMaxRecords)
    .map((record) => ({
      callsign: record.callsign,
      course: record.course,
      destination: record.destination,
      heading: record.heading,
      id: record.id,
      lastUpdate: new Date(record.lastUpdateMs).toISOString(),
      latitude: record.latitude,
      longitude: record.longitude,
      name: record.name,
      shipType: record.shipType,
      speedKnots: record.speedKnots,
    }));

  return {
    cacheAgeMs: Math.max(0, Date.now() - sampledAt),
    cachedRecordCount: shipCacheState.records.size,
    connectedAt:
      shipCacheState.connectedAt > 0
        ? new Date(shipCacheState.connectedAt).toISOString()
        : null,
    lastMessageAt:
      shipCacheState.lastMessageAt > 0
        ? new Date(shipCacheState.lastMessageAt).toISOString()
        : null,
    records: visibleRecords,
    sampledAt: new Date(sampledAt).toISOString(),
  };
}

function resetShipCacheCollector() {
  if (shipCacheState.reconnectTimer != null) {
    clearTimeout(shipCacheState.reconnectTimer);
    shipCacheState.reconnectTimer = null;
  }

  if (shipCacheState.pruneTimer != null) {
    clearInterval(shipCacheState.pruneTimer);
    shipCacheState.pruneTimer = null;
  }

  if (
    shipCacheState.connection &&
    (shipCacheState.connection.readyState === WebSocket.OPEN ||
      shipCacheState.connection.readyState === WebSocket.CONNECTING)
  ) {
    shipCacheState.connection.removeAllListeners();
    shipCacheState.connection.close();
  }

  shipCacheState.activeApiKey = "";
  shipCacheState.connection = null;
  shipCacheState.connectedAt = 0;
  shipCacheState.isStarting = false;
  shipCacheState.isWarm = false;
  shipCacheState.lastError = "";
  shipCacheState.lastMessageAt = 0;
  shipCacheState.records.clear();
  shipCacheState.startPromise = null;
  resolveShipCacheWaiters();
}

function normalizeShipMessage(payload) {
  const messageType = payload?.MessageType;
  const metadata = payload?.MetaData ?? payload?.Metadata ?? {};
  const messageContainer = payload?.Message ?? {};
  const message =
    messageContainer?.[messageType] ??
    payload?.[messageType] ??
    messageContainer ??
    {};

  const id = cleanAisText(
    pickString(message.UserID, metadata.MMSI, metadata.UserID)
  );

  if (!id) {
    return null;
  }

  const normalized = {
    callsign: cleanAisText(
      pickString(
        metadata.CallSign,
        metadata.Callsign,
        message.CallSign,
        message.Callsign
      )
    ),
    destination: cleanAisText(
      pickString(metadata.Destination, message.Destination)
    ),
    id,
    lastUpdateMs: parseTimestamp(
      metadata.time_utc,
      metadata.timestamp,
      payload?.timestamp
    ),
    latitude: null,
    longitude: null,
    name: cleanAisText(
      pickString(metadata.ShipName, metadata.Name, message.ShipName, message.Name)
    ),
    shipType: formatShipTypeLabel(
      pickFinite(metadata.ShipType, message.Type, message.ShipType)
    ),
    speedKnots: null,
    course: null,
    heading: null,
  };

  if (
    messageType === "PositionReport" ||
    messageType === "StandardClassBPositionReport" ||
    messageType === "ExtendedClassBPositionReport"
  ) {
    normalized.latitude = pickFinite(metadata.latitude, message.Latitude);
    normalized.longitude = pickFinite(metadata.longitude, message.Longitude);
    normalized.speedKnots = pickFinite(message.Sog, message.SpeedOverGround);
    normalized.course = pickFinite(message.Cog, message.CourseOverGround);
    normalized.heading = pickFinite(
      message.TrueHeading,
      message.Cog,
      message.CourseOverGround
    );
  }

  if (messageType === "ShipStaticData") {
    normalized.callsign =
      cleanAisText(pickString(message.CallSign, message.Callsign)) ||
      normalized.callsign;
    normalized.destination =
      cleanAisText(pickString(message.Destination)) || normalized.destination;
    normalized.name =
      cleanAisText(pickString(message.Name, message.ShipName)) ||
      normalized.name;
    normalized.shipType =
      formatShipTypeLabel(pickFinite(message.Type, message.ShipType)) ||
      normalized.shipType;
  }

  if (messageType === "StaticDataReport") {
    const reportA = message.ReportA ?? {};
    const reportB = message.ReportB ?? {};

    normalized.callsign =
      cleanAisText(pickString(reportA.CallSign, reportB.CallSign)) ||
      normalized.callsign;
    normalized.destination =
      cleanAisText(pickString(reportB.Destination)) || normalized.destination;
    normalized.name =
      cleanAisText(pickString(reportA.Name, reportB.Name, reportB.ShipName)) ||
      normalized.name;
    normalized.shipType =
      formatShipTypeLabel(pickFinite(reportB.Type, reportB.ShipType)) ||
      normalized.shipType;
  }

  return normalized;
}

function mergeShipRecord(target, source) {
  const keys = [
    "callsign",
    "course",
    "destination",
    "heading",
    "id",
    "latitude",
    "longitude",
    "name",
    "shipType",
    "speedKnots",
  ];

  for (const key of keys) {
    const value = source[key];

    if (
      value === null ||
      value === undefined ||
      value === "" ||
      Number.isNaN(value)
    ) {
      continue;
    }

    target[key] = value;
  }

  if (Number.isFinite(source.lastUpdateMs)) {
    target.lastUpdateMs = Math.max(source.lastUpdateMs, target.lastUpdateMs || 0);
  } else if (!Number.isFinite(target.lastUpdateMs)) {
    target.lastUpdateMs = Date.now();
  }
}

function parseTimestamp(...candidates) {
  for (const candidate of candidates) {
    if (candidate == null || candidate === "") {
      continue;
    }

    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate > 1e12 ? candidate : candidate * 1000;
    }

    const parsed = Date.parse(String(candidate));
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return Date.now();
}

function pickFinite(...candidates) {
  for (const candidate of candidates) {
    const number =
      typeof candidate === "string" ? Number.parseFloat(candidate) : candidate;

    if (Number.isFinite(number)) {
      return number;
    }
  }

  return null;
}

function pickString(...candidates) {
  for (const candidate of candidates) {
    if (candidate == null) {
      continue;
    }

    const text = String(candidate).trim();
    if (text) {
      return text;
    }
  }

  return "";
}

function cleanAisText(value) {
  if (!value) {
    return "";
  }

  return value
    .replace(/@+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function formatShipTypeLabel(typeCode) {
  if (!Number.isFinite(typeCode)) {
    return "";
  }

  const specificLabels = new Map([
    [30, "Fishing"],
    [31, "Towing"],
    [32, "Towing (long)"],
    [33, "Dredging"],
    [34, "Diving"],
    [35, "Military"],
    [36, "Sailing"],
    [37, "Pleasure craft"],
    [50, "Pilot"],
    [51, "Search and rescue"],
    [52, "Tug"],
    [53, "Port tender"],
    [54, "Anti-pollution"],
    [55, "Law enforcement"],
    [58, "Medical transport"],
  ]);

  if (specificLabels.has(typeCode)) {
    return specificLabels.get(typeCode);
  }

  if (typeCode >= 30 && typeCode <= 39) {
    return `Special craft (${typeCode})`;
  }

  if (typeCode >= 60 && typeCode <= 69) {
    return `Passenger (${typeCode})`;
  }

  if (typeCode >= 70 && typeCode <= 79) {
    return `Cargo (${typeCode})`;
  }

  if (typeCode >= 80 && typeCode <= 89) {
    return `Tanker (${typeCode})`;
  }

  if (typeCode >= 90 && typeCode <= 99) {
    return `Other (${typeCode})`;
  }

  return specificLabels.get(typeCode) || `Type ${typeCode}`;
}

function createRequestHandler() {
  return async (request, response) => {
    const requestUrl = new URL(request.url, "http://localhost");

    if (requestUrl.pathname === "/api/ships") {
      await handleShipSnapshotRequest(request, response);
      return;
    }

    if (requestUrl.pathname === "/api/mylocations") {
      await handleMyLocationRequest(request, response);
      return;
    }

    if (requestUrl.pathname === "/api/geocode") {
      await handleGeocodeRequest(requestUrl, request, response);
      return;
    }

    await serveStaticFile(requestUrl.pathname, response);
  };
}

function tryListen(port, host) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(createRequestHandler());

    server.once("error", (error) => {
      server.close();
      reject(error);
    });

    server.listen(port, host, () => resolve(server));
  });
}

async function listenFrom(port, host) {
  try {
    return { port, server: await tryListen(port, host) };
  } catch (error) {
    if (error.code === "EADDRINUSE") {
      return listenFrom(port + 1, host);
    }

    throw error;
  }
}

function openBrowser(url) {
  const browserProcess = spawn("cmd.exe", ["/c", "start", "", url], {
    detached: true,
    stdio: "ignore",
  });

  browserProcess.unref();
}

async function startServer(options = {}) {
  loadEnvironmentFiles(projectRoot);
  ensureShipCacheCollector(process.env.AISSTREAM_API_KEY, getShipCollectorOptions());

  const host = options.host ?? defaultHost;
  const requestedPort = Number.isFinite(options.port) ? options.port : defaultPort;
  const serverResult = options.useNextAvailablePort
    ? await listenFrom(requestedPort, host)
    : { port: requestedPort, server: await tryListen(requestedPort, host) };
  const displayHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  const url = `http://${displayHost}:${serverResult.port}/`;

  console.log(`3D Earth Explorer is running at ${url}`);

  if (serverResult.port !== requestedPort) {
    console.log(`Port ${requestedPort} is busy, using ${serverResult.port} instead.`);
  }

  if (options.openBrowserOnStart) {
    try {
      openBrowser(url);
    } catch (error) {
      console.error("Could not open the browser automatically.");
      console.error(`Open ${url} manually.`);
    }
  }

  return { ...serverResult, url };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const { server } = await startServer(options);

  const shutdown = () => {
    resetShipCacheCollector();
    server.close(() => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

module.exports = {
  startServer,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
