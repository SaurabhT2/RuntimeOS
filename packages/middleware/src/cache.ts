import { createHash } from "node:crypto";
import type { ExecuteRequest, ExecuteResponse } from "@ai-gateway/core-contracts";
import type { Telemetry } from "@ai-gateway/telemetry";

interface Entry {
  response: ExecuteResponse;
  expiresAt: number;
}

export interface CacheMiddlewareOptions {
  /** Time-to-live for a cached entry, in milliseconds. Default: 60_000. */
  ttlMs?: number;
  telemetry: Telemetry;
  /** Injected for deterministic tests. Defaults to `Date.now`. */
  now?: () => number;
  /**
   * architecture §20.4: "the response cache key includes tenant scope by
   * default (configurable to relax for genuinely tenant-independent,
   * non-sensitive tasks only)". `false` opts a `CacheMiddleware` instance
   * out of tenant-scoping entirely — a whole-instance setting, not a
   * per-request one, so relaxing it is a deliberate deployment-level
   * choice (e.g. a dedicated cache instance for a known-public task) and
   * never something a single caller can trigger for themselves. Default:
   * `true`.
   */
  includeTenantInKey?: boolean;
}

const DEFAULT_TTL_MS = 60_000;

/**
 * A response cache keyed by tenant scope + request content (architecture
 * §20.4, §17's `D{Cached response available?}` node — a hit short-circuits
 * the entire Policy Engine → Provider Execution chain, per §17's `D --
 * yes --> Z2[Return cached response]`, §22's "removes a DB round-trip from
 * the hot path" framing applied to the whole request rather than just the
 * registry).
 *
 * Deliberately never caches a streaming request
 * (`ExecuteRequest.constraints.streaming`) — a cached `ExecuteResponse` has
 * no `StreamChunk` representation to replay — see `get`/`set`.
 *
 * In-memory only, same rationale and same Deferred Work note as
 * `RateLimitMiddleware` — see that class's doc comment.
 */
export class CacheMiddleware {
  private readonly ttlMs: number;
  private readonly telemetry: Telemetry;
  private readonly now: () => number;
  private readonly includeTenantInKey: boolean;
  private readonly entries = new Map<string, Entry>();

  constructor(options: CacheMiddlewareOptions) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.telemetry = options.telemetry;
    this.now = options.now ?? Date.now;
    this.includeTenantInKey = options.includeTenantInKey ?? true;
  }

  /** Returns a cached response for `req`, or `undefined` on a miss (including an expired entry, which is evicted). Always a miss for a streaming request — see class doc comment. */
  get(req: ExecuteRequest): ExecuteResponse | undefined {
    if (req.constraints?.streaming) {
      return undefined;
    }
    const key = this.keyFor(req);
    const entry = this.entries.get(key);
    if (!entry) {
      this.telemetry.recordMetric("middleware.cache.miss", 1, { task: req.task });
      return undefined;
    }
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      this.telemetry.recordMetric("middleware.cache.miss", 1, {
        task: req.task,
        reason: "expired",
      });
      return undefined;
    }
    this.telemetry.recordMetric("middleware.cache.hit", 1, { task: req.task });
    return entry.response;
  }

  /** Stores `response` for `req`. A no-op for a streaming request — see class doc comment. */
  set(req: ExecuteRequest, response: ExecuteResponse): void {
    if (req.constraints?.streaming) {
      return;
    }
    const key = this.keyFor(req);
    this.entries.set(key, { response, expiresAt: this.now() + this.ttlMs });
  }

  /** Evicts every entry. Exposed for tests and for an admin-triggered cache flush (a plausible future `apps/gateway-server` operation — not itself EM-4 scope). */
  clear(): void {
    this.entries.clear();
  }

  /**
   * The cache key: tenant scope (unless {@link CacheMiddlewareOptions.includeTenantInKey}
   * is `false`) + `task` + a stable hash of `input` and `constraints`.
   * Deliberately excludes `requestId`/`correlationId` (caller-supplied
   * correlation data, not part of what makes two requests "the same
   * request" for caching purposes) and `preferences` (soft hints per
   * architecture §10.3 — two requests differing only in `preferences`
   * should still be able to share a cache entry, since preferences do not
   * change what a correct answer looks like, only how it is selected).
   */
  private keyFor(req: ExecuteRequest): string {
    const material = {
      task: req.task,
      input: req.input,
      constraints: req.constraints,
    };
    const hash = createHash("sha256").update(JSON.stringify(material)).digest("hex");
    return this.includeTenantInKey
      ? `${tenantKey(req.tenant)}:${req.task}:${hash}`
      : `${req.task}:${hash}`;
  }
}

function tenantKey(tenant: ExecuteRequest["tenant"]): string {
  return [tenant.organizationId, tenant.workspaceId, tenant.projectId, tenant.userId]
    .filter((part) => part !== undefined)
    .join(":");
}
