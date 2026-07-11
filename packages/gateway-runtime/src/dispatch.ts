import type { IncomingMessage, ServerResponse } from "node:http";
import type { GatewayApp } from "./bootstrap.js";
import { Router } from "./router.js";
import { handleExecute } from "./http/routes/execute.js";
import { handleExecuteStream } from "./http/routes/execute-stream.js";
import { handleHealth } from "./http/routes/health.js";
import { sendError } from "./http/respond.js";

/**
 * Registers this gateway's three fixed routes (architecture §10.2) against
 * one `GatewayApp`. Call this **once** per running `GatewayApp` instance —
 * a real `http.Server` builds it once at process start
 * (`apps/gateway-server/src/http/server.ts`); a Vercel Function builds it
 * once per warm instance, alongside the cached `GatewayApp`
 * (`apps/vercel-adapter/src/runtime.ts`) — not once per request.
 */
export function buildGatewayRouter(app: GatewayApp): Router {
  const router = new Router();
  router.register("POST", "/v1/execute", (req, res) => handleExecute(req, res, app));
  router.register("POST", "/v1/execute/stream", (req, res) => handleExecuteStream(req, res, app));
  router.register("GET", "/v1/health", (req, res) => handleHealth(req, res, app));
  return router;
}

/**
 * Matches `method`+`path` against an already-built `router` and invokes
 * the corresponding handler, or writes the gateway's standard 404/405
 * response when nothing matches. This is the one piece of "reusable HTTP
 * composition logic" every hosting layer delegates to — the *only* thing
 * that differs between hosting layers is how `path` is derived from the
 * incoming request (`req.url` for a real Node server;
 * Vercel's captured dynamic route segments for a Vercel Function — see
 * each app's own hosting-layer file) and whether the caller awaits the
 * returned promise (a real `http.Server`'s process keeps running
 * regardless of when any one request's async work settles, so
 * `apps/gateway-server` doesn't need to; a Vercel Function's invocation
 * lifetime *is* tied to this promise, so `apps/vercel-adapter` must await
 * it all the way through, including a streaming route's full SSE loop).
 *
 * Returns a `Promise<void>` unconditionally so both call sites can treat
 * it uniformly — fire-and-forget with a `.catch()`, or `await`ed — without
 * this function needing to know which.
 */
export async function dispatchGatewayRequest(
  router: Router,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
): Promise<void> {
  const method = req.method ?? "GET";

  const handler = router.match(method, path);
  if (handler) {
    try {
      await handler(req, res);
    } catch (error: unknown) {
      // Last-resort backstop: each route handler above already catches
      // its own errors (`sendError` inside its own try/catch), but if one
      // somehow throws past that, this still guarantees "no raw exception
      // escapes the public API" holds rather than an unhandled rejection
      // hanging the client's connection open forever.
      if (!res.headersSent) {
        sendError(res, error);
      } else if (!res.writableEnded) {
        res.end();
      }
    }
    return;
  }

  if (router.hasPath(path)) {
    res.writeHead(405, { "content-type": "application/json; charset=utf-8", allow: "GET, POST" });
    res.end(JSON.stringify({ error: { message: `Method ${method} not allowed for ${path}.` } }));
    return;
  }

  res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: { message: `No route for ${method} ${path}.` } }));
}
