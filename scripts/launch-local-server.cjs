const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const host = "127.0.0.1";
const startPort = 4173;

const mimeTypes = new Map([
  [".css", "text/css; charset=UTF-8"],
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

function resolveFilePath(requestPathname) {
  const decodedPath = decodeURIComponent(requestPathname);
  const normalizedPath = path
    .normalize(decodedPath)
    .replace(/^[/\\]+/, "")
    .replace(/^(\.\.[/\\])+/, "");
  let resolvedPath = path.join(projectRoot, normalizedPath);

  if (resolvedPath.endsWith(path.sep)) {
    resolvedPath = path.join(resolvedPath, "index.html");
  }

  if (!resolvedPath.startsWith(projectRoot)) {
    return null;
  }

  return resolvedPath;
}

function createRequestHandler() {
  return async (request, response) => {
    const requestUrl = new URL(request.url, `http://${host}`);
    const targetPath =
      requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
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
      const contentType =
        mimeTypes.get(extension) || "application/octet-stream";

      response.writeHead(200, {
        "Cache-Control": "no-cache",
        "Content-Type": contentType,
      });

      fs.createReadStream(filePath).pipe(response);
    } catch (error) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=UTF-8" });
      response.end("Not Found");
    }
  };
}

function tryListen(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(createRequestHandler());

    server.once("error", (error) => {
      server.close();
      reject(error);
    });

    server.listen(port, host, () => resolve(server));
  });
}

async function listenFrom(port) {
  try {
    return { server: await tryListen(port), port };
  } catch (error) {
    if (error.code === "EADDRINUSE") {
      return listenFrom(port + 1);
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

async function main() {
  const { server, port } = await listenFrom(startPort);
  const url = `http://${host}:${port}/`;

  console.log(`3D Earth Explorer is running at ${url}`);
  console.log("Close this window to stop the local server.");

  try {
    openBrowser(url);
  } catch (error) {
    console.error("Could not open the browser automatically.");
    console.error(`Open ${url} manually.`);
  }

  const shutdown = () => {
    server.close(() => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
