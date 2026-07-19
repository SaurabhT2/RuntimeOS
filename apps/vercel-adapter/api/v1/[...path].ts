import type { IncomingMessage, ServerResponse } from "node:http";
import { dispatchGatewayRequest, sendError } from "@ai-gateway/gateway-runtime";
import { getWarmInstance } from "../../src/runtime.js";

/**
 * The one Vercel-native entrypoint for EM-5.5's Vercel deployment target
 * (`docs/Hosting-architecture/EM-5.5-vercel-deployment-architecture-review.md`,
 * approved, revised). A single catch-all Node.js Function — not one file
 * per route — so `/v1/execute`, `/v1/execute/stream`, and `/v1/health` all
 * run inside the same Vercel Function and therefore share one warm
 * instance's `GatewayApp` (same in-memory rate-limit/cache/circuit-breaker
 * state across all three routes, matching `apps/gateway-server`'s
 * one-process model as closely as a platform-managed instance allows —
 * see `src/runtime.ts`'s doc comment). Three separate `/api` files would
 * each become their own isolated Function with their own isolated memory,
 * which would be a real behavioral difference between the two deployment
 * targets, not just a hosting-lifecycle one.
 *
 * `vercel.json` rewrites the public, gateway-server-identical paths
 * (`/v1/execute`, `/v1/execute/stream`, `/v1/health` — no `/api` prefix)
 * to `/api/v1/:path*`, which Vercel resolves to this file
 * (`api/v1/[...path].ts`, a catch-all dynamic route). The captured
 * segments arrive as `req.query.path` (a Vercel-provided helper — see
 * https://vercel.com/docs/functions/runtimes/node-js, "Node.js request
 * and response objects"), which this file uses to reconstruct the
 * `/v1/...` path string `dispatchGatewayRequest` matches against —
 * `req.url`'s exact value after Vercel's internal rewrite is not part of
 * Vercel's stable, documented contract, so it is deliberately not used
 * for routing here.
 *
 * The route table itself (`buildGatewayRouter`), per-request dispatch,
 * request parsing/validation, and all three route handlers are
 * `@ai-gateway/gateway-runtime`'s — the same shared implementation
 * `apps/gateway-server/src/http/server.ts` wraps in a real `http.Server`.
 * This file's only job is deriving `path` from Vercel's request shape and
 * awaiting `dispatchGatewayRequest` all the way through (a Vercel Function
 * invocation's lifetime is tied to this returned promise — see that
 * function's own doc comment — unlike a real `http.Server`, which doesn't
 * need to await it).
 *
 * No `export const config = { api: { bodyParser: false } }` (the
 * Next.js-pages-router convention for opting out of automatic body
 * parsing): Vercel documents `request.body` as a lazily-computed getter,
 * "only computed when it is accessed." `readJsonBody` (shared, unmodified,
 * from `@ai-gateway/gateway-runtime`) reads `req` as a raw stream via
 * `data`/`end` events and never touches `.body`, so that getter is simply
 * never triggered and the stream reaches `readJsonBody` exactly as it
 * would on a real Node server.
 */
interface VercelHelperRequest extends IncomingMessage {
  query?: Record<string, string | string[] | undefined>;
}

function resolvePath(req: VercelHelperRequest): string {
  const captured = req.query?.path;
  const segments = Array.isArray(captured) ? captured : captured ? [captured] : [];
  return `/v1/${segments.join("/")}`;
}

export default async function handler(
  req: VercelHelperRequest,
  res: ServerResponse,
): Promise<void> {
  try {
    const path = resolvePath(req);
    const { router } = await getWarmInstance();
    // Awaited, not fired-and-forgotten: a Vercel Function invocation's
    // lifetime is tied to this returned promise (see
    // `dispatchGatewayRequest`'s own doc comment), including the full
    // duration of a streaming response.
    await dispatchGatewayRequest(router, req, res, path);
  } catch (error) {
    // Backstop for a bootstrap failure itself (e.g. invalid/missing
    // environment configuration — `VercelAdapterConfigError`) reaching
    // this point before `dispatchGatewayRequest` ever ran, which that
    // function's own try/catch cannot cover since it never got called.
    if (!res.headersSent) {
      sendError(res, error);
    } else if (!res.writableEnded) {
      res.end();
    }
  }
}
