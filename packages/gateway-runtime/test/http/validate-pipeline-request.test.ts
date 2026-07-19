import { GatewayError } from "@ai-gateway/core-contracts";
import { describe, expect, it } from "vitest";
import { validatePipelineRequest } from "../../src/http/validate-pipeline-request.js";

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    id: "pipeline-1",
    tenant: { organizationId: "org-1" },
    steps: [{ id: "s1", task: "summarization", input: { text: "hello" } }],
    ...overrides,
  };
}

describe("validatePipelineRequest", () => {
  it("accepts a well-formed pipeline with a literal input step", () => {
    const pipeline = validatePipelineRequest(validBody());
    expect(pipeline.id).toBe("pipeline-1");
    expect(pipeline.steps).toHaveLength(1);
  });

  it("throws INVALID_SCHEMA for a missing tenant", () => {
    const body = validBody();
    delete (body as Record<string, unknown>).tenant;
    expect(() => validatePipelineRequest(body)).toThrow(GatewayError);
    try {
      validatePipelineRequest(body);
      expect.unreachable();
    } catch (error) {
      expect((error as GatewayError).code).toBe("INVALID_SCHEMA");
    }
  });

  it("throws INVALID_SCHEMA for an empty steps array", () => {
    expect(() => validatePipelineRequest(validBody({ steps: [] }))).toThrow(GatewayError);
  });

  it("throws INVALID_SCHEMA for a step with neither input nor inputFrom", () => {
    expect(() =>
      validatePipelineRequest(validBody({ steps: [{ id: "s1", task: "summarization" }] })),
    ).toThrow(GatewayError);
  });

  it("throws INVALID_SCHEMA for duplicate step ids", () => {
    expect(() =>
      validatePipelineRequest(
        validBody({
          steps: [
            { id: "s1", task: "summarization", input: { text: "a" } },
            { id: "s1", task: "summarization", input: { text: "b" } },
          ],
        }),
      ),
    ).toThrow(GatewayError);
  });

  it("throws INVALID_SCHEMA for an inputFrom referencing an unknown step", () => {
    expect(() =>
      validatePipelineRequest(
        validBody({ steps: [{ id: "s1", task: "summarization", inputFrom: "nope" }] }),
      ),
    ).toThrow(GatewayError);
  });

  it("accepts an inputFrom referencing a real, earlier step", () => {
    const pipeline = validatePipelineRequest(
      validBody({
        steps: [
          { id: "s1", task: "summarization", input: { text: "a" } },
          { id: "s2", task: "summarization", inputFrom: "s1" },
        ],
      }),
    );
    expect(pipeline.steps).toHaveLength(2);
  });

  describe("buildInput translation", () => {
    it("a literal-input step's buildInput returns exactly that input, ignoring ctx", () => {
      const pipeline = validatePipelineRequest(validBody());
      const result = pipeline.steps[0]!.buildInput({ pipelineId: "p", outputs: {} });
      expect(result).toEqual({ input: { text: "hello" } });
    });

    it("an inputFrom step's buildInput reads the referenced step's output.text", () => {
      const pipeline = validatePipelineRequest(
        validBody({
          steps: [
            { id: "s1", task: "summarization", input: { text: "a" } },
            { id: "s2", task: "summarization", inputFrom: "s1" },
          ],
        }),
      );
      const ctx = {
        pipelineId: "p",
        outputs: {
          s1: {
            requestId: "r1",
            output: { text: "step one's result" },
            usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 },
            execution: { providerId: "groq", modelClass: "fast-extraction", latencyMs: 1, retries: 0, failedOver: false },
            finishReason: "stop" as const,
          },
        },
      };
      const result = pipeline.steps[1]!.buildInput(ctx);
      expect(result).toEqual({ input: { text: "step one's result" } });
    });

    it("an inputFrom step falls back to JSON.stringify(output.json) when output.text is absent", () => {
      const pipeline = validatePipelineRequest(
        validBody({
          steps: [
            { id: "s1", task: "json_generation", input: { text: "a" } },
            { id: "s2", task: "summarization", inputFrom: "s1" },
          ],
        }),
      );
      const ctx = {
        pipelineId: "p",
        outputs: {
          s1: {
            requestId: "r1",
            output: { json: { foo: "bar" } },
            usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 },
            execution: { providerId: "groq", modelClass: "fast-extraction", latencyMs: 1, retries: 0, failedOver: false },
            finishReason: "stop" as const,
          },
        },
      };
      const result = pipeline.steps[1]!.buildInput(ctx);
      expect(result).toEqual({ input: { text: JSON.stringify({ foo: "bar" }) } });
    });

    it("an inputFrom step throws INVALID_TASK if the referenced step has no output yet (not run, or failed)", () => {
      const pipeline = validatePipelineRequest(
        validBody({
          steps: [
            { id: "s1", task: "summarization", input: { text: "a" } },
            { id: "s2", task: "summarization", inputFrom: "s1" },
          ],
        }),
      );
      expect(() => pipeline.steps[1]!.buildInput({ pipelineId: "p", outputs: {} })).toThrow(
        GatewayError,
      );
    });
  });
});
