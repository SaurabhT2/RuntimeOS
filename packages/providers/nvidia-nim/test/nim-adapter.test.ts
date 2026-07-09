import { describe, expect, it } from "vitest";
import { isGatewayError } from "@ai-gateway/core-contracts";
import type { NormalizedInvocation, ScopedCredential } from "@ai-gateway/provider-sdk";
import { NimAdapter } from "../src/nim-adapter.js";
import { createFakeFetch } from "./fake-fetch.js";

const credential: ScopedCredential = { key: "test-key", scope: "workspace" };

function invocation(overrides: Partial<NormalizedInvocation> = {}): NormalizedInvocation {
  return {
    modelId: "meta/llama3-70b-instruct",
    messages: [{ role: "user", content: "hello" }],
    temperature: 0.5,
    maxOutputTokens: 128,
    stream: false,
    timeoutMs: 5000,
    ...overrides,
  };
}

describe("NimAdapter.invoke", () => {
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
    const adapter = new NimAdapter({ fetchImpl });

    const result = await adapter.invoke(invocation(), credential);

    expect(result.text).toBe("hi");
    expect(requests[0]!.url).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    expect(requests[0]!.headers["Authorization"]).toBe("Bearer test-key");
  });

  it("rejects with CREDENTIAL_INVALID for an empty key, without a network call", async () => {
    const { fetch: fetchImpl, requests } = createFakeFetch([]);
    const adapter = new NimAdapter({ fetchImpl });

    await expect(adapter.invoke(invocation(), { key: "", scope: "workspace" })).rejects.toSatisfy(
      (error: unknown) => isGatewayError(error) && error.code === "CREDENTIAL_INVALID",
    );
    expect(requests).toHaveLength(0);
  });

  it("translates a 429 into a retryable RATE_LIMITED GatewayError", async () => {
    const { fetch: fetchImpl } = createFakeFetch([{ kind: "json", status: 429, body: {} }]);
    const adapter = new NimAdapter({ fetchImpl });

    await expect(adapter.invoke(invocation(), credential)).rejects.toSatisfy(
      (error: unknown) => isGatewayError(error) && error.code === "RATE_LIMITED" && error.retryable,
    );
  });

  it("translates an aborted (timed-out) request into TIMEOUT", async () => {
    const { fetch: fetchImpl } = createFakeFetch([{ kind: "hang" }]);
    const adapter = new NimAdapter({ fetchImpl });

    await expect(adapter.invoke(invocation({ timeoutMs: 20 }), credential)).rejects.toSatisfy(
      (error: unknown) => isGatewayError(error) && error.code === "TIMEOUT" && error.retryable,
    );
  });

  it("never lets a raw network exception escape", async () => {
    const { fetch: fetchImpl } = createFakeFetch([
      { kind: "throw", error: new Error("ECONNRESET") },
    ]);
    const adapter = new NimAdapter({ fetchImpl });

    await expect(adapter.invoke(invocation(), credential)).rejects.toSatisfy(
      (error: unknown) => isGatewayError(error) && error.code === "INTERNAL_ERROR",
    );
  });
});

describe("NimAdapter.invokeStream", () => {
  async function collect(adapter: NimAdapter, req = invocation({ stream: true })) {
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
          'data: {"id":"1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}\n\n',
          "data: [DONE]\n\n",
        ],
      },
    ]);
    const adapter = new NimAdapter({ fetchImpl });

    const chunks = await collect(adapter);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ delta: { text: "He" }, done: false });
    expect(chunks[1]).toMatchObject({ done: true, finishReason: "stop" });
  });

  it("translates a malformed SSE frame into a GatewayError", async () => {
    const { fetch: fetchImpl } = createFakeFetch([
      { kind: "sse", status: 200, frames: ["data: not-json\n\n"] },
    ]);
    const adapter = new NimAdapter({ fetchImpl });

    await expect(collect(adapter)).rejects.toSatisfy(
      (error: unknown) => isGatewayError(error) && error.code === "INTERNAL_ERROR",
    );
  });

  it("translates a stream that ends without a terminal chunk", async () => {
    const { fetch: fetchImpl } = createFakeFetch([
      {
        kind: "sse",
        status: 200,
        frames: [
          'data: {"id":"1","choices":[{"index":0,"delta":{"content":"x"},"finish_reason":null}]}\n\n',
        ],
      },
    ]);
    const adapter = new NimAdapter({ fetchImpl });

    await expect(collect(adapter)).rejects.toSatisfy(
      (error: unknown) => isGatewayError(error) && error.code === "INTERNAL_ERROR",
    );
  });

  it("translates an HTTP-level error before streaming begins", async () => {
    const { fetch: fetchImpl } = createFakeFetch([{ kind: "json", status: 401, body: {} }]);
    const adapter = new NimAdapter({ fetchImpl });

    await expect(collect(adapter)).rejects.toSatisfy(
      (error: unknown) => isGatewayError(error) && error.code === "CREDENTIAL_INVALID",
    );
  });
});

describe("NimAdapter.healthCheck", () => {
  it("reports healthy on a successful GET /models", async () => {
    const { fetch: fetchImpl, requests } = createFakeFetch([
      { kind: "json", status: 200, body: { data: [] } },
    ]);
    const adapter = new NimAdapter({ fetchImpl });

    const snapshot = await adapter.healthCheck(credential);
    expect(snapshot).toMatchObject({
      providerId: "nvidia-nim",
      healthy: true,
      consecutiveFailures: 0,
    });
    expect(requests[0]!.url).toBe("https://integrate.api.nvidia.com/v1/models");
  });

  it("reports unhealthy with a message on an HTTP error", async () => {
    const { fetch: fetchImpl } = createFakeFetch([{ kind: "json", status: 500, body: {} }]);
    const adapter = new NimAdapter({ fetchImpl });

    const snapshot = await adapter.healthCheck(credential);
    expect(snapshot.healthy).toBe(false);
    expect(snapshot.message).toBeDefined();
  });

  it("reports unhealthy for an empty credential without a network call", async () => {
    const { fetch: fetchImpl, requests } = createFakeFetch([]);
    const adapter = new NimAdapter({ fetchImpl });

    const snapshot = await adapter.healthCheck({ key: "", scope: "workspace" });
    expect(snapshot.healthy).toBe(false);
    expect(requests).toHaveLength(0);
  });
});

describe("NimAdapter.estimateCost", () => {
  it("estimates a positive cost by default (paid tier)", () => {
    const estimate = new NimAdapter().estimateCost(invocation());
    expect(estimate.estimatedCostUsd).toBeGreaterThan(0);
  });

  it("respects custom pricing", () => {
    const cheap = new NimAdapter({
      pricing: { inputPer1kTokensUsd: 0, outputPer1kTokensUsd: 0 },
    }).estimateCost(invocation());
    expect(cheap.estimatedCostUsd).toBe(0);
  });

  it("falls back to a default output-token estimate when maxOutputTokens is 0", () => {
    expect(
      new NimAdapter().estimateCost(invocation({ maxOutputTokens: 0 })).estimatedOutputTokens,
    ).toBe(256);
  });
});

describe("NimAdapter capabilities/id", () => {
  it("uses documented defaults", () => {
    const adapter = new NimAdapter();
    expect(adapter.id).toBe("nvidia-nim");
    expect(adapter.capabilities.rateLimits).toEqual({
      requestsPerMinute: 60,
      tokensPerMinute: 60_000,
    });
  });

  it("allows overriding id and capabilities", () => {
    const adapter = new NimAdapter({ id: "nim-eu", capabilities: { maxContextTokens: 8000 } });
    expect(adapter.id).toBe("nim-eu");
    expect(adapter.capabilities.maxContextTokens).toBe(8000);
    expect(adapter.capabilities.supportsToolCalling).toBe(true);
  });
});
