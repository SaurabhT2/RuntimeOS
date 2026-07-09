import { describe, expect, it } from "vitest";
import { isGatewayError } from "@ai-gateway/core-contracts";
import { TokenBucketRateLimiter } from "../src/rate-limiter.js";

function fakeClock(startMs = 0) {
  let now = startMs;
  return {
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
  };
}

describe("TokenBucketRateLimiter", () => {
  it("allows a request immediately when there is headroom", async () => {
    const clock = fakeClock();
    const limiter = new TokenBucketRateLimiter({
      requestsPerMinute: 30,
      tokensPerMinute: 6000,
      now: clock.now,
      sleep: async () => {
        throw new Error("should not sleep when headroom exists");
      },
    });
    await expect(limiter.acquire(100, 5000)).resolves.toBeUndefined();
  });

  it("waits (via the injected sleep) when the token bucket is exhausted, then succeeds", async () => {
    const clock = fakeClock();
    let sleptMs: number | undefined;
    const limiter = new TokenBucketRateLimiter({
      requestsPerMinute: 6000,
      tokensPerMinute: 60,
      now: clock.now,
      sleep: async (ms) => {
        sleptMs = ms;
        clock.advance(ms);
      },
    });

    await limiter.acquire(60, 40_000); // exhausts the 60-token bucket
    await limiter.acquire(30, 40_000); // needs to wait for partial refill

    expect(sleptMs).toBeGreaterThan(0);
  });

  it("fails fast with a retryable RATE_LIMITED GatewayError when the wait would exceed timeoutMs", async () => {
    const clock = fakeClock();
    const limiter = new TokenBucketRateLimiter({
      requestsPerMinute: 6000,
      tokensPerMinute: 60,
      now: clock.now,
      sleep: async () => {
        throw new Error("should not actually sleep past the deadline");
      },
    });

    await limiter.acquire(60, 10_000); // exhausts the bucket
    await expect(limiter.acquire(60, 100)).rejects.toSatisfy(
      (error: unknown) => isGatewayError(error) && error.code === "RATE_LIMITED" && error.retryable,
    );
  });

  it("treats an unconfigured dimension (undefined limit) as unbounded", async () => {
    const clock = fakeClock();
    const limiter = new TokenBucketRateLimiter({ requestsPerMinute: 30, now: clock.now });
    // No tokensPerMinute configured: an enormous token estimate must not
    // block or fail regardless of how large it is.
    await expect(limiter.acquire(1_000_000, 1000)).resolves.toBeUndefined();
  });

  it("refills over time, allowing a second burst after enough elapsed time", async () => {
    const clock = fakeClock();
    const limiter = new TokenBucketRateLimiter({
      requestsPerMinute: 60,
      now: clock.now,
      sleep: async () => {},
    });
    await limiter.acquire(1, 1000); // 1 of 60 requests/min used, 59 left of headroom instantly
    for (let i = 0; i < 58; i++) {
      await limiter.acquire(1, 1000);
    }
    // Bucket now fully exhausted; advance a full minute and it should be
    // available again without external intervention.
    clock.advance(60_000);
    await expect(limiter.acquire(1, 1000)).resolves.toBeUndefined();
  });
});
