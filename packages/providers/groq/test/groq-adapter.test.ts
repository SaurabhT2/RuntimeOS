import { describe, expect, it } from "vitest";
import { isGatewayError } from "@ai-gateway/core-contracts";
import type { NormalizedInvocation, ScopedCredential } from "@ai-gateway/provider-sdk";
import { GroqAdapter } from "../src/groq-adapter.js";
import { TokenBucketRateLimiter } from "../src/rate-limiter.js";
import { createFakeFetch } from "./fake-fetch.js";

const credential: ScopedCredential = { key: "test-key", scope: "workspace" };

function invocation(overrides: Partial<NormalizedInvocation> = {}): NormalizedInvocation {
  return {
    modelId: "llama-3.1-8b-instant",
    messages: [{ role: "user", content: "hello" }],
    temperature: 0.5,
    maxOutputTokens: 128,
    stream: false,
    timeoutMs: 5000,
    ...overrides,
  };
}

function unlimitedRateLimiter(): TokenBucketRateLimiter {
  return new TokenBucketRateLimiter({});
}

describe("GroqAdapter.invoke", () => {
  it("sends a well-formed request and translates a successful response", async () => {
    const { fetch: fetchImpl, requests } = createFakeFetch([
      {
        kind: "json",
        status: 200,
        body: {
          id: "chatcmpl-1",
          choices: [
            { index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        },
      },
    ]);
    const adapter = new GroqAdapter({ fetchImpl, rateLimiter: unlimitedRateLimiter() });

    const result = await adapter.invoke(invocation(), credential);

    expect(result.text).toBe("hi");
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 2 });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(requests[0]!.headers["Authorization"]).toBe("Bearer test-key");
    expect(requests[0]!.body).toMatchObject({ model: "llama-3.1-8b-instant", stream: false });
  });

  it("rejects with CREDENTIAL_INVALID for an empty key, without making a network call", async () => {
    const { fetch: fetchImpl, requests } = createFakeFetch([]);
    const adapter = new GroqAdapter({ fetchImpl, rateLimiter: unlimitedRateLimiter() });

    await expect(adapter.invoke(invocation(), { key: "", scope: "workspace" })).rejects.toSatisfy(
      (error: unknown) => isGatewayError(error) && error.code === "CREDENTIAL_INVALID",
    );
    expect(requests).toHaveLength(0);
  });

  it("translates a 429 HTTP response into a retryable RATE_LIMITED GatewayError", async () => {
    const { fetch: fetchImpl } = createFakeFetch([
      { kind: "json", status: 429, body: { error: { message: "too fast" } } },
    ]);
    const adapter = new GroqAdapter({ fetchImpl, rateLimiter: unlimitedRateLimiter() });

    await expect(adapter.invoke(invocation(), credential)).rejects.toSatisfy(
      (error: unknown) => isGatewayError(error) && error.code === "RATE_LIMITED" && error.retryable,
    );
  });

  it("translates an aborted (timed-out) request into a GatewayError TIMEOUT", async () => {
    const { fetch: fetchImpl } = createFakeFetch([{ kind: "hang" }]);
    const adapter = new GroqAdapter({ fetchImpl, rateLimiter: unlimitedRateLimiter() });

    await expect(adapter.invoke(invocation({ timeoutMs: 20 }), credential)).rejects.toSatisfy(
      (error: unknown) => isGatewayError(error) && error.code === "TIMEOUT" && error.retryable,
    );
  });

  it("never lets a raw network exception escape", async () => {
    const { fetch: fetchImpl } = createFakeFetch([
      { kind: "throw", error: new Error("ECONNRESET") },
    ]);
    const adapter = new GroqAdapter({ fetchImpl, rateLimiter: unlimitedRateLimiter() });

    await expect(adapter.invoke(invocation(), credential)).rejects.toSatisfy(
      (error: unknown) => isGatewayError(error) && error.code === "INTERNAL_ERROR",
    );
  });

  it("fails fast with RATE_LIMITED when the injected rate limiter has no headroom, without calling fetch", async () => {
    const { fetch: fetchImpl, requests } = createFakeFetch([]);
    const rateLimiter = new TokenBucketRateLimiter({
      requestsPerMinute: 1,
      now: () => 0,
      sleep: async () => {
        throw new Error("should not sleep");
      },
    });
    await rateLimiter.acquire(1, 1000); // consume the only unit of headroom
    const adapter = new GroqAdapter({ fetchImpl, rateLimiter });

    await expect(adapter.invoke(invocation({ timeoutMs: 50 }), credential)).rejects.toSatisfy(
      (error: unknown) => isGatewayError(error) && error.code === "RATE_LIMITED",
    );
    expect(requests).toHaveLength(0);
  });
});

describe("GroqAdapter.invokeStream", () => {
  async function collect(adapter: GroqAdapter, req = invocation({ stream: true })) {
    const chunks = [];
    for await (const chunk of adapter.invokeStream(req, credential)) {
      chunks.push(chunk);
    }
    return chunks;
  }

  it("streams text deltas ending in exactly one terminal chunk", async () => {
    const { fetch: fetchImpl } = createFakeFetch([
      {
        kind: "sse",
        status: 200,
        frames: [
          'data: {"id":"1","choices":[{"index":0,"delta":{"content":"He"},"finish_reason":null}]}\n\n',
          'data: {"id":"1","choices":[{"index":0,"delta":{"content":"llo"},"finish_reason":null}]}\n\n',
          'data: {"id":"1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}\n\n',
          "data: [DONE]\n\n",
        ],
      },
    ]);
    const adapter = new GroqAdapter({ fetchImpl, rateLimiter: unlimitedRateLimiter() });

    const chunks = await collect(adapter);

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toEqual({ delta: { text: "He" }, done: false });
    expect(chunks[1]).toEqual({ delta: { text: "llo" }, done: false });
    expect(chunks[2]).toMatchObject({
      done: true,
      finishReason: "stop",
      usage: { inputTokens: 1, outputTokens: 2 },
    });
  });

  it("translates a malformed (non-JSON) SSE frame into a GatewayError, never a raw parse exception", async () => {
    const { fetch: fetchImpl } = createFakeFetch([
      { kind: "sse", status: 200, frames: ["data: not-json\n\n"] },
    ]);
    const adapter = new GroqAdapter({ fetchImpl, rateLimiter: unlimitedRateLimiter() });

    await expect(collect(adapter)).rejects.toSatisfy(
      (error: unknown) => isGatewayError(error) && error.code === "INTERNAL_ERROR",
    );
  });

  it("translates a stream that ends without a terminal chunk into a GatewayError", async () => {
    const { fetch: fetchImpl } = createFakeFetch([
      {
        kind: "sse",
        status: 200,
        frames: [
          'data: {"id":"1","choices":[{"index":0,"delta":{"content":"x"},"finish_reason":null}]}\n\n',
        ],
      },
    ]);
    const adapter = new GroqAdapter({ fetchImpl, rateLimiter: unlimitedRateLimiter() });

    await expect(collect(adapter)).rejects.toSatisfy(
      (error: unknown) => isGatewayError(error) && error.code === "INTERNAL_ERROR",
    );
  });

  it("translates an HTTP-level error status before any streaming begins", async () => {
    const { fetch: fetchImpl } = createFakeFetch([
      { kind: "json", status: 401, body: { error: { message: "bad key" } } },
    ]);
    const adapter = new GroqAdapter({ fetchImpl, rateLimiter: unlimitedRateLimiter() });

    await expect(collect(adapter)).rejects.toSatisfy(
      (error: unknown) => isGatewayError(error) && error.code === "CREDENTIAL_INVALID",
    );
  });

  it("rejects with CREDENTIAL_INVALID for an empty key without calling fetch", async () => {
    const { fetch: fetchImpl, requests } = createFakeFetch([]);
    const adapter = new GroqAdapter({ fetchImpl, rateLimiter: unlimitedRateLimiter() });

    await expect(
      (async () => {
        const chunks = [];
        for await (const c of adapter.invokeStream(invocation({ stream: true }), {
          key: "",
          scope: "workspace",
        })) {
          chunks.push(c);
        }
        return chunks;
      })(),
    ).rejects.toSatisfy(
      (error: unknown) => isGatewayError(error) && error.code === "CREDENTIAL_INVALID",
    );
    expect(requests).toHaveLength(0);
  });
});

describe("GroqAdapter.healthCheck", () => {
  it("reports healthy on a successful GET /models", async () => {
    const { fetch: fetchImpl, requests } = createFakeFetch([
      { kind: "json", status: 200, body: { data: [] } },
    ]);
    const adapter = new GroqAdapter({ fetchImpl, rateLimiter: unlimitedRateLimiter() });

    const snapshot = await adapter.healthCheck(credential);

    expect(snapshot).toMatchObject({ providerId: "groq", healthy: true, consecutiveFailures: 0 });
    expect(requests[0]!.url).toBe("https://api.groq.com/openai/v1/models");
  });

  it("reports unhealthy with a message on an HTTP error", async () => {
    const { fetch: fetchImpl } = createFakeFetch([{ kind: "json", status: 500, body: {} }]);
    const adapter = new GroqAdapter({ fetchImpl, rateLimiter: unlimitedRateLimiter() });

    const snapshot = await adapter.healthCheck(credential);
    expect(snapshot.healthy).toBe(false);
    expect(snapshot.consecutiveFailures).toBe(1);
    expect(snapshot.message).toBeDefined();
  });

  it("reports unhealthy for an empty credential, without calling fetch", async () => {
    const { fetch: fetchImpl, requests } = createFakeFetch([]);
    const adapter = new GroqAdapter({ fetchImpl, rateLimiter: unlimitedRateLimiter() });

    const snapshot = await adapter.healthCheck({ key: "", scope: "workspace" });
    expect(snapshot.healthy).toBe(false);
    expect(requests).toHaveLength(0);
  });
});

describe("GroqAdapter.estimateCost", () => {
  it("estimates zero cost by default (free tier, matching this repo's seed data)", () => {
    const adapter = new GroqAdapter();
    const estimate = adapter.estimateCost(invocation());
    expect(estimate.estimatedCostUsd).toBe(0);
    expect(estimate.estimatedInputTokens).toBeGreaterThan(0);
    expect(estimate.estimatedOutputTokens).toBe(128);
  });

  it("computes a positive cost when custom pricing is configured", () => {
    const adapter = new GroqAdapter({
      pricing: { inputPer1kTokensUsd: 1, outputPer1kTokensUsd: 2 },
    });
    const estimate = adapter.estimateCost(invocation());
    expect(estimate.estimatedCostUsd).toBeGreaterThan(0);
  });

  it("falls back to a default output-token estimate when maxOutputTokens is 0", () => {
    const adapter = new GroqAdapter();
    const estimate = adapter.estimateCost(invocation({ maxOutputTokens: 0 }));
    expect(estimate.estimatedOutputTokens).toBe(256);
  });
});

describe("GroqAdapter capabilities/id", () => {
  it("uses documented free-tier defaults", () => {
    const adapter = new GroqAdapter();
    expect(adapter.id).toBe("groq");
    expect(adapter.capabilities.rateLimits).toEqual({
      requestsPerMinute: 30,
      tokensPerMinute: 6000,
    });
    expect(adapter.capabilities.supportsStreaming).toBe(true);
  });

  it("allows overriding id and capabilities", () => {
    const adapter = new GroqAdapter({ id: "groq-eu", capabilities: { maxContextTokens: 32_000 } });
    expect(adapter.id).toBe("groq-eu");
    expect(adapter.capabilities.maxContextTokens).toBe(32_000);
    expect(adapter.capabilities.supportsJsonMode).toBe(true); // unspecified fields keep the default
  });
});
