/**
 * architecture §31.2's `ExecutionProfile.retryPolicy` field is annotated
 * "Section 18.1 type, reused as-is" — that type is `@ai-gateway/reliability`'s
 * `RetryPolicy`. This package cannot import it directly: its frozen
 * dependency edge (Blueprint §4.1) is `config`, `core-contracts` only, and
 * `reliability` is not on that list (nor should it be — `reliability` is a
 * Wave 2 provider-routing concern, unrelated to this package's Wave 6
 * "how should this task run" concern; adding the edge purely to borrow a
 * type would be exactly the kind of unnecessary coupling ADR-008 argues
 * against introducing between "how" and "where").
 *
 * Field-for-field identical to `@ai-gateway/reliability`'s `RetryPolicy`/
 * `BackoffStrategy` (`packages/reliability/src/types.ts`) — duplicated
 * here rather than redesigned, following the same precedent that package
 * itself established for `ProviderHealthSnapshot`. Whoever constructs a
 * `ResolvedExecutionProfile` and hands it to `reliability`'s `RetryEngine`
 * (future `strategy-layer`/`orchestrator` wiring, EM-8) is responsible for
 * the identity mapping between the two — trivial, since the shapes match
 * exactly.
 */
import type { GatewayErrorCode } from "@ai-gateway/core-contracts";

export const BACKOFF_STRATEGIES = ["exponential", "linear", "none"] as const;
export type BackoffStrategy = (typeof BACKOFF_STRATEGIES)[number];

export interface RetryPolicy {
  maxAttempts: number;
  backoff: BackoffStrategy;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: boolean;
  /**
   * `core-contracts` *is* an allowed dependency for this package (Blueprint
   * §4.1), so `GatewayErrorCode` is imported directly rather than
   * duplicated — unlike `reliability`, importing it introduces no
   * disallowed edge.
   */
  retryableErrorCodes: GatewayErrorCode[];
}

/** architecture §18.1's stated default, duplicated for the same reason as the types above. */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 2,
  backoff: "exponential",
  baseDelayMs: 200,
  maxDelayMs: 4000,
  jitter: true,
  retryableErrorCodes: ["RATE_LIMITED", "TIMEOUT"],
};
