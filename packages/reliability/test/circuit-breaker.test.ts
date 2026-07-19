import { describe, expect, it } from "vitest";
import { InMemoryCircuitBreaker } from "../src/circuit-breaker.js";
import { providerModelClassKey } from "../src/types.js";

const KEY = providerModelClassKey("groq", "fast-extraction");

describe("providerModelClassKey", () => {
  it("composes a stable, human-readable key", () => {
    expect(providerModelClassKey("groq", "fast-extraction")).toBe("groq::fast-extraction");
    expect(providerModelClassKey("nvidia-nim", "complex-reasoning")).toBe(
      "nvidia-nim::complex-reasoning",
    );
  });
});

describe("InMemoryCircuitBreaker", () => {
  it("starts closed for an unseen key", () => {
    const breaker = new InMemoryCircuitBreaker();
    expect(breaker.getState(KEY)).toBe("closed");
    expect(breaker.canProceed(KEY)).toBe(true);
  });

  it("stays closed below minimumRequests even with 100% failures", () => {
    const breaker = new InMemoryCircuitBreaker({ minimumRequests: 20 });
    for (let i = 0; i < 19; i++) breaker.recordFailure(KEY);
    expect(breaker.getState(KEY)).toBe("closed");
  });

  it("trips Closed -> Open once failure rate exceeds threshold at/after minimumRequests", () => {
    const breaker = new InMemoryCircuitBreaker({
      minimumRequests: 20,
      rollingWindowSize: 20,
      failureRateThreshold: 0.5,
    });
    // 11/20 = 55% failures > 50% threshold
    for (let i = 0; i < 11; i++) breaker.recordFailure(KEY);
    for (let i = 0; i < 9; i++) breaker.recordSuccess(KEY);

    expect(breaker.getState(KEY)).toBe("open");
    expect(breaker.canProceed(KEY)).toBe(false);
  });

  it("does not trip when failure rate is exactly at (not above) the threshold", () => {
    const breaker = new InMemoryCircuitBreaker({
      minimumRequests: 20,
      rollingWindowSize: 20,
      failureRateThreshold: 0.5,
    });
    // 10/20 = 50%, threshold is ">", not ">="
    for (let i = 0; i < 10; i++) breaker.recordFailure(KEY);
    for (let i = 0; i < 10; i++) breaker.recordSuccess(KEY);

    expect(breaker.getState(KEY)).toBe("closed");
  });

  it("transitions Open -> HalfOpen only after cooldown elapses", () => {
    let now = 0;
    const breaker = new InMemoryCircuitBreaker(
      { cooldownMs: 30_000, minimumRequests: 1 },
      () => now,
    );
    breaker.recordFailure(KEY); // trips immediately (rate 100% > default 50%, minimumRequests 1)
    expect(breaker.getState(KEY)).toBe("open");

    now = 29_999;
    expect(breaker.getState(KEY)).toBe("open");

    now = 30_000;
    expect(breaker.getState(KEY)).toBe("half_open");
  });

  it("admits exactly one probe while HalfOpen, rejecting concurrent others", () => {
    let now = 0;
    const breaker = new InMemoryCircuitBreaker({ cooldownMs: 1000, minimumRequests: 1 }, () => now);
    breaker.recordFailure(KEY);
    now = 1000; // now half_open

    expect(breaker.canProceed(KEY)).toBe(true); // the one probe
    expect(breaker.canProceed(KEY)).toBe(false); // concurrent second caller
    expect(breaker.canProceed(KEY)).toBe(false);
  });

  it("HalfOpen -> Closed when the probe succeeds", () => {
    let now = 0;
    const breaker = new InMemoryCircuitBreaker({ cooldownMs: 1000, minimumRequests: 1 }, () => now);
    breaker.recordFailure(KEY);
    now = 1000;
    expect(breaker.canProceed(KEY)).toBe(true);

    breaker.recordSuccess(KEY);

    expect(breaker.getState(KEY)).toBe("closed");
    expect(breaker.canProceed(KEY)).toBe(true);
  });

  it("HalfOpen -> Open when the probe fails, restarting the cooldown", () => {
    let now = 0;
    const breaker = new InMemoryCircuitBreaker({ cooldownMs: 1000, minimumRequests: 1 }, () => now);
    breaker.recordFailure(KEY);
    now = 1000;
    expect(breaker.canProceed(KEY)).toBe(true); // consumes the probe slot

    breaker.recordFailure(KEY);
    expect(breaker.getState(KEY)).toBe("open");

    // Cooldown restarted from `now` (1000), not from the original open time.
    now = 1999;
    expect(breaker.getState(KEY)).toBe("open");
    now = 2000;
    expect(breaker.getState(KEY)).toBe("half_open");
  });

  it("tracks independent state per key", () => {
    const breaker = new InMemoryCircuitBreaker({ minimumRequests: 1 });
    breaker.recordFailure("groq::fast-extraction");
    expect(breaker.getState("groq::fast-extraction")).toBe("open");
    expect(breaker.getState("nvidia-nim::fast-extraction")).toBe("closed");
  });

  it("lets old failures fall out of the rolling window as new outcomes arrive", () => {
    const breaker = new InMemoryCircuitBreaker({
      minimumRequests: 3,
      rollingWindowSize: 3,
      failureRateThreshold: 0.7,
    });
    breaker.recordFailure(KEY); // [F]
    breaker.recordFailure(KEY); // [F, F]
    breaker.recordSuccess(KEY); // [F, F, S] -> 2/3 = 0.667, not > 0.7: still closed
    expect(breaker.getState(KEY)).toBe("closed");

    breaker.recordSuccess(KEY); // window shifts: [F, S, S] -> 1/3 = 0.333
    expect(breaker.getState(KEY)).toBe("closed");

    breaker.recordSuccess(KEY); // window shifts again: [S, S, S] -> 0/3
    expect(breaker.getState(KEY)).toBe("closed");
  });
});
