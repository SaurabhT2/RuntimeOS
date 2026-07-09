import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { GatewayApp } from "../bootstrap.js";
import { Router } from "./router.js";
import { handleExecute } from "./routes/execute.js";
import { handleExecuteStream } from "./routes/execute-stream.js";
import { handleHealth } from "./routes/health.js";
import { sendError } from "./respond.js";

/**
 * architecture §10.2's REST contract, narrowed to this milestone's own
 * named scope (Blueprint §7 EM-5's "Features delivered" line: `/v1/execute`,
 * `/v1/execute/stream`) plus `/v1/health` (this milestone's Health &
 * Operational Endpoints requirement). `/v1/tasks`, `/v1/usage`, and
 * `POST|DELETE /v1/credentials` (architecture §10.2) are deliberately not
 * wired here — see this package's README, Scope Verification, for why
 * each is out of this milestone's named scope rather than an oversight.
 */
export function createHttpServer(app: GatewayApp): Server {
  const router = new Router();
  router.register("POST", "/v1/execute", (req, res) => handleExecute(req, res, app));
  router.register("POST", "/v1/execute/stream", (req, res) => handleExecuteStream(req, res, app));
  router.register("GET", "/v1/health", (req, res) => handleHealth(req, res, app));

  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    const method = req.method ?? "GET";

    const handler = router.match(method, path);
    if (handler) {
      Promise.resolve(handler(req, res)).catch((error: unknown) => {
        // Last-resort backstop: a route handler above is expected to
        // catch its own errors (`sendError` inside each handler's own
        // try/catch), but if one somehow throws past that (a bug in this
        // file's own composition, not a downstream package), this still
        // guarantees "no raw exception escapes the public API" holds —
        // this milestone's own Error Handling requirement — rather than
        // an unhandled rejection killing the process or hanging the
        // client's connection open forever.
        if (!res.headersSent) {
          sendError(res, error);
        } else if (!res.writableEnded) {
          res.end();
        }
      });
      return;
    }

    if (router.hasPath(path)) {
      res.writeHead(405, { "content-type": "application/json; charset=utf-8", allow: "GET, POST" });
      res.end(JSON.stringify({ error: { message: `Method ${method} not allowed for ${path}.` } }));
      return;
    }

    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: { message: `No route for ${method} ${path}.` } }));
  });
}
