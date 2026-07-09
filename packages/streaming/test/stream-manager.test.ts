import { describe, expect, it } from "vitest";
import { isGatewayError } from "@ai-gateway/core-contracts";
import type {
  NormalizedChunk,
  NormalizedInvocation,
  ProviderAdapter,
  ProviderHealthSnapshot,
  ScopedCredential,
} from "@ai-gateway/provider-sdk";
import { DefaultStreamManager } from "../src/stream-manager.js";

const credential: ScopedCredential = { key: "k", scope: "workspace" };

function invocation(): NormalizedInvocation {
  return {
    modelId: "m",
    messages: [{ role: "user", content: "hi" }],
    temperature: 0.5,
    maxOutputTokens: 100,
    stream: true,
    timeoutMs: 5000,
  };
}

/** A `ProviderAdapter` whose `invokeStream` yields a fixed, controllable sequence of chunks — never makes real network calls. */
function fakeAdapter(
  chunks: NormalizedChunk[],
  opts: { throwAfter?: number } = {},
): ProviderAdapter {
  return {
    id: "fake",
    capabilities: {
      supportsStreaming: true,
      supportsJsonMode: false,
      supportsToolCalling: false,
      supportsSystemMessages: true,
      maxContextTokens: 1000,
      rateLimits: {},
    },
    invoke: () => {
      throw new Error("not used in these tests");
    },
    async *invokeStream(): AsyncIterable<NormalizedChunk> {
      for (let i = 0; i < chunks.length; i++) {
        if (opts.throwAfter !== undefined && i === opts.throwAfter) {
          throw new Error("simulated upstream failure");
        }
        yield chunks[i]!;
      }
    },
    healthCheck: async (): Promise<ProviderHealthSnapshot> => ({
      providerId: "fake",
      healthy: true,
      lastCheckedAt: new Date().toISOString(),
      consecutiveFailures: 0,
    }),
    estimateCost: () => ({
      estimatedInputTokens: 1,
      estimatedOutputTokens: 1,
      estimatedCostUsd: 0,
    }),
  };
}

describe("DefaultStreamManager.openStream", () => {
  it("yields every chunk from the adapter, in order", async () => {
    const chunks: NormalizedChunk[] = [
      { delta: { text: "He" }, done: false },
      { delta: { text: "llo" }, done: false },
      { delta: {}, done: true, finishReason: "stop" },
    ];
    const manager = new DefaultStreamManager();

    const collected: NormalizedChunk[] = [];
    for await (const chunk of manager.openStream(
      fakeAdapter(chunks),
      invocation(),
      credential,
      "req-1",
    )) {
      collected.push(chunk);
    }

    expect(collected).toEqual(chunks);
  });

  it("stops iterating immediately after a done: true chunk, ignoring anything after it", async () => {
    const chunks: NormalizedChunk[] = [
      { delta: {}, done: true, finishReason: "stop" },
      { delta: { text: "should never appear" }, done: false },
    ];
    const manager = new DefaultStreamManager();

    const collected: NormalizedChunk[] = [];
    for await (const chunk of manager.openStream(
      fakeAdapter(chunks),
      invocation(),
      credential,
      "req-1",
    )) {
      collected.push(chunk);
    }

    expect(collected).toHaveLength(1);
  });

  it("tracks a stream as open only while it is in progress (isOpen)", async () => {
    const manager = new DefaultStreamManager();
    const chunks: NormalizedChunk[] = [{ delta: {}, done: true, finishReason: "stop" }];

    expect(manager.isOpen("req-1")).toBe(false);
    const iterator = manager
      .openStream(fakeAdapter(chunks), invocation(), credential, "req-1")
      [Symbol.asyncIterator]();
    expect(manager.isOpen("req-1")).toBe(false); // lazy: body hasn't run yet
    await iterator.next();
    expect(manager.isOpen("req-1")).toBe(true);
    await iterator.next(); // consumes the done chunk, generator returns
    expect(manager.isOpen("req-1")).toBe(false);
  });

  it("rejects a second concurrent openStream for the same requestId with a non-retryable GatewayError", async () => {
    const manager = new DefaultStreamManager();
    const longChunks: NormalizedChunk[] = [
      { delta: { text: "a" }, done: false },
      { delta: {}, done: true, finishReason: "stop" },
    ];
    const iterator = manager
      .openStream(fakeAdapter(longChunks), invocation(), credential, "req-dup")
      [Symbol.asyncIterator]();
    await iterator.next(); // enter the generator body, registering "req-dup" as active

    await expect(async () => {
      const secondIterator = manager
        .openStream(fakeAdapter(longChunks), invocation(), credential, "req-dup")
        [Symbol.asyncIterator]();
      await secondIterator.next();
    }).rejects.toSatisfy(
      (error: unknown) =>
        isGatewayError(error) && error.code === "INVALID_SCHEMA" && !error.retryable,
    );
  });

  it("allows reusing a requestId once the prior stream has finished", async () => {
    const manager = new DefaultStreamManager();
    const chunks: NormalizedChunk[] = [{ delta: {}, done: true, finishReason: "stop" }];

    const first: NormalizedChunk[] = [];
    for await (const chunk of manager.openStream(
      fakeAdapter(chunks),
      invocation(),
      credential,
      "req-reuse",
    )) {
      first.push(chunk);
    }
    expect(manager.isOpen("req-reuse")).toBe(false);

    const second: NormalizedChunk[] = [];
    for await (const chunk of manager.openStream(
      fakeAdapter(chunks),
      invocation(),
      credential,
      "req-reuse",
    )) {
      second.push(chunk);
    }
    expect(second).toEqual(first);
  });

  it("cleans up the active-stream entry even when the adapter throws mid-stream, and propagates the error", async () => {
    const manager = new DefaultStreamManager();
    const chunks: NormalizedChunk[] = [
      { delta: { text: "a" }, done: false },
      { delta: { text: "b" }, done: false },
    ];

    await expect(async () => {
      for await (const _chunk of manager.openStream(
        fakeAdapter(chunks, { throwAfter: 1 }),
        invocation(),
        credential,
        "req-err",
      )) {
        // drain
      }
    }).rejects.toThrow("simulated upstream failure");

    expect(manager.isOpen("req-err")).toBe(false);
  });
});

describe("DefaultStreamManager cancellation", () => {
  it("replaces the next chunk with a synthetic cancelled terminal chunk once cancel() is called", async () => {
    const chunks: NormalizedChunk[] = [
      { delta: { text: "a" }, done: false },
      { delta: { text: "b" }, done: false },
      { delta: { text: "c" }, done: false },
      { delta: {}, done: true, finishReason: "stop" },
    ];
    const manager = new DefaultStreamManager();
    const iterator = manager
      .openStream(fakeAdapter(chunks), invocation(), credential, "req-cancel")
      [Symbol.asyncIterator]();

    const first = await iterator.next();
    expect(first.value).toEqual({ delta: { text: "a" }, done: false });

    manager.cancel("req-cancel");

    const second = await iterator.next();
    expect(second.value).toEqual({ delta: {}, done: true, finishReason: "cancelled" });

    const third = await iterator.next();
    expect(third.done).toBe(true); // generator has returned; no further chunks (b, c) are yielded
  });

  it("marks the stream as no longer open once the synthetic cancelled chunk has been fully consumed", async () => {
    const chunks: NormalizedChunk[] = [
      { delta: { text: "a" }, done: false },
      { delta: { text: "b" }, done: false },
    ];
    const manager = new DefaultStreamManager();
    const iterator = manager
      .openStream(fakeAdapter(chunks), invocation(), credential, "req-cancel-2")
      [Symbol.asyncIterator]();

    await iterator.next(); // yields "a"
    expect(manager.isOpen("req-cancel-2")).toBe(true);
    manager.cancel("req-cancel-2");
    const synthetic = await iterator.next(); // yields the synthetic cancelled chunk; generator is suspended there, not yet returned
    expect(synthetic.value).toEqual({ delta: {}, done: true, finishReason: "cancelled" });
    expect(manager.isOpen("req-cancel-2")).toBe(true);

    await iterator.next(); // resumes past the synthetic yield, generator returns, finally cleans up
    expect(manager.isOpen("req-cancel-2")).toBe(false);
  });

  it("calling cancel() for a requestId with no open stream is a harmless no-op", () => {
    const manager = new DefaultStreamManager();
    expect(() => manager.cancel("no-such-request")).not.toThrow();
  });

  it("does not affect an unrelated, concurrently open requestId", async () => {
    const chunks: NormalizedChunk[] = [
      { delta: { text: "a" }, done: false },
      { delta: {}, done: true, finishReason: "stop" },
    ];
    const manager = new DefaultStreamManager();
    const iterA = manager
      .openStream(fakeAdapter(chunks), invocation(), credential, "req-a")
      [Symbol.asyncIterator]();
    const iterB = manager
      .openStream(fakeAdapter(chunks), invocation(), credential, "req-b")
      [Symbol.asyncIterator]();

    await iterA.next();
    await iterB.next();
    manager.cancel("req-a");

    const bNext = await iterB.next();
    expect(bNext.value).toEqual({ delta: {}, done: true, finishReason: "stop" }); // req-b unaffected by req-a's cancellation
  });
});
