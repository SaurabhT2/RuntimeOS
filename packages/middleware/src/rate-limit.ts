import { GatewayError } from "@ai-gateway/core-contracts";
import type { Telemetry } from "@ai-gateway/telemetry";
import type { RateLimitResult, TenantContext } from "./types.js";

interface Bucket {
  tokens: number;
  lastRefillAt: number;
}

export interface RateLimitMiddlewareOptions {
  /** Requests allowed per full window (architecture §20.4: "rate limit counters are keyed per tenant scope"). Default: 60. */
  requestsPerWindow?: number;
  /** Window length in milliseconds. Default: 60_000 (i.e. `requestsPerWindow` is a per-minute quota by default). */
  windowMs?: number;
  telemetry: Telemetry;
  /** Injected for deterministic tests. Defaults to `Date.now`. */
  now?: () => number;
}

const DEFAULT_REQUESTS_PER_WINDOW = 60;
const DEFAULT_WINDOW_MS = 60_000;

/**
 * A token-bucket limiter keyed by tenant scope (architecture §20.4: "one
 * workspace's burst cannot starve another's quota"; §17's `C{Rate limit
 * ok?}` node). Continuous refill (`tokens += elapsed/windowMs *
 * requestsPerWindow`, capped at the bucket size) rather than fixed-window
 * reset, so a caller sitting exactly on a window boundary cannot double
 * their effective quota.
 *
 * Per-tenant-scope keying, not per-API-key: two API keys issued to the
 * same workspace share one bucket (matches §20.4's "workspace" framing
 * directly), while two different workspaces never share one even if they
 * happen to make requests in the same instant. See `keyFor`.
 *
 * In-memory only — correct for a single gateway instance. A multi-instance
 * deployment needs a shared store (Redis token-bucket, etc.); that is
 * explicitly out of EM-4 scope (see this package's README, Deferred Work)
 * since nothing in the Engineering Blueprint's EM-4 feature list or the
 * architecture spec names a distributed rate-limit backend, and building
 * one without a named requirement would be scope creep this milestone's
 * brief explicitly warns against.
 */
export class RateLimitMiddleware {
  private readonly requestsPerWindow: number;
  private readonly windowMs: number;
  private readonly telemetry: Telemetry;
  private readonly now: () => number;
  private readonly buckets = new Map<string, Bucket>();

  constructor(options: RateLimitMiddlewareOptions) {
    this.requestsPerWindow = options.requestsPerWindow ?? DEFAULT_REQUESTS_PER_WINDOW;
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.telemetry = options.telemetry;
    this.now = options.now ?? Date.now;
  }

  /** Checks and, if allowed, atomically consumes one request's worth of quota for `tenant`. */
  check(tenant: TenantContext): RateLimitResult {
    const key = keyFor(tenant);
    const bucket = this.refill(key);

    if (bucket.tokens < 1) {
      const retryAfterMs = Math.ceil(
        ((1 - bucket.tokens) / this.requestsPerWindow) * this.windowMs,
      );
      this.telemetry.recordMetric("middleware.rateLimit.rejected", 1, {
        organizationId: tenant.organizationId,
      });
      return { allowed: false, remaining: 0, retryAfterMs };
    }

    bucket.tokens -= 1;
    this.telemetry.recordMetric("middleware.rateLimit.allowed", 1, {
      organizationId: tenant.organizationId,
    });
    return { allowed: true, remaining: Math.floor(bucket.tokens) };
  }

  /** Convenience wrapper around {@link check} that throws the `RATE_LIMITED` `GatewayError` `pipeline.ts` and any direct caller expects, instead of returning a result to branch on. */
  checkOrThrow(tenant: TenantContext): void {
    const result = this.check(tenant);
    if (!result.allowed) {
      throw new GatewayError(
        "RATE_LIMITED",
        `Rate limit exceeded for organization "${tenant.organizationId}". Retry after ${result.retryAfterMs}ms.`,
        true,
        { organizationId: tenant.organizationId, retryAfterMs: result.retryAfterMs },
      );
    }
  }

  private refill(key: string): Bucket {
    const now = this.now();
    const existing = this.buckets.get(key);
    if (!existing) {
      // A never-seen tenant starts with a full bucket; `check()` performs
      // the actual `-1` consumption uniformly for both new and existing
      // buckets, so this just seeds the bucket at full capacity.
      const bucket: Bucket = { tokens: this.requestsPerWindow, lastRefillAt: now };
      this.buckets.set(key, bucket);
      return bucket;
    }
    const elapsedMs = now - existing.lastRefillAt;
    if (elapsedMs > 0) {
      const refillAmount = (elapsedMs / this.windowMs) * this.requestsPerWindow;
      existing.tokens = Math.min(this.requestsPerWindow, existing.tokens + refillAmount);
      existing.lastRefillAt = now;
    }
    return existing;
  }
}

/**
 * architecture §20.4's tenant-scope granularity for rate limiting is
 * "workspace" (the sentence's own example: "one workspace's burst cannot
 * starve another's"). Falls back to `organizationId` alone when no
 * `workspaceId` is present, since `ExecuteRequest.tenant.workspaceId` is
 * optional (architecture §10.3) and a request scoped only to an
 * organization still needs a bucket to be keyed against.
 */
function keyFor(tenant: TenantContext): string {
  return tenant.workspaceId
    ? `${tenant.organizationId}:${tenant.workspaceId}`
    : tenant.organizationId;
}
