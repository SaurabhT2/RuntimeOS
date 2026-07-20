import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { StudioConfig } from "./studio-config.js";
import { proxyToGateway } from "./proxy.js";
import { serveStatic } from "./static.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// `dist/server.js` at runtime -> `../public` resolves to the package's
// `public/` directory alongside `dist/`, per this package's `files`
// field in package.json.
const PUBLIC_DIR = join(__dirname, "..", "public");

// The only four real routes this Studio ever proxies to — the exact set
// `packages/gateway-runtime/src/dispatch.ts` registers. No other path
// under `/studio-api/*` forwards anywhere; there is nothing else to
// forward to, and inventing additional proxied routes would mean
// inventing gateway behavior that doesn't exist.
const PROXY_ROUTES: Record<string, string> = {
  "/studio-api/execute": "/v1/execute",
  "/studio-api/execute/stream": "/v1/execute/stream",
  "/studio-api/execute/pipeline": "/v1/execute/pipeline",
  "/studio-api/health": "/v1/health",
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(payload);
}

function isAuthorized(req: IncomingMessage, config: StudioConfig): boolean {
  if (!config.studioAccessKey) return true;
  return req.headers["x-studio-key"] === config.studioAccessKey;
}

export function createStudioServer(config: StudioConfig): Server {
  return createServer((req, res) => {
    void handleRequest(req, res, config);
  });
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: StudioConfig,
): Promise<void> {
  const urlPath = (req.url ?? "/").split("?")[0] ?? "/";

  if (urlPath.startsWith("/studio-api/")) {
    if (!isAuthorized(req, config)) {
      sendJson(res, 401, {
        error: {
          name: "StudioAuthError",
          code: "STUDIO_ACCESS_DENIED",
          message: "Missing or invalid x-studio-key header.",
          retryable: false,
        },
      });
      return;
    }

    if (urlPath === "/studio-api/meta") {
      // Informational only, never proxied — see this package's README,
      // "What the Studio can and cannot introspect about the target
      // deployment." Deliberately excludes gatewayApiKey.
      sendJson(res, 200, {
        gatewayUrl: config.gatewayUrl,
        note:
          "This Studio cannot determine whether Strategy Layer is " +
          "enabled, or whether Budget Governance is configured, on the " +
          "target gateway — neither is exposed by any API response. See " +
          "the Strategy Layer and Budget Governance panels for what is " +
          "and isn't knowable from here.",
      });
      return;
    }

    const gatewayPath = PROXY_ROUTES[urlPath];
    if (gatewayPath) {
      await proxyToGateway(req, res, config, gatewayPath);
      return;
    }

    sendJson(res, 404, {
      error: {
        name: "StudioRouteError",
        code: "STUDIO_ROUTE_NOT_FOUND",
        message: `No such Studio API route: ${urlPath}`,
        retryable: false,
      },
    });
    return;
  }

  serveStatic(req, res, PUBLIC_DIR);
}
