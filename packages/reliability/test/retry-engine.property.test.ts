import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { GatewayError, type GatewayErrorCode } from "@ai-gateway/core-contracts";
import { DefaultRetryEngine } from "../src/retry-engine.js";
import { computeBackoffMs } from "../src/backoff-policies.js";
import type { RetryPolicy } from "../src/types.js";

/**
 * architecture §24: "Property-based tests: inject failure sequences and
 * assert retry counts, backoff timing, and circuit state transitions match
 * policy exactly." This file covers the Retry Engine's share of that row
 * (`test/circuit-breaker.test.ts` covers state transitions).
 */

const retryablePolicyArb = fc
  .record({
    maxAttempts: fc.integer({ min: 1, max: 6 }),
    backoff: fc.constantFrom<RetryPolicy["backoff"]>("exponential", "linear", "none"),
    baseDelayMs: fc.integer({ min: 1, max: 500 }),
    maxDelayMs: fc.integer({ min: 500, max: 5000 }),
    jitter: fc.constant(false), // deterministic delays for exact-timing assertions
  })
  .map((policy) => ({ ...policy, retryableErrorCodes: ["TIMEOUT"] as GatewayErrorCode[] }));

/** A failure sequence: how many times `fn` should fail before succeeding, capped generously above any generated `maxAttempts`. */
const failuresBeforeSuccessArb = fc.integer({ min: 0, max: 8 });

describe("DefaultRetryEngine (property-based, architecture §24)", () => {
  it("calls fn exactly min(failuresBeforeSuccess + 1, maxAttempts) times, and sleeps exactly that many minus one, with exact backoff timing", async () => {
    await fc.assert(
      fc.asyncProperty(
        retryablePolicyArb,
        failuresBeforeSuccessArb,
        async (policy, failuresBeforeSuccess) => {
          const sleeps: number[] = [];
          const engine = new DefaultRetryEngine({
            sleep: async (ms) => {
              sleeps.push(ms);
            },
          });

          let calls = 0;
          const fn = async (): Promise<string> => {
            calls += 1;
            if (calls <= failuresBeforeSuccess) {
              throw new GatewayError("TIMEOUT", "injected failure", true);
            }
            return "ok";
          };

          const expectedCalls = Math.min(failuresBeforeSuccess + 1, policy.maxAttempts);
          const willSucceed = failuresBeforeSuccess < policy.maxAttempts;

          if (willSucceed) {
            const result = await engine.execute(fn, policy);
            expect(result).toBe("ok");
          } else {
            await expect(engine.execute(fn, policy)).rejects.toBeInstanceOf(GatewayError);
          }

          expect(calls).toBe(expectedCalls);

          // The engine skips calling `sleep` entirely when the computed delay
          // is 0 (see `DefaultRetryEngine.execute`'s `if (delayMs > 0)` guard,
          // and the "skips sleeping when backoff is 'none'" unit test) — so
          // the expected sleep log only includes the *nonzero* delays.
          const allDelays = Array.from({ length: expectedCalls - 1 }, (_, i) =>
            computeBackoffMs(i + 1, { ...policy, jitter: false }),
          );
          const expectedSleeps = allDelays.filter((d) => d > 0);
          expect(sleeps).toEqual(expectedSleeps);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("never retries a non-retryable error, regardless of policy", async () => {
    await fc.assert(
      fc.asyncProperty(retryablePolicyArb, async (policy) => {
        const sleeps: number[] = [];
        const engine = new DefaultRetryEngine({
          sleep: async (ms) => {
            sleeps.push(ms);
          },
        });
        let calls = 0;
        const err = new GatewayError("CONTENT_FILTERED", "deterministic failure", false);
        const fn = async (): Promise<never> => {
          calls += 1;
          throw err;
        };

        await expect(engine.execute(fn, policy)).rejects.toBe(err);
        expect(calls).toBe(1);
        expect(sleeps).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});
