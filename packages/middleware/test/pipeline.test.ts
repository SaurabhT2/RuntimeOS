import { describe, expect, it, vi } from "vitest";
import type { ExecuteRequest, ExecuteResponse } from "@ai-gateway/core-contracts";
import { isGatewayError } from "@ai-gateway/core-contracts";
import { AuthMiddleware } from "../src/auth.js";
import { CacheMiddleware } from "../src/cache.js";
import { MiddlewarePipeline } from "../src/pipeline.js";
import { RateLimitMiddleware } from "../src/rate-limit.js";
import { fakeTelemetry } from "./fixtures.js";

const tenant = { organizationId: "org-1", workspaceId: "ws-1" };
const VALID_KEY = "sk-valid-key-12345";

function req(overrides: Partial<ExecuteRequest> = {}): ExecuteRequest {
  return {
    task: "summarization",
    input: { text: "hello" },
    tenant,
    ...overrides,
  };
}

function res(): ExecuteResponse {
  return {
    requestId: "r1",
    output: { text: "answer" },
    usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 },
    execution: {
      providerId: "groq",
      modelClass: "fast-extraction",
      latencyMs: 10,
      retries: 0,
      failedOver: false,
    },
    finishReason: "stop",
  };
}

function buildPipeline(overrides: { requestsPerWindow?: number } = {}) {
  const telemetry = fakeTelemetry();
  const auth = new AuthMiddleware({
    keys: [{ apiKey: VALID_KEY, tenant, role: "member" }],
    telemetry,
  });
  const rateLimit = new RateLimitMiddleware({
    requestsPerWindow: overrides.requestsPerWindow ?? 60,
    telemetry,
  });
  const cache = new CacheMiddleware({ telemetry });
  return new MiddlewarePipeline({ auth, rateLimit, cache });
}

describe("MiddlewarePipeline.run", () => {
  it("calls downstream and returns its response on a cache miss", async () => {
    const pipeline = buildPipeline();
    const downstream = vi.fn(async () => res());
    const response = await pipeline.run(req(), VALID_KEY, downstream);
    expect(response).toEqual(res());
    expect(downstream).toHaveBeenCalledTimes(1);
  });

  it("passes the resolved AuthContext through to downstream", async () => {
    const pipeline = buildPipeline();
    const downstream = vi.fn(async (_req: ExecuteRequest, auth) => {
      expect(auth.tenant).toEqual(tenant);
      expect(auth.role).toBe("member");
      return res();
    });
    await pipeline.run(req(), VALID_KEY, downstream);
    expect(downstream).toHaveBeenCalledTimes(1);
  });

  it("rejects with CREDENTIAL_INVALID and never calls downstream for an invalid key", async () => {
    const pipeline = buildPipeline();
    const downstream = vi.fn(async () => res());
    await expect(pipeline.run(req(), "wrong-key", downstream)).rejects.toSatisfy(
      (error: unknown) => isGatewayError(error) && error.code === "CREDENTIAL_INVALID",
    );
    expect(downstream).not.toHaveBeenCalled();
  });

  it("rejects with RATE_LIMITED and never calls downstream once quota is exhausted", async () => {
    const pipeline = buildPipeline({ requestsPerWindow: 1 });
    const downstream = vi.fn(async () => res());
    await pipeline.run(req(), VALID_KEY, downstream);
    await expect(pipeline.run(req(), VALID_KEY, downstream)).rejects.toSatisfy(
      (error: unknown) => isGatewayError(error) && error.code === "RATE_LIMITED",
    );
    expect(downstream).toHaveBeenCalledTimes(1);
  });

  it("returns a cached response on the second identical request without calling downstream again", async () => {
    const pipeline = buildPipeline();
    const downstream = vi.fn(async () => res());
    await pipeline.run(req(), VALID_KEY, downstream);
    await pipeline.run(req(), VALID_KEY, downstream);
    expect(downstream).toHaveBeenCalledTimes(1);
  });

  it("caches downstream's response after a miss, so a third call also skips downstream", async () => {
    const pipeline = buildPipeline();
    let calls = 0;
    const downstream = vi.fn(async () => {
      calls++;
      return { ...res(), requestId: `r${calls}` };
    });
    const first = await pipeline.run(req(), VALID_KEY, downstream);
    const second = await pipeline.run(req(), VALID_KEY, downstream);
    expect(second).toEqual(first);
    expect(downstream).toHaveBeenCalledTimes(1);
  });

  it("never caches a streaming request's response, so downstream is called every time", async () => {
    const pipeline = buildPipeline();
    const downstream = vi.fn(async () => res());
    const streamingReq = req({ constraints: { streaming: true } });
    await pipeline.run(streamingReq, VALID_KEY, downstream);
    await pipeline.run(streamingReq, VALID_KEY, downstream);
    expect(downstream).toHaveBeenCalledTimes(2);
  });
});
