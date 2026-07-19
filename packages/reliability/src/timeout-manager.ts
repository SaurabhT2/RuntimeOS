/**
 * Timeout Manager (architecture §18.4, Blueprint §8.5's `timeout-manager.ts`).
 *
 * Not named as an explicit interface in architecture §11 (only `RetryEngine`
 * and `HealthMonitor` are spelled out there) — Blueprint §8.5 names the file
 * and its role ("Timeout Manager") without a method signature, so this
 * interface is designed, not specified, per the same convention as
 * `CircuitBreaker` (see that file's docs).
 */

import { GatewayError } from "@ai-gateway/core-contracts";

export interface TimeoutManager {
  /**
   * Races `work` against `timeoutMs`. Resolves/rejects with whatever `work`
   * settles to if it settles first; otherwise rejects with a
   * `GatewayError("TIMEOUT", ...)`.
   *
   * **Cancellation caveat (see `docs/adr/0004-provider-adapter-cancellation-draft.md`):**
   * this method gives up *waiting* on `work` when the deadline passes — it
   * does not, and cannot, stop `work` itself from continuing to run,
   * because `reliability` operates on a plain `Promise<T>` with no
   * cancellation primitive to invoke. For a `Promise` produced by
   * `ProviderAdapter.invoke()`, true in-flight cancellation is blocked on
   * ADR-0004 being resolved and `ProviderAdapter` gaining an `AbortSignal`/
   * `abort()` — this is the same pre-existing architecture gap the EM-1
   * closure review carried forward as a precondition for Reliability, not
   * a new limitation introduced here.
   */
  withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T>;
}

export class DefaultTimeoutManager implements TimeoutManager {
  withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
    if (timeoutMs <= 0) {
      // Rejected, not thrown: `withTimeout` always returns a Promise, so
      // every caller can use a single `.catch`/`await`-`try` path regardless
      // of whether the failure is a bad argument or a real timeout.
      return Promise.reject(new RangeError(`timeoutMs must be > 0, got ${timeoutMs}`));
    }

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new GatewayError("TIMEOUT", `Exceeded timeoutMs=${timeoutMs}`, true));
      }, timeoutMs);
      timer.unref?.();

      work.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }
}
