import { describe, expect, it } from "vitest";
import { buildExecuteResponse, type ExecutionMeta } from "../src/response-mapper.js";
import type { NormalizedResult } from "../src/types.js";

function meta(overrides: Partial<ExecutionMeta> = {}): ExecutionMeta {
  return {
    requestId: "req-1",
    providerId: "groq",
    modelClass: "fast-extraction",
    latencyMs: 120,
    retries: 0,
    failedOver: false,
    estimatedCostUsd: 0.002,
    ...overrides,
  };
}

function result(overrides: Partial<NormalizedResult> = {}): NormalizedResult {
  return {
    text: "hello",
    usage: { inputTokens: 3, outputTokens: 4 },
    finishReason: "stop",
    ...overrides,
  };
}

describe("buildExecuteResponse", () => {
  it("maps every NormalizedResult + ExecutionMeta field into the ExecuteResponse shape", () => {
    const response = buildExecuteResponse(result(), meta());
    expect(response).toEqual({
      requestId: "req-1",
      output: { text: "hello", json: undefined, toolCalls: undefined },
      usage: { inputTokens: 3, outputTokens: 4, estimatedCostUsd: 0.002 },
      execution: {
        providerId: "groq",
        modelClass: "fast-extraction",
        latencyMs: 120,
        retries: 0,
        failedOver: false,
      },
      finishReason: "stop",
    });
  });

  it("carries json output through for structured-output results", () => {
    const response = buildExecuteResponse(
      result({ text: undefined, json: { a: 1 }, finishReason: "stop" }),
      meta(),
    );
    expect(response.output.json).toEqual({ a: 1 });
  });

  it("carries toolCalls through for tool_call finishes", () => {
    const toolCalls = [{ id: "t1", name: "lookup", arguments: "{}" }];
    const response = buildExecuteResponse(
      result({ text: undefined, toolCalls, finishReason: "tool_call" }),
      meta(),
    );
    expect(response.output.toolCalls).toEqual(toolCalls);
    expect(response.finishReason).toBe("tool_call");
  });

  it("reflects retries and failedOver from the accumulated ExecutionMeta", () => {
    const response = buildExecuteResponse(
      result(),
      meta({ retries: 2, failedOver: true, providerId: "nvidia-nim" }),
    );
    expect(response.execution.retries).toBe(2);
    expect(response.execution.failedOver).toBe(true);
    expect(response.execution.providerId).toBe("nvidia-nim");
  });
});
