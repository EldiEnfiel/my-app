const { startServer } = require("./app-server.cjs");

startServer({
  host: "127.0.0.1",
  openBrowserOnStart: true,
  port: 4173,
  useNextAvailablePort: true,
})
  .then(({ server }) => {
    console.log("Close this window to stop the local server.");

    const shutdown = () => {
      server.close(() => process.exit(0));
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
