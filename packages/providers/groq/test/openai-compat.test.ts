import { describe, expect, it } from "vitest";
import type { NormalizedInvocation } from "@ai-gateway/provider-sdk";
import {
  fromGroqResponse,
  fromGroqStreamEvent,
  mapFinishReason,
  toGroqRequestBody,
  type GroqChatCompletionResponse,
} from "../src/openai-compat.js";

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

describe("toGroqRequestBody", () => {
  it("maps the core fields verbatim", () => {
    const body = toGroqRequestBody(invocation(), false);
    expect(body.model).toBe("llama-3.1-8b-instant");
    expect(body.messages).toEqual([{ role: "user", content: "hello" }]);
    expect(body.temperature).toBe(0.5);
    expect(body.max_tokens).toBe(128);
    expect(body.stream).toBe(false);
  });

  it("preserves an optional message name", () => {
    const body = toGroqRequestBody(
      invocation({ messages: [{ role: "tool", content: "x", name: "lookup" }] }),
      false,
    );
    expect(body.messages[0]).toEqual({ role: "tool", content: "x", name: "lookup" });
  });

  it("includes stream_options.include_usage only when streaming and requested", () => {
    expect(toGroqRequestBody(invocation({ stream: true }), true).stream_options).toEqual({
      include_usage: true,
    });
    expect(toGroqRequestBody(invocation({ stream: true }), false).stream_options).toBeUndefined();
    expect(toGroqRequestBody(invocation({ stream: false }), true).stream_options).toBeUndefined();
  });

  it("sets response_format only when responseFormat.type is json", () => {
    const body = toGroqRequestBody(invocation({ responseFormat: { type: "json" } }), false);
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("omits response_format when not requested", () => {
    expect(toGroqRequestBody(invocation(), false).response_format).toBeUndefined();
  });

  it("translates tools when present", () => {
    const body = toGroqRequestBody(
      invocation({
        tools: [{ name: "lookup", description: "looks things up", parameters: { type: "object" } }],
      }),
      false,
    );
    expect(body.tools).toEqual([
      {
        type: "function",
        function: {
          name: "lookup",
          description: "looks things up",
          parameters: { type: "object" },
        },
      },
    ]);
  });

  it("omits tools when the array is empty or absent", () => {
    expect(toGroqRequestBody(invocation({ tools: [] }), false).tools).toBeUndefined();
    expect(toGroqRequestBody(invocation(), false).tools).toBeUndefined();
  });
});

describe("mapFinishReason", () => {
  it.each([
    ["stop", "stop"],
    ["length", "length"],
    ["content_filter", "content_filter"],
    ["tool_calls", "tool_call"],
  ] as const)("maps %s to %s", (input, expected) => {
    expect(mapFinishReason(input)).toBe(expected);
  });

  it("defaults an unrecognized or missing finish_reason to stop", () => {
    expect(mapFinishReason("something-new")).toBe("stop");
    expect(mapFinishReason(null)).toBe("stop");
    expect(mapFinishReason(undefined)).toBe("stop");
  });
});

function response(overrides: Partial<GroqChatCompletionResponse> = {}): GroqChatCompletionResponse {
  return {
    id: "chatcmpl-1",
    choices: [
      { index: 0, message: { role: "assistant", content: "hi there" }, finish_reason: "stop" },
    ],
    usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    ...overrides,
  };
}

describe("fromGroqResponse", () => {
  it("translates a plain text completion", () => {
    const result = fromGroqResponse(response());
    expect(result.text).toBe("hi there");
    expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 3 });
    expect(result.finishReason).toBe("stop");
    expect(result.toolCalls).toBeUndefined();
  });

  it("translates tool calls", () => {
    const result = fromGroqResponse(
      response({
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{ id: "call_1", function: { name: "lookup", arguments: '{"q":"x"}' } }],
            },
            finish_reason: "tool_calls",
          },
        ],
      }),
    );
    expect(result.toolCalls).toEqual([{ id: "call_1", name: "lookup", arguments: '{"q":"x"}' }]);
    expect(result.finishReason).toBe("tool_call");
  });

  it("defaults usage to 0 when Groq omits it", () => {
    const result = fromGroqResponse(response({ usage: undefined }));
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it("retains the raw response for adapter-internal debugging", () => {
    const raw = response();
    expect(fromGroqResponse(raw).raw).toBe(raw);
  });
});

describe("fromGroqStreamEvent", () => {
  it("returns a non-terminal chunk for a delta with text", () => {
    const chunk = fromGroqStreamEvent({
      id: "x",
      choices: [{ index: 0, delta: { content: "he" }, finish_reason: null }],
    });
    expect(chunk).toEqual({ delta: { text: "he" }, done: false });
  });

  it("returns undefined for a delta carrying no text (e.g. a role-only opening delta)", () => {
    const chunk = fromGroqStreamEvent({
      id: "x",
      choices: [{ index: 0, delta: {}, finish_reason: null }],
    });
    expect(chunk).toBeUndefined();
  });

  it("returns a terminal chunk once finish_reason is present, with usage if included", () => {
    const chunk = fromGroqStreamEvent({
      id: "x",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });
    expect(chunk).toEqual({
      delta: {},
      done: true,
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 20 },
    });
  });

  it("returns a terminal chunk without usage when Groq omits it", () => {
    const chunk = fromGroqStreamEvent({
      id: "x",
      choices: [{ index: 0, delta: {}, finish_reason: "length" }],
    });
    expect(chunk).toEqual({ delta: {}, done: true, finishReason: "length", usage: undefined });
  });
});
