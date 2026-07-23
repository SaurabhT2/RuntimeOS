import { describe, expect, it } from "vitest";
import { isGatewayError } from "@ai-gateway/core-contracts";
import { MockAdapter } from "../src/mock-adapter.js";
import type { NormalizedInvocation } from "../src/invocation.js";
import type { ScopedCredential } from "../src/credential.js";

const credential: ScopedCredential = { key: "test-key", scope: "workspace" };

const invocation: NormalizedInvocation = {
  modelId: "mock-fast-extraction",
  messages: [{ role: "user", content: "Summarize this." }],
  temperature: 0.2,
  maxOutputTokens: 64,
  stream: false,
  timeoutMs: 2000,
};

describe("MockAdapter", () => {
  it("defaults to id 'mock' and full capabilities", () => {
    const adapter = new MockAdapter();
    expect(adapter.id).toBe("mock");
    expect(adapter.capabilities.supportsStreaming).toBe(true);
  });

  it("accepts a custom id and partial capability overrides", () => {
    const adapter = new MockAdapter({ id: "mock-2", capabilities: { supportsStreaming: false } });
    expect(adapter.id).toBe("mock-2");
    expect(adapter.capabilities.supportsStreaming).toBe(false);
    expect(adapter.capabilities.supportsJsonMode).toBe(true); // unspecified fields keep defaults
  });

  it("invoke() returns a canned NormalizedResult by default", async () => {
    const adapter = new MockAdapter();
    const result = await adapter.invoke(invocation, credential);
    expect(result.finishReason).toBe("stop");
    expect(result.usage.inputTokens).toBeGreaterThan(0);
  });

  it("invoke() applies result overrides from configured behavior", async () => {
    const adapter = new MockAdapter();
    adapter.setBehavior({
      mode: "success",
      result: { text: "custom text", finishReason: "length" },
    });
    const result = await adapter.invoke(invocation, credential);
    expect(result.text).toBe("custom text");
    expect(result.finishReason).toBe("length");
  });

  it("invoke() throws a GatewayError with the configured code in error mode", async () => {
    const adapter = new MockAdapter();
    adapter.setBehavior({ mode: "error", errorCode: "CONTENT_FILTERED", errorMessage: "blocked" });
    await expect(adapter.invoke(invocation, credential)).rejects.toSatisfy(
      (error: unknown) =>
        isGatewayError(error) &&
        error.code === "CONTENT_FILTERED" &&
        error.message === "blocked" &&
        error.retryable === false,
    );
  });

  it("invoke() falls back to INTERNAL_ERROR and a default message in error mode when neither is configured", async () => {
    const adapter = new MockAdapter();
    adapter.setBehavior({ mode: "error" });
    await expect(adapter.invoke(invocation, credential)).rejects.toSatisfy(
      (error: unknown) =>
        isGatewayError(error) &&
        error.code === "INTERNAL_ERROR" &&
        error.message === "Mock adapter configured to simulate an error.",
    );
  });

  it("invoke() throws an INTERNAL_ERROR GatewayError in malformed-stream mode (non-streaming call)", async () => {
    const adapter = new MockAdapter();
    adapter.setBehavior({ mode: "malformed-stream" });
    await expect(adapter.invoke(invocation, credential)).rejects.toSatisfy(
      (error: unknown) =>
        isGatewayError(error) &&
        error.code === "INTERNAL_ERROR" &&
        error.message === "Mock adapter configured to simulate a malformed response body.",
    );
  });

  it("invoke() falls back to 32 output tokens when maxOutputTokens is not positive", async () => {
    const adapter = new MockAdapter();
    const result = await adapter.invoke({ ...invocation, maxOutputTokens: 0 }, credential);
    expect(result.usage.outputTokens).toBe(32);
  });

  it("invoke() throws GatewayError TIMEOUT in timeout mode", async () => {
    const adapter = new MockAdapter();
    adapter.setBehavior({ mode: "timeout" });
    await expect(adapter.invoke(invocation, credential)).rejects.toSatisfy(
      (error: unknown) => isGatewayError(error) && error.code === "TIMEOUT" && error.retryable,
    );
  });

  it("invoke() organically times out when configured latency exceeds timeoutMs, even in success mode", async () => {
    const adapter = new MockAdapter();
    adapter.setBehavior({ mode: "success", latencyMs: 50 });
    await expect(adapter.invoke({ ...invocation, timeoutMs: 5 }, credential)).rejects.toSatisfy(
      (error: unknown) => isGatewayError(error) && error.code === "TIMEOUT",
    );
  });

  it("invoke() rejects with CREDENTIAL_INVALID for an empty key", async () => {
    const adapter = new MockAdapter();
    await expect(adapter.invoke(invocation, { key: "", scope: "workspace" })).rejects.toSatisfy(
      (error: unknown) => isGatewayError(error) && error.code === "CREDENTIAL_INVALID",
    );
  });

  it("reset() restores default success behavior", async () => {
    const adapter = new MockAdapter();
    adapter.setBehavior({ mode: "error", errorCode: "INTERNAL_ERROR" });
    adapter.reset();
    const result = await adapter.invoke(invocation, credential);
    expect(result.finishReason).toBe("stop");
  });

  describe("invokeStream()", () => {
    it("yields the configured number of chunks then one terminal done:true chunk", async () => {
      const adapter = new MockAdapter();
      adapter.setBehavior({ mode: "success", chunkCount: 4 });
      const chunks = [];
      for await (const chunk of adapter.invokeStream(invocation, credential)) {
        chunks.push(chunk);
      }
      expect(chunks).toHaveLength(5); // 4 content chunks + 1 terminal
      expect(chunks.slice(0, 4).every((c) => !c.done)).toBe(true);
      expect(chunks[4]?.done).toBe(true);
      expect(chunks[4]?.finishReason).toBe("stop");
      expect(chunks[4]?.usage).toBeDefined();
    });

    it("throws a GatewayError mid-stream in malformed-stream mode without yielding a terminal chunk", async () => {
      const adapter = new MockAdapter();
      adapter.setBehavior({ mode: "malformed-stream", chunkCount: 4 });
      const chunks = [];
      await expect(
        (async () => {
          for await (const chunk of adapter.invokeStream(invocation, credential)) {
            chunks.push(chunk);
          }
        })(),
      ).rejects.toSatisfy(
        (error: unknown) => isGatewayError(error) && error.code === "INTERNAL_ERROR",
      );
      expect(chunks.some((c) => c.done)).toBe(false);
    });

    it("throws the configured GatewayError immediately in error mode", async () => {
      const adapter = new MockAdapter();
      adapter.setBehavior({ mode: "error", errorCode: "RATE_LIMITED" });
      await expect(
        (async () => {
          for await (const _chunk of adapter.invokeStream(invocation, credential)) {
            // draining the iterator
          }
        })(),
      ).rejects.toSatisfy(
        (error: unknown) => isGatewayError(error) && error.code === "RATE_LIMITED",
      );
    });

    it("falls back to INTERNAL_ERROR and a default message in error mode when neither is configured", async () => {
      const adapter = new MockAdapter();
      adapter.setBehavior({ mode: "error" });
      await expect(
        (async () => {
          for await (const _chunk of adapter.invokeStream(invocation, credential)) {
            // draining the iterator
          }
        })(),
      ).rejects.toSatisfy(
        (error: unknown) =>
          isGatewayError(error) &&
          error.code === "INTERNAL_ERROR" &&
          error.message === "Mock adapter configured to simulate an error.",
      );
    });

    it("throws GatewayError TIMEOUT when actually iterated in timeout mode", async () => {
      const adapter = new MockAdapter();
      adapter.setBehavior({ mode: "timeout" });
      await expect(
        (async () => {
          for await (const _chunk of adapter.invokeStream(invocation, credential)) {
            // draining the iterator
          }
        })(),
      ).rejects.toSatisfy((error: unknown) => isGatewayError(error) && error.code === "TIMEOUT");
    });

    it("uses the configured result overrides for the terminal chunk's finishReason and usage", async () => {
      const adapter = new MockAdapter();
      adapter.setBehavior({
        mode: "success",
        chunkCount: 1,
        result: { finishReason: "length", usage: { inputTokens: 7, outputTokens: 9 } },
      });
      const chunks = [];
      for await (const chunk of adapter.invokeStream(invocation, credential)) {
        chunks.push(chunk);
      }
      const terminal = chunks[chunks.length - 1];
      expect(terminal?.finishReason).toBe("length");
      expect(terminal?.usage).toEqual({ inputTokens: 7, outputTokens: 9 });
    });

    it("rejects with CREDENTIAL_INVALID for an empty key before yielding any chunk", async () => {
      const adapter = new MockAdapter();
      const iterator = adapter.invokeStream(invocation, { key: "", scope: "workspace" });
      await expect(iterator.next()).rejects.toSatisfy(
        (error: unknown) => isGatewayError(error) && error.code === "CREDENTIAL_INVALID",
      );
    });
  });

  describe("healthCheck()", () => {
    it("reports healthy: true by default", async () => {
      const adapter = new MockAdapter();
      const snapshot = await adapter.healthCheck(credential);
      expect(snapshot.healthy).toBe(true);
      expect(snapshot.providerId).toBe("mock");
      expect(snapshot.consecutiveFailures).toBe(0);
    });

    it("reports healthy: false when configured in error/timeout mode", async () => {
      const adapter = new MockAdapter();
      adapter.setBehavior({ mode: "timeout" });
      const snapshot = await adapter.healthCheck(credential);
      expect(snapshot.healthy).toBe(false);
      expect(snapshot.consecutiveFailures).toBeGreaterThan(0);
      expect(snapshot.message).toBe("Mock adapter configured to simulate a timeout.");
    });

    it("reports the configured errorMessage (or a default) in error mode", async () => {
      const adapter = new MockAdapter();
      adapter.setBehavior({ mode: "error", errorMessage: "custom failure" });
      const snapshot = await adapter.healthCheck(credential);
      expect(snapshot.healthy).toBe(false);
      expect(snapshot.message).toBe("custom failure");

      adapter.setBehavior({ mode: "error" });
      const defaultSnapshot = await adapter.healthCheck(credential);
      expect(defaultSnapshot.message).toBe("Mock adapter configured to simulate an error.");
    });

    it("reports healthy: false for an invalid credential, without throwing", async () => {
      const adapter = new MockAdapter();
      const snapshot = await adapter.healthCheck({ key: "", scope: "workspace" });
      expect(snapshot.healthy).toBe(false);
    });
  });

  describe("estimateCost()", () => {
    it("returns a synchronous, non-negative estimate scaled with maxOutputTokens", () => {
      const adapter = new MockAdapter();
      const estimate = adapter.estimateCost(invocation);
      expect(estimate.estimatedOutputTokens).toBe(invocation.maxOutputTokens);
      expect(estimate.estimatedCostUsd).toBeGreaterThan(0);
    });

    it("falls back to 256 estimated output tokens when maxOutputTokens is not positive", () => {
      const adapter = new MockAdapter();
      const estimate = adapter.estimateCost({ ...invocation, maxOutputTokens: 0 });
      expect(estimate.estimatedOutputTokens).toBe(256);
    });
  });
});
