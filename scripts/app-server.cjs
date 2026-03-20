const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const WebSocket = require("ws");

const projectRoot = path.resolve(__dirname, "..");
const defaultHost = "127.0.0.1";
const defaultPort = 4173;
const AISSTREAM_URL = "wss://stream.aisstream.io/v0/stream";
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

  for (const rawLine of content.split(/\r?\n/u)) {
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
    const sampleDurationMs = clampInteger(
      process.env.AISSTREAM_SAMPLE_DURATION_MS,
      4500,
      1500,
      12000
    );
    const maxRecords = clampInteger(
      process.env.AISSTREAM_MAX_RECORDS,
      2200,
      300,
      5000
    );
    const records = await collectShipSnapshot({
      apiKey,
      maxRecords,
      sampleDurationMs,
    });

    sendJson(response, 200, {
      ok: true,
      provider: "AISStream",
      recordCount: records.length,
      sampleDurationMs,
      sampledAt: new Date().toISOString(),
      records,
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

function collectShipSnapshot({ apiKey, maxRecords, sampleDurationMs }) {
  return new Promise((resolve, reject) => {
    const records = new Map();
    const socket = new WebSocket(AISSTREAM_URL, {
      handshakeTimeout: 10000,
    });
    let settled = false;

    const finish = (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(sampleTimer);
      clearTimeout(handshakeTimer);

      socket.removeAllListeners();

      if (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      ) {
        socket.close();
      }

      if (error) {
        reject(error);
        return;
      }

      resolve(
        Array.from(records.values())
          .filter(
            (record) =>
              Number.isFinite(record.latitude) && Number.isFinite(record.longitude)
          )
          .sort((left, right) => right.lastUpdateMs - left.lastUpdateMs)
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
            speedKnots: record.speedKnots,
            shipType: record.shipType,
          }))
      );
    };

    const handshakeTimer = setTimeout(() => {
      finish(new Error("AIS stream connection timed out."));
    }, 12000);

    const sampleTimer = setTimeout(() => {
      finish();
    }, sampleDurationMs);

    socket.on("open", () => {
      socket.send(
        JSON.stringify({
          APIKey: apiKey,
          BoundingBoxes: worldBoundingBoxes,
          FilterMessageTypes: shipMessageTypes,
        })
      );
    });

    socket.on("message", (rawData) => {
      let payload;

      try {
        payload = JSON.parse(String(rawData));
      } catch {
        return;
      }

      if (typeof payload?.error === "string") {
        finish(new Error(payload.error));
        return;
      }

      const normalized = normalizeShipMessage(payload);
      if (!normalized?.id) {
        return;
      }

      const current = records.get(normalized.id) ?? {
        id: normalized.id,
        lastUpdateMs: 0,
      };

      mergeShipRecord(current, normalized);
      records.set(normalized.id, current);

      if (records.size >= maxRecords) {
        finish();
      }
    });

    socket.on("error", (error) => {
      finish(error);
    });

    socket.on("close", () => {
      finish();
    });
  });
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
