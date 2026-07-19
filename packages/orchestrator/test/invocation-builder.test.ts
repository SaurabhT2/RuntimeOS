import { describe, expect, it } from "vitest";
import { buildNormalizedInvocation } from "../src/invocation-builder.js";
import { baseRequest, plan } from "./fixtures.js";

describe("buildNormalizedInvocation", () => {
  it("carries modelId/temperature/maxOutputTokens/timeoutMs/streaming from the plan, not the request", () => {
    const invocation = buildNormalizedInvocation(
      baseRequest(),
      plan({
        modelId: "m-1",
        temperature: 0.7,
        maxOutputTokens: 42,
        timeoutMs: 1234,
        streaming: true,
      }),
    );
    expect(invocation.modelId).toBe("m-1");
    expect(invocation.temperature).toBe(0.7);
    expect(invocation.maxOutputTokens).toBe(42);
    expect(invocation.timeoutMs).toBe(1234);
    expect(invocation.stream).toBe(true);
  });

  it("normalizes `input.text` into a single-turn user message", () => {
    const invocation = buildNormalizedInvocation(baseRequest({ input: { text: "hello" } }), plan());
    expect(invocation.messages).toEqual([{ role: "user", content: "hello" }]);
  });

  it("passes `input.messages` through unchanged when present", () => {
    const messages = [
      { role: "system" as const, content: "sys" },
      { role: "user" as const, content: "hi" },
    ];
    const invocation = buildNormalizedInvocation(baseRequest({ input: { messages } }), plan());
    expect(invocation.messages).toEqual(messages);
  });

  it("prefers `input.messages` over `input.text` when both are present", () => {
    const messages = [{ role: "user" as const, content: "from messages" }];
    const invocation = buildNormalizedInvocation(
      baseRequest({ input: { text: "from text", messages } }),
      plan(),
    );
    expect(invocation.messages).toEqual(messages);
  });

  it("maps constraints.requiredSchema to a json responseFormat", () => {
    const schema = { type: "object", properties: {} };
    const invocation = buildNormalizedInvocation(
      baseRequest({ constraints: { requiredSchema: schema } }),
      plan(),
    );
    expect(invocation.responseFormat).toEqual({ type: "json", schema });
  });

  it("omits responseFormat when no schema is required", () => {
    const invocation = buildNormalizedInvocation(baseRequest(), plan());
    expect(invocation.responseFormat).toBeUndefined();
  });

  it("returns an empty messages array for input with neither text nor messages (never reached in practice — orchestrator.validate() rejects first)", () => {
    const invocation = buildNormalizedInvocation(baseRequest({ input: {} }), plan());
    expect(invocation.messages).toEqual([]);
  });

  describe("EM-9: strategyDecision.optimizations.prompt.messages (architecture §34.5)", () => {
    it("replaces req-derived messages with the optimized prompt's messages when well-formed", () => {
      const optimizedMessages = [
        { role: "system" as const, content: "optimized system prompt" },
        { role: "user" as const, content: "optimized user turn" },
      ];
      const invocation = buildNormalizedInvocation(
        baseRequest({ input: { text: "original text, should be replaced" } }),
        plan(),
        {
          requiredCapabilities: {},
          executionProfile: {},
          optimizations: { cost: {}, prompt: { messages: optimizedMessages } },
        },
      );
      expect(invocation.messages).toEqual(optimizedMessages);
    });

    it("falls back to req-derived messages when strategyDecision is absent", () => {
      const invocation = buildNormalizedInvocation(baseRequest({ input: { text: "hi" } }), plan());
      expect(invocation.messages).toEqual([{ role: "user", content: "hi" }]);
    });

    it("falls back to req-derived messages when optimizations.prompt is present but malformed", () => {
      const invocation = buildNormalizedInvocation(
        baseRequest({ input: { text: "hi" } }),
        plan(),
        {
          requiredCapabilities: {},
          executionProfile: {},
          optimizations: { cost: {}, prompt: { messages: [{ role: "not-a-real-role" }] } },
        },
      );
      expect(invocation.messages).toEqual([{ role: "user", content: "hi" }]);
    });

    it("falls back to req-derived messages when optimizations.prompt.messages is an empty array", () => {
      const invocation = buildNormalizedInvocation(
        baseRequest({ input: { text: "hi" } }),
        plan(),
        {
          requiredCapabilities: {},
          executionProfile: {},
          optimizations: { cost: {}, prompt: { messages: [] } },
        },
      );
      expect(invocation.messages).toEqual([{ role: "user", content: "hi" }]);
    });
  });
});
