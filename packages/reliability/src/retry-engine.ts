/**
 * Retry Engine (architecture §18.1, §11's `RetryEngine` interface,
 * verbatim).
 */

import { isGatewayError, type GatewayError } from "@ai-gateway/core-contracts";
import type { RetryPolicy } from "./types.js";
import { computeBackoffMs, type JitterSource } from "./backoff-policies.js";

/** architecture §11, verbatim. */
export interface RetryEngine {
  execute<T>(fn: () => Promise<T>, policy: RetryPolicy): Promise<T>;
}

/** Injected in tests so retry timing can be asserted without real wall-clock delays. */
export type SleepFn = (ms: number) => Promise<void>;

const realSleep: SleepFn = (ms) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });

export interface RetryEngineOptions {
  /** Overrides the delay function. Defaults to a real `setTimeout`-based sleep. */
  sleep?: SleepFn;
  /** Overrides the jitter source `computeBackoffMs` uses. Defaults to `Math.random`. */
  jitterSource?: JitterSource;
}

/**
 * Whether `error` is eligible for retry under `policy`. Retry eligibility is
 * defined purely in terms of `GatewayErrorCode` membership in
 * `policy.retryableErrorCodes` (architecture §18.1) — a thrown value that
 * isn't a `GatewayError` at all is never retried, since translating raw
 * exceptions into `GatewayError` is the adapter boundary's job (architecture
 * §19.2), not the Retry Engine's. This keeps `RetryEngine` a pure
 * policy-execution seam: it does not itself classify errors, only consults
 * a classification its caller already produced.
 */
function isRetryable(error: unknown, policy: RetryPolicy): error is GatewayError {
  return isGatewayError(error) && policy.retryableErrorCodes.includes(error.code);
}

/**
 * Default `RetryEngine`: retries `fn` up to `policy.maxAttempts` times total
 * (the first call plus `maxAttempts - 1` retries), waiting
 * `computeBackoffMs` between attempts, and only for errors the policy
 * marks retryable. The last failure (retryable or not) is always the one
 * re-thrown to the caller — this preserves the original error's `code` for
 * whatever failover logic (Policy Engine, EM-3) runs next, rather than
 * wrapping it in a generic "retries exhausted" error.
 */
export class DefaultRetryEngine implements RetryEngine {
  private readonly sleep: SleepFn;
  private readonly jitterSource: JitterSource | undefined;

  constructor(options: RetryEngineOptions = {}) {
    this.sleep = options.sleep ?? realSleep;
    this.jitterSource = options.jitterSource;
  }

  async execute<T>(fn: () => Promise<T>, policy: RetryPolicy): Promise<T> {
    if (policy.maxAttempts < 1) {
      throw new RangeError(`policy.maxAttempts must be >= 1, got ${policy.maxAttempts}`);
    }

    let attempt = 1;
    for (;;) {
      try {
        return await fn();
      } catch (error) {
        const exhausted = attempt >= policy.maxAttempts;
        if (exhausted || !isRetryable(error, policy)) {
          throw error;
        }
        const delayMs = this.jitterSource
          ? computeBackoffMs(attempt, policy, this.jitterSource)
          : computeBackoffMs(attempt, policy);
        if (delayMs > 0) {
          await this.sleep(delayMs);
        }
        attempt += 1;
      }
    }
  }
}
