import { describe, expect, it } from "vitest";
import type { ExecuteRequest, ExecuteResponse } from "@ai-gateway/core-contracts";
import { CacheMiddleware } from "../src/cache.js";
import { fakeTelemetry } from "./fixtures.js";

function req(overrides: Partial<ExecuteRequest> = {}): ExecuteRequest {
  return {
    task: "summarization",
    input: { text: "hello" },
    tenant: { organizationId: "org-1", workspaceId: "ws-1" },
    ...overrides,
  };
}

function res(overrides: Partial<ExecuteResponse> = {}): ExecuteResponse {
  return {
    requestId: "r1",
    output: { text: "cached answer" },
    usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 },
    execution: {
      providerId: "groq",
      modelClass: "fast-extraction",
      latencyMs: 10,
      retries: 0,
      failedOver: false,
    },
    finishReason: "stop",
    ...overrides,
  };
}

describe("CacheMiddleware", () => {
  it("misses on an empty cache", () => {
    const cache = new CacheMiddleware({ telemetry: fakeTelemetry() });
    expect(cache.get(req())).toBeUndefined();
  });

  it("hits after set() for an identical request", () => {
    const cache = new CacheMiddleware({ telemetry: fakeTelemetry() });
    cache.set(req(), res());
    expect(cache.get(req())).toEqual(res());
  });

  it("misses for a request with different input", () => {
    const cache = new CacheMiddleware({ telemetry: fakeTelemetry() });
    cache.set(req({ input: { text: "hello" } }), res());
    expect(cache.get(req({ input: { text: "goodbye" } }))).toBeUndefined();
  });

  it("isolates cache entries by tenant scope by default (architecture §20.4)", () => {
    const cache = new CacheMiddleware({ telemetry: fakeTelemetry() });
    cache.set(req({ tenant: { organizationId: "org-1" } }), res());
    expect(cache.get(req({ tenant: { organizationId: "org-2" } }))).toBeUndefined();
  });

  it("shares cache entries across tenants when includeTenantInKey is false", () => {
    const cache = new CacheMiddleware({ telemetry: fakeTelemetry(), includeTenantInKey: false });
    cache.set(req({ tenant: { organizationId: "org-1" } }), res());
    expect(cache.get(req({ tenant: { organizationId: "org-2" } }))).toEqual(res());
  });

  it("expires an entry after its TTL elapses", () => {
    let now = 0;
    const cache = new CacheMiddleware({ telemetry: fakeTelemetry(), ttlMs: 1000, now: () => now });
    cache.set(req(), res());
    now = 500;
    expect(cache.get(req())).toEqual(res());
    now = 1001;
    expect(cache.get(req())).toBeUndefined();
  });

  it("never caches a streaming request — set() is a no-op and get() always misses", () => {
    const cache = new CacheMiddleware({ telemetry: fakeTelemetry() });
    const streamingReq = req({ constraints: { streaming: true } });
    cache.set(streamingReq, res());
    expect(cache.get(streamingReq)).toBeUndefined();
  });

  it("clear() evicts every entry", () => {
    const cache = new CacheMiddleware({ telemetry: fakeTelemetry() });
    cache.set(req(), res());
    cache.clear();
    expect(cache.get(req())).toBeUndefined();
  });

  it("treats requests differing only in requestId/correlationId/preferences as the same cache entry", () => {
    const cache = new CacheMiddleware({ telemetry: fakeTelemetry() });
    cache.set(req({ requestId: "a", preferences: { prioritize: "cost" } }), res());
    expect(cache.get(req({ requestId: "b", preferences: { prioritize: "latency" } }))).toEqual(
      res(),
    );
  });
});
