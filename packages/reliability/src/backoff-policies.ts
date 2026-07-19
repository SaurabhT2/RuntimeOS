/**
 * Backoff delay calculation for the Retry Engine (architecture §18.1).
 *
 * Deliberately pure functions, not a class: each strategy is a
 * `(attempt, policy) -> delayMs` computation with no internal state,
 * which is what makes the property-based tests in
 * `test/retry-engine.property.test.ts` tractable (same inputs always
 * produce the same delay, jitter aside).
 */

import type { BackoffStrategy } from "./types.js";

/**
 * A splittable, seedable PRNG source used only for jitter. Injected so
 * tests can assert exact delay bounds without depending on `Math.random`'s
 * non-determinism (Blueprint §12 "every exported function... "; jitter
 * itself is still random by design — architecture §18.1 — but the *bounds*
 * are deterministic and that's what tests assert against).
 */
export type JitterSource = () => number;

/** Default jitter source: `Math.random()`, uniform on `[0, 1)`. */
export const defaultJitterSource: JitterSource = () => Math.random();

/**
 * Computes the backoff delay (in milliseconds) before retry attempt number
 * `attempt` (1-indexed: the delay before the *second* call overall is
 * `computeBackoffMs(1, ...)`), per architecture §18.1.
 *
 * - `"none"`: always `0` — no delay between attempts.
 * - `"linear"`: `min(baseDelayMs * attempt, maxDelayMs)`.
 * - `"exponential"`: `min(baseDelayMs * 2^(attempt - 1), maxDelayMs)`.
 *
 * When `jitter` is `true`, "full jitter" (architecture §18.1's default) is
 * applied: the final delay is a uniformly random value in
 * `[0, computedDelay]` rather than a fixed value, spreading out retries
 * from many concurrent callers to avoid a thundering herd against a
 * recovering provider.
 */
export function computeBackoffMs(
  attempt: number,
  policy: { backoff: BackoffStrategy; baseDelayMs: number; maxDelayMs: number; jitter: boolean },
  jitterSource: JitterSource = defaultJitterSource,
): number {
  if (attempt < 1) {
    throw new RangeError(`attempt must be >= 1, got ${attempt}`);
  }

  const raw = computeRawDelayMs(attempt, policy);
  if (!policy.jitter || raw === 0) {
    return raw;
  }
  return Math.floor(jitterSource() * raw);
}

function computeRawDelayMs(
  attempt: number,
  policy: { backoff: BackoffStrategy; baseDelayMs: number; maxDelayMs: number },
): number {
  switch (policy.backoff) {
    case "none":
      return 0;
    case "linear":
      return Math.min(policy.baseDelayMs * attempt, policy.maxDelayMs);
    case "exponential":
      return Math.min(policy.baseDelayMs * 2 ** (attempt - 1), policy.maxDelayMs);
    /* v8 ignore next 4 -- exhaustiveness guard, unreachable given BackoffStrategy's type */
    default: {
      const exhaustiveCheck: never = policy.backoff;
      throw new RangeError(`Unknown backoff strategy: ${String(exhaustiveCheck)}`);
    }
  }
}
