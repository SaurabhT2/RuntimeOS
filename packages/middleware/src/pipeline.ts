import type { ExecuteRequest, ExecuteResponse } from "@ai-gateway/core-contracts";
import type { AuthMiddleware } from "./auth.js";
import type { CacheMiddleware } from "./cache.js";
import type { RateLimitMiddleware } from "./rate-limit.js";
import type { AuthContext } from "./types.js";

/**
 * `middleware`'s frozen dependency edge (Section 4.1's `DEPENDENCY_TABLE`)
 * is `config`, `telemetry`, `core-contracts` only — no edge onto
 * `orchestrator` (and, symmetrically, `orchestrator` has none onto
 * `middleware`; see `orchestrator`'s README, Integration Architecture
 * Summary). `MiddlewarePipeline` therefore never imports
 * `ExecutionOrchestrator` — the downstream handler is this generic,
 * structurally-typed function instead. Per architecture §6.4, wiring a
 * real `orchestrator.execute` (bound) into a real `MiddlewarePipeline` is
 * `apps/gateway-server/src/bootstrap.ts`'s job (EM-5), the one place
 * permitted to import every concrete implementation simultaneously — the
 * same composition-root pattern `ProviderAdapterRegistry` (ADR-0008) uses
 * one layer down.
 */
export type DownstreamHandler = (
  req: ExecuteRequest,
  auth: AuthContext,
) => Promise<ExecuteResponse>;

export interface MiddlewarePipelineOptions {
  auth: AuthMiddleware;
  rateLimit: RateLimitMiddleware;
  cache: CacheMiddleware;
}

/**
 * architecture §17's request-lifecycle prefix, before the Policy Engine is
 * ever consulted: `A[Incoming ExecuteRequest] --> B{Auth valid?}`, `B --
 * yes --> C{Rate limit ok?}`, `C -- yes --> D{Cached response available?}`,
 * `D -- yes --> Z2[Return cached response]`, `D -- no --> E[Policy Engine]`
 * (`E` onward is `ExecutionOrchestrator`'s job, not this package's).
 *
 * `run` executes exactly that prefix, then — only on a cache miss — calls
 * `downstream` (bound to a real orchestrator by the composition root) and
 * caches a successful, non-streaming result before returning it.
 */
export class MiddlewarePipeline {
  private readonly auth: AuthMiddleware;
  private readonly rateLimit: RateLimitMiddleware;
  private readonly cache: CacheMiddleware;

  constructor(options: MiddlewarePipelineOptions) {
    this.auth = options.auth;
    this.rateLimit = options.rateLimit;
    this.cache = options.cache;
  }

  async run(
    req: ExecuteRequest,
    apiKey: string | undefined,
    downstream: DownstreamHandler,
  ): Promise<ExecuteResponse> {
    // B: throws GatewayError("CREDENTIAL_INVALID", ..., false) on failure — propagates as-is.
    const auth = this.auth.authenticate(apiKey);

    // C: throws GatewayError("RATE_LIMITED", ..., true) on failure — propagates as-is.
    this.rateLimit.checkOrThrow(auth.tenant);

    // D: a hit returns immediately, short-circuiting `downstream` entirely.
    const cached = this.cache.get(req);
    if (cached) {
      return cached;
    }

    const response = await downstream(req, auth);
    this.cache.set(req, response);
    return response;
  }
}
