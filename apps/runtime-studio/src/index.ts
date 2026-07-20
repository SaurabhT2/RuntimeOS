import { StudioConfigError, loadStudioConfigFromEnv } from "./studio-config.js";
import { createStudioServer } from "./server.js";

/**
 * The one process entrypoint (`package.json`'s `start` script: `node
 * dist/index.js`), mirroring `apps/gateway-server/src/index.ts`'s own
 * shape: load config, fail fast and loudly on invalid config, then
 * listen. This app never starts in a half-configured state — an
 * unreachable or unset `GATEWAY_URL`/`GATEWAY_API_KEY` fails at startup,
 * not on the first click in the UI.
 */
async function main(): Promise<void> {
  const config = loadStudioConfigFromEnv();
  const server = createStudioServer(config);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.http.port, config.http.host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  console.log(
    `[runtime-studio] listening on http://${config.http.host}:${config.http.port}, ` +
      `proxying to ${config.gatewayUrl}`,
  );

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      console.log(`[runtime-studio] received ${signal}, shutting down`);
      server.close(() => process.exit(0));
    });
  }
}

main().catch((error) => {
  if (error instanceof StudioConfigError) {
    console.error(`[runtime-studio] configuration error: ${error.message}`);
  } else {
    console.error("[runtime-studio] failed to start:", error);
  }
  process.exit(1);
});
