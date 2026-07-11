import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  buildGatewayRouter,
  dispatchGatewayRequest,
  type GatewayApp,
} from "@ai-gateway/gateway-runtime";

/**
 * architecture §10.2's REST contract, narrowed to this milestone's own
 * named scope (Blueprint §7 EM-5's "Features delivered" line: `/v1/execute`,
 * `/v1/execute/stream`) plus `/v1/health` (this milestone's Health &
 * Operational Endpoints requirement). `/v1/tasks`, `/v1/usage`, and
 * `POST|DELETE /v1/credentials` (architecture §10.2) are deliberately not
 * wired here — see this package's README, Scope Verification, for why
 * each is out of this milestone's named scope rather than an oversight.
 *
 * The route table (`buildGatewayRouter`) and per-request dispatch
 * (`dispatchGatewayRequest`) — matching, 404/405, and the error backstop —
 * are `@ai-gateway/gateway-runtime`'s, shared with `apps/vercel-adapter`.
 * This file's own job is exactly "own the listen socket": build the
 * router once, wrap `dispatchGatewayRequest` in a real `http.Server`, and
 * nothing else. `apps/vercel-adapter` wraps the exact same two functions
 * around a Vercel Function handler instead of a `Server` — see
 * `docs/adr/0011-shared-gateway-runtime-package.md`.
 */
export function createHttpServer(app: GatewayApp): Server {
  const router = buildGatewayRouter(app);

  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    dispatchGatewayRequest(router, req, res, path).catch((error: unknown) => {
      // Last-resort backstop: `dispatchGatewayRequest` already has its own
      // internal backstop; this one only fires if that promise itself
      // somehow rejects (a bug in this file's own composition, not a
      // downstream package) — rather than an unhandled rejection killing
      // the process or hanging the client's connection open forever.
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      }
      if (!res.writableEnded) {
        res.end(JSON.stringify({ error: { message: String(error) } }));
      }
    });
  });
}
