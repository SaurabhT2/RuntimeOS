import { describe, expect, it } from "vitest";
import { computeBackoffMs } from "../src/backoff-policies.js";
import type { RetryPolicy } from "../src/types.js";

const basePolicy: Pick<RetryPolicy, "backoff" | "baseDelayMs" | "maxDelayMs" | "jitter"> = {
  backoff: "exponential",
  baseDelayMs: 200,
  maxDelayMs: 4000,
  jitter: false,
};

describe("computeBackoffMs", () => {
  it("returns 0 for backoff 'none' regardless of attempt", () => {
    expect(computeBackoffMs(1, { ...basePolicy, backoff: "none" })).toBe(0);
    expect(computeBackoffMs(5, { ...basePolicy, backoff: "none" })).toBe(0);
  });

  it("computes linear backoff as baseDelayMs * attempt, capped at maxDelayMs", () => {
    const policy = { ...basePolicy, backoff: "linear" as const, maxDelayMs: 1000 };
    expect(computeBackoffMs(1, policy)).toBe(200);
    expect(computeBackoffMs(2, policy)).toBe(400);
    expect(computeBackoffMs(3, policy)).toBe(600);
    expect(computeBackoffMs(10, policy)).toBe(1000); // capped
  });

  it("computes exponential backoff as baseDelayMs * 2^(attempt-1), capped at maxDelayMs", () => {
    const policy = { ...basePolicy, backoff: "exponential" as const };
    expect(computeBackoffMs(1, policy)).toBe(200);
    expect(computeBackoffMs(2, policy)).toBe(400);
    expect(computeBackoffMs(3, policy)).toBe(800);
    expect(computeBackoffMs(4, policy)).toBe(1600);
    expect(computeBackoffMs(5, policy)).toBe(3200);
    expect(computeBackoffMs(6, policy)).toBe(4000); // capped (would be 6400)
  });

  it("throws for attempt < 1", () => {
    expect(() => computeBackoffMs(0, basePolicy)).toThrow(RangeError);
    expect(() => computeBackoffMs(-1, basePolicy)).toThrow(RangeError);
  });

  it("applies full jitter within [0, computedDelay] using the injected jitter source", () => {
    const policy = { ...basePolicy, backoff: "linear" as const, jitter: true };
    // jitterSource returning 0 -> delay 0
    expect(computeBackoffMs(2, policy, () => 0)).toBe(0);
    // jitterSource returning close to 1 -> delay close to (but < ) the raw delay
    expect(computeBackoffMs(2, policy, () => 0.999999)).toBe(399);
    // jitterSource returning 0.5 -> exactly half the raw delay
    expect(computeBackoffMs(2, policy, () => 0.5)).toBe(200);
  });

  it("skips jitter entirely when the raw delay is already 0 (backoff 'none')", () => {
    const policy = { ...basePolicy, backoff: "none" as const, jitter: true };
    // If jitter were (incorrectly) applied to a 0 delay, floor(x * 0) is
    // still 0, so this specifically checks the jitter source is never even
    // invoked, not just that the result matches.
    let called = false;
    computeBackoffMs(1, policy, () => {
      called = true;
      return 0.5;
    });
    expect(called).toBe(false);
  });
});
