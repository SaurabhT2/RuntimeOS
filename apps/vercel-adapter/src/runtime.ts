import {
  bootstrap,
  buildGatewayRouter,
  type GatewayApp,
  type Router,
} from "@ai-gateway/gateway-runtime";
import { loadVercelConfigFromEnv } from "./vercel-config.js";

/**
 * `apps/gateway-server/src/index.ts` calls `bootstrap()` exactly once, at
 * process start, before `.listen()` opens the socket — every request
 * afterward reuses that one `GatewayApp`. There is no process-start
 * moment here: Vercel invokes an exported request handler per request
 * inside a platform-managed execution environment, and (per EM-5.5's
 * approved architecture, §4/§9) *may* reuse that environment, its module
 * scope, and any objects held in it, across multiple invocations on the
 * same warm instance — or may not, on a cold start or a new instance.
 *
 * This lazily bootstraps on the *first* invocation a given instance
 * handles, then caches both the resulting `GatewayApp` and its
 * `buildGatewayRouter(app)` route table in module scope, so every later
 * invocation on that same warm instance reuses the identical `GatewayApp`
 * (same `orchestrator`, same in-memory rate-limit/cache/circuit-breaker
 * state, same adapters) *and* skips rebuilding the route table on every
 * request — the closest a platform-managed instance can get to
 * "`bootstrap()`/route registration run once per running process,"
 * without ever calling `.listen()` or owning the process itself. A cold
 * start or a new concurrent instance runs this again independently; see
 * this app's README, "In-memory state and multiple instances," for the
 * consequence (the same one EM-5.5's architecture review, Finding 4,
 * already flags for the existing Node/container deployment under
 * horizontal scaling — not a new limitation this adapter introduces).
 *
 * `instrumentationName`/`defaultActor` are passed explicitly here (rather
 * than relying on `bootstrap()`'s defaults, which preserve
 * `apps/gateway-server`'s original identity) so this app's telemetry
 * spans and credential-audit log entries are attributable to
 * `apps/vercel-adapter`, not to the Node deployment.
 *
 * Deliberately a pair of bare module-level variables, not a class or a
 * dependency-injection container: matching `bootstrap()`'s own "a
 * sequencing function, not a class hierarchy" precedent, extended to this
 * one piece of Vercel-specific caching glue that has no equivalent in
 * `apps/gateway-server` at all (that app's process-lifetime *is* its
 * cache).
 */
let appPromise: Promise<GatewayApp> | undefined;
let cachedRouter: Router | undefined;

export interface WarmInstance {
  app: GatewayApp;
  router: Router;
}

export async function getWarmInstance(): Promise<WarmInstance> {
  if (!appPromise) {
    // `async` here isn't just style: if `loadVercelConfigFromEnv()` throws
    // synchronously (e.g. a missing required environment variable), that
    // throw happens while evaluating `bootstrap(...)`'s argument. Inside a
    // plain (non-async) function, that exception would escape as a raw
    // synchronous throw instead of a rejected `Promise<GatewayApp>` —
    // breaking any caller that (correctly, per this function's return
    // type) only wraps the *returned promise* in error handling, not the
    // call to this function itself. `api/v1/[...path].ts` does exactly
    // that. Declaring this function `async` guarantees every code path
    // below, synchronous or not, always surfaces as a rejection.
    appPromise = bootstrap(loadVercelConfigFromEnv(), {
      instrumentationName: "@ai-gateway/vercel-adapter",
      defaultActor: "vercel-adapter",
    }).catch((error: unknown) => {
      // A failed bootstrap must not be cached "successfully" as a
      // permanently-broken promise — the next invocation on this same
      // warm instance should get a fresh chance to bootstrap (e.g. after
      // an operator fixes a missing environment variable and redeploys),
      // rather than every subsequent request on this instance failing
      // forever with the same stale error.
      appPromise = undefined;
      cachedRouter = undefined;
      throw error;
    });
  }
  const app = await appPromise;
  cachedRouter ??= buildGatewayRouter(app);
  return { app, router: cachedRouter };
}
