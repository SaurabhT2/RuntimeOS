import { fileURLToPath } from "node:url";
import { bootstrap } from "./bootstrap.js";
import { createHttpServer } from "./http/server.js";
import { registerGracefulShutdown } from "./lifecycle.js";
import { GatewayServerConfigError, loadServerConfigFromEnv } from "./server-config.js";

/**
 * The one process entrypoint (`package.json`'s `start` script: `node
 * dist/index.js`). Deliberately thin — every real decision (what gets
 * constructed, how it's wired) lives in `bootstrap.ts`; this file's only
 * job is startup-validation ordering (config, then bootstrap, then
 * listen) and top-level failure handling, per this milestone's
 * "Configuration... fail-fast behavior for invalid configuration" and
 * "no silent configuration failures" requirements: any failure at any of
 * these three stages is logged to `stderr` and exits non-zero rather than
 * starting a server in a half-initialized state.
 */
async function main(): Promise<void> {
  const serverConfig = loadServerConfigFromEnv();

  if (!process.env.GATEWAY_API_KEYS_JSON && process.env.GATEWAY_ALLOW_DEV_DEFAULTS === "true") {
    console.warn(
      "[gateway-server] GATEWAY_ALLOW_DEV_DEFAULTS=true and no GATEWAY_API_KEYS_JSON set: " +
        'starting with a single, well-known, INSECURE development API key ("dev-local-only-insecure-key"). ' +
        "Never use this in a reachable or production deployment.",
    );
  }

  const app = await bootstrap(serverConfig);
  const server = createHttpServer(app);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(serverConfig.http.port, serverConfig.http.host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  app.telemetry.log("info", "gateway_server.started", {
    host: serverConfig.http.host,
    port: serverConfig.http.port,
  });

  registerGracefulShutdown(server, app.telemetry);
}

const isDirectExecution =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

/* c8 ignore start -- exercised only by an actual `node dist/index.js` process spawn, not by unit tests importing this module (see vitest.config.ts's exclusion of this file, and this package's README, Testing strategy). */
if (isDirectExecution) {
  main().catch((error: unknown) => {
    if (error instanceof GatewayServerConfigError) {
      console.error(`[gateway-server] Invalid configuration: ${error.message}`);
    } else {
      console.error("[gateway-server] Fatal startup error:", error);
    }
    process.exit(1);
  });
}
/* c8 ignore stop */

export { main };
