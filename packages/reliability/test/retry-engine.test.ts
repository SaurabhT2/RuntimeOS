import { describe, expect, it, vi } from "vitest";
import { GatewayError } from "@ai-gateway/core-contracts";
import { DefaultRetryEngine } from "../src/retry-engine.js";
import { DEFAULT_RETRY_POLICY, type RetryPolicy } from "../src/types.js";

function policy(overrides: Partial<RetryPolicy> = {}): RetryPolicy {
  return { ...DEFAULT_RETRY_POLICY, ...overrides };
}

describe("DefaultRetryEngine", () => {
  it("returns the result on first success without sleeping", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const engine = new DefaultRetryEngine({ sleep });
    const fn = vi.fn().mockResolvedValue("ok");

    const result = await engine.execute(fn, policy());

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries a retryable error up to maxAttempts, then succeeds", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const engine = new DefaultRetryEngine({ sleep, jitterSource: () => 1 });
    let calls = 0;
    const fn = vi.fn().mockImplementation(async () => {
      calls += 1;
      if (calls < 3) {
        throw new GatewayError("RATE_LIMITED", "slow down", true);
      }
      return "ok";
    });

    const result = await engine.execute(fn, policy({ maxAttempts: 5 }));

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("throws the final error once maxAttempts is exhausted", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const engine = new DefaultRetryEngine({ sleep });
    const err = new GatewayError("TIMEOUT", "too slow", true);
    const fn = vi.fn().mockRejectedValue(err);

    await expect(engine.execute(fn, policy({ maxAttempts: 3 }))).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-retryable GatewayError code", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const engine = new DefaultRetryEngine({ sleep });
    const err = new GatewayError("CONTENT_FILTERED", "blocked", false);
    const fn = vi.fn().mockRejectedValue(err);

    await expect(engine.execute(fn, policy({ maxAttempts: 5 }))).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("does not retry a thrown value that is not a GatewayError", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const engine = new DefaultRetryEngine({ sleep });
    const err = new Error("boom");
    const fn = vi.fn().mockRejectedValue(err);

    await expect(engine.execute(fn, policy({ maxAttempts: 5 }))).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("skips sleeping when backoff is 'none'", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const engine = new DefaultRetryEngine({ sleep });
    let calls = 0;
    const fn = vi.fn().mockImplementation(async () => {
      calls += 1;
      if (calls < 2) throw new GatewayError("TIMEOUT", "slow", true);
      return "ok";
    });

    await engine.execute(fn, policy({ backoff: "none", maxAttempts: 3 }));

    expect(sleep).not.toHaveBeenCalled();
  });

  it("uses a real (unmocked) sleep by default and still completes retries", async () => {
    const engine = new DefaultRetryEngine(); // no injected `sleep` — exercises the real setTimeout path
    let calls = 0;
    const fn = vi.fn().mockImplementation(async () => {
      calls += 1;
      if (calls < 2) throw new GatewayError("TIMEOUT", "slow", true);
      return "ok";
    });

    const result = await engine.execute(
      fn,
      policy({ maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 }),
    );

    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("DEFAULT_RETRY_POLICY matches architecture §18.1's stated default", () => {
    expect(DEFAULT_RETRY_POLICY).toEqual({
      maxAttempts: 2,
      backoff: "exponential",
      baseDelayMs: 200,
      maxDelayMs: 4000,
      jitter: true,
      retryableErrorCodes: ["RATE_LIMITED", "TIMEOUT"],
    });
  });

  it("rejects a policy with maxAttempts < 1 before calling fn", async () => {
    const engine = new DefaultRetryEngine();
    const fn = vi.fn();

    await expect(engine.execute(fn, policy({ maxAttempts: 0 }))).rejects.toThrow(RangeError);
    expect(fn).not.toHaveBeenCalled();
  });
});
