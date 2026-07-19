import { describe, expect, it } from "vitest";
import { isGatewayError } from "@ai-gateway/core-contracts";
import { RateLimitMiddleware } from "../src/rate-limit.js";
import { fakeTelemetry } from "./fixtures.js";

const tenantA = { organizationId: "org-a", workspaceId: "ws-a" };
const tenantB = { organizationId: "org-b", workspaceId: "ws-b" };

describe("RateLimitMiddleware.check", () => {
  it("allows requests up to the configured window size", () => {
    const rl = new RateLimitMiddleware({
      requestsPerWindow: 3,
      windowMs: 60_000,
      telemetry: fakeTelemetry(),
      now: () => 0,
    });
    expect(rl.check(tenantA).allowed).toBe(true);
    expect(rl.check(tenantA).allowed).toBe(true);
    expect(rl.check(tenantA).allowed).toBe(true);
  });

  it("rejects the request once the window is exhausted", () => {
    const rl = new RateLimitMiddleware({
      requestsPerWindow: 2,
      windowMs: 60_000,
      telemetry: fakeTelemetry(),
      now: () => 0,
    });
    rl.check(tenantA);
    rl.check(tenantA);
    const result = rl.check(tenantA);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("isolates buckets per tenant scope — one tenant's exhaustion never affects another's quota", () => {
    const rl = new RateLimitMiddleware({
      requestsPerWindow: 1,
      windowMs: 60_000,
      telemetry: fakeTelemetry(),
      now: () => 0,
    });
    expect(rl.check(tenantA).allowed).toBe(true);
    expect(rl.check(tenantA).allowed).toBe(false);
    expect(rl.check(tenantB).allowed).toBe(true);
  });

  it("refills continuously as time passes", () => {
    let now = 0;
    const rl = new RateLimitMiddleware({
      requestsPerWindow: 60,
      windowMs: 60_000,
      telemetry: fakeTelemetry(),
      now: () => now,
    });
    for (let i = 0; i < 60; i++) rl.check(tenantA);
    expect(rl.check(tenantA).allowed).toBe(false);
    now = 30_000; // half the window has elapsed -> ~30 tokens refilled
    const result = rl.check(tenantA);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeGreaterThan(20);
  });

  it("scopes by workspaceId when present, falling back to organizationId alone otherwise", () => {
    const rl = new RateLimitMiddleware({
      requestsPerWindow: 1,
      windowMs: 60_000,
      telemetry: fakeTelemetry(),
      now: () => 0,
    });
    expect(rl.check({ organizationId: "org-c" }).allowed).toBe(true);
    // A different workspace under the same org gets its own bucket...
    expect(rl.check({ organizationId: "org-c", workspaceId: "ws-x" }).allowed).toBe(true);
    // ...but a second request with no workspaceId at all shares the first bucket.
    expect(rl.check({ organizationId: "org-c" }).allowed).toBe(false);
  });
});

describe("RateLimitMiddleware.checkOrThrow", () => {
  it("does not throw while under quota", () => {
    const rl = new RateLimitMiddleware({
      requestsPerWindow: 2,
      windowMs: 60_000,
      telemetry: fakeTelemetry(),
      now: () => 0,
    });
    expect(() => rl.checkOrThrow(tenantA)).not.toThrow();
  });

  it("throws a retryable RATE_LIMITED GatewayError once quota is exhausted", () => {
    const rl = new RateLimitMiddleware({
      requestsPerWindow: 1,
      windowMs: 60_000,
      telemetry: fakeTelemetry(),
      now: () => 0,
    });
    rl.checkOrThrow(tenantA);
    try {
      rl.checkOrThrow(tenantA);
      expect.unreachable();
    } catch (error) {
      expect(isGatewayError(error)).toBe(true);
      if (isGatewayError(error)) {
        expect(error.code).toBe("RATE_LIMITED");
        expect(error.retryable).toBe(true);
      }
    }
  });
});
