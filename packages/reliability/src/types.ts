import type { GatewayErrorCode } from "@ai-gateway/core-contracts";

/**
 * architecture §18.1. Note this is intentionally the *full* three-value set
 * (`"exponential" | "linear" | "none"`) exactly as architecture §18.1 defines
 * it — distinct from `@ai-gateway/config`'s `BackoffStrategy`, which is a
 * deployment-facing, operator-tunable subset (`"exponential" | "linear"`
 * only; see `docs/adr/0005-backoff-strategy-config-mismatch.md` for why
 * that's a documented, not-yet-resolved discrepancy rather than a defect
 * introduced here).
 */
export const BACKOFF_STRATEGIES = ["exponential", "linear", "none"] as const;
export type BackoffStrategy = (typeof BACKOFF_STRATEGIES)[number];

/**
 * architecture §18.1, verbatim shape. Governs one `RetryEngine.execute()`
 * call — every provider call the orchestrator (EM-4) makes against a single
 * plan step is expected to pass one of these.
 */
export interface RetryPolicy {
  /** Total attempts against this provider before giving up (>= 1). */
  maxAttempts: number;
  backoff: BackoffStrategy;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: boolean;
  /**
   * Which `GatewayErrorCode`s are worth retrying. architecture §18.1's
   * default retries only `RATE_LIMITED`/`TIMEOUT` — deterministic failures
   * like `CONTENT_FILTERED`/`INVALID_SCHEMA` are never in this list by
   * default, since retrying them wastes latency/cost for no benefit.
   */
  retryableErrorCodes: GatewayErrorCode[];
}

/**
 * architecture §18.1's stated default: 2 attempts per provider, exponential
 * backoff with full jitter, base 200ms, max 4s, retryable only on
 * `RATE_LIMITED`/`TIMEOUT`.
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 2,
  backoff: "exponential",
  baseDelayMs: 200,
  maxDelayMs: 4000,
  jitter: true,
  retryableErrorCodes: ["RATE_LIMITED", "TIMEOUT"],
};

/**
 * architecture §11 (`ProviderAdapter.healthCheck()` /
 * `HealthMonitor.getHealth()` — shape not spelled out there beyond the
 * return type name). Field-for-field identical to
 * `@ai-gateway/provider-sdk`'s `ProviderHealthSnapshot`, duplicated here
 * rather than imported for the same reason `provider-sdk` duplicates
 * `CredentialScope` rather than importing it from `@ai-gateway/config`
 * (architecture §11/EM-1 review precedent): `reliability`'s frozen
 * dependency edge (Blueprint §4.1) is `core-contracts`, `config`,
 * `telemetry` only — it must never depend on `providers/provider-sdk`, so
 * a package that needs the same shape defines its own copy rather than
 * introducing a disallowed edge. See this milestone's Engineering Decisions
 * for the explicit rationale.
 */
export interface ProviderHealthSnapshot {
  providerId: string;
  healthy: boolean;
  /** Round-trip latency of the health check itself, when it succeeded. */
  latencyMs?: number;
  /** ISO-8601 timestamp of when this snapshot was produced. */
  lastCheckedAt: string;
  /** Consecutive failed health checks/invocations, reset to 0 on success. */
  consecutiveFailures: number;
  /** Human-readable detail when `healthy` is false. */
  message?: string;
}

/**
 * architecture §11 (`HealthMonitor.reportFailure`'s `reason` parameter —
 * shape not spelled out there). Designed, not specified: carries enough
 * detail for the Health Monitor to distinguish failure kinds (a rate limit
 * is not evidence of the same kind of unhealthiness as a connection
 * timeout) without depending on `provider-sdk`'s `GatewayError` class
 * directly — `code` is enough for `HealthMonitor`'s own bookkeeping, and
 * translating a caught exception into this shape is the caller's job.
 */
export interface FailureReason {
  code: GatewayErrorCode;
  message?: string;
}

/** architecture §18.2. */
export const CIRCUIT_STATES = ["closed", "open", "half_open"] as const;
export type CircuitState = (typeof CIRCUIT_STATES)[number];

/**
 * Tuning knobs for the Circuit Breaker's per-key state machine (architecture
 * §18.2's illustrative "50% over 20 requests" / "30s cooldown" example,
 * generalized into configuration rather than hardcoded).
 */
export interface CircuitBreakerOptions {
  /** Failure rate (0-1) over the rolling window that trips the breaker `Closed -> Open`. */
  failureRateThreshold: number;
  /** Minimum number of requests in the rolling window before the failure rate is evaluated. */
  minimumRequests: number;
  /** Size of the rolling window, in number of most recent outcomes tracked per key. */
  rollingWindowSize: number;
  /** Cooldown before an `Open` breaker transitions to `HalfOpen` and allows one probe. */
  cooldownMs: number;
}

/** architecture §18.2's illustrative example, taken as the default. */
export const DEFAULT_CIRCUIT_BREAKER_OPTIONS: CircuitBreakerOptions = {
  failureRateThreshold: 0.5,
  minimumRequests: 20,
  rollingWindowSize: 20,
  cooldownMs: 30_000,
};

/**
 * Composes a stable per-`(providerId, modelClass)` Circuit Breaker /
 * Health Monitor key (Blueprint §8.5: "Circuit Breaker state machine per
 * `(providerId, modelClass)`"). Centralized here so every caller derives
 * the same key format — a hand-rolled template string at each call site
 * would risk silent key-format drift between `CircuitBreaker` and
 * `HealthMonitor` callers.
 */
export function providerModelClassKey(providerId: string, modelClass: string): string {
  return `${providerId}::${modelClass}`;
}
