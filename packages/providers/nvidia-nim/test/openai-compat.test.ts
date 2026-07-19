import { describe, expect, it } from "vitest";
import type { NormalizedInvocation } from "@ai-gateway/provider-sdk";
import {
  fromNimResponse,
  fromNimStreamEvent,
  mapFinishReason,
  toNimRequestBody,
  type NimChatCompletionResponse,
} from "../src/openai-compat.js";

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

describe("toNimRequestBody", () => {
  it("maps the core fields verbatim", () => {
    const body = toNimRequestBody(invocation(), false);
    expect(body.model).toBe("meta/llama3-70b-instruct");
    expect(body.messages).toEqual([{ role: "user", content: "hello" }]);
    expect(body.temperature).toBe(0.5);
    expect(body.max_tokens).toBe(128);
    expect(body.stream).toBe(false);
  });

  it("includes stream_options.include_usage only when streaming and requested", () => {
    expect(toNimRequestBody(invocation({ stream: true }), true).stream_options).toEqual({
      include_usage: true,
    });
    expect(toNimRequestBody(invocation({ stream: true }), false).stream_options).toBeUndefined();
  });

  it("sets response_format only when responseFormat.type is json", () => {
    expect(
      toNimRequestBody(invocation({ responseFormat: { type: "json" } }), false).response_format,
    ).toEqual({
      type: "json_object",
    });
    expect(toNimRequestBody(invocation(), false).response_format).toBeUndefined();
  });

  it("translates tools when present, omits when empty/absent", () => {
    const body = toNimRequestBody(
      invocation({ tools: [{ name: "lookup", description: "d", parameters: { type: "object" } }] }),
      false,
    );
    expect(body.tools).toEqual([
      {
        type: "function",
        function: { name: "lookup", description: "d", parameters: { type: "object" } },
      },
    ]);
    expect(toNimRequestBody(invocation({ tools: [] }), false).tools).toBeUndefined();
  });
});

describe("mapFinishReason", () => {
  it.each([
    ["stop", "stop"],
    ["length", "length"],
    ["content_filter", "content_filter"],
    ["tool_calls", "tool_call"],
    ["unknown-thing", "stop"],
  ] as const)("maps %s to %s", (input, expected) => {
    expect(mapFinishReason(input)).toBe(expected);
  });
});

function response(overrides: Partial<NimChatCompletionResponse> = {}): NimChatCompletionResponse {
  return {
    id: "chatcmpl-1",
    choices: [
      { index: 0, message: { role: "assistant", content: "hi there" }, finish_reason: "stop" },
    ],
    usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    ...overrides,
  };
}

describe("fromNimResponse", () => {
  it("translates a plain text completion", () => {
    const result = fromNimResponse(response());
    expect(result.text).toBe("hi there");
    expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 3 });
    expect(result.finishReason).toBe("stop");
  });

  it("translates tool calls", () => {
    const result = fromNimResponse(
      response({
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{ id: "call_1", function: { name: "lookup", arguments: "{}" } }],
            },
            finish_reason: "tool_calls",
          },
        ],
      }),
    );
    expect(result.toolCalls).toEqual([{ id: "call_1", name: "lookup", arguments: "{}" }]);
  });

  it("defaults usage to 0 when NIM omits it", () => {
    expect(fromNimResponse(response({ usage: undefined })).usage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
    });
  });
});

describe("fromNimStreamEvent", () => {
  it("returns a non-terminal chunk for a delta with text", () => {
    expect(
      fromNimStreamEvent({
        id: "x",
        choices: [{ index: 0, delta: { content: "he" }, finish_reason: null }],
      }),
    ).toEqual({ delta: { text: "he" }, done: false });
  });

  it("returns undefined for a delta carrying no text", () => {
    expect(
      fromNimStreamEvent({ id: "x", choices: [{ index: 0, delta: {}, finish_reason: null }] }),
    ).toBeUndefined();
  });

  it("returns a terminal chunk once finish_reason is present, with usage if included", () => {
    expect(
      fromNimStreamEvent({
        id: "x",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      }),
    ).toEqual({
      delta: {},
      done: true,
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 20 },
    });
  });
});
