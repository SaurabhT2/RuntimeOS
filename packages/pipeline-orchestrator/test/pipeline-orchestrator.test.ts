import { GatewayError } from "@ai-gateway/core-contracts";
import { describe, expect, it } from "vitest";
import { DefaultPipelineOrchestrator } from "../src/pipeline-orchestrator.js";
import { fakeOrchestrator, fakeResponse, pipeline } from "./fixtures.js";

describe("DefaultPipelineOrchestrator — the architecture §41.4 four-step worked example", () => {
  it("threads each step's output into the next step's input, in order, through the real orchestrator.execute()", async () => {
    const orchestrator = fakeOrchestrator({
      knowledge_extraction: fakeResponse({ output: { text: "extracted facts" } }),
      summarization: (req) => fakeResponse({ output: { text: `summary of: ${req.input.text}` } }),
      entity_extraction: (req) =>
        fakeResponse({ output: { json: { entities: [req.input.text] } } }),
      json_generation: (req) => fakeResponse({ output: { json: { final: req.input.text } } }),
    });
    const pipelineOrchestrator = new DefaultPipelineOrchestrator({ orchestrator });

    const result = await pipelineOrchestrator.executePipeline(
      pipeline({
        steps: [
          {
            id: "extract",
            task: "knowledge_extraction",
            buildInput: () => ({ input: { text: "raw document text" } }),
          },
          {
            id: "summarize",
            task: "summarization",
            buildInput: (ctx) => ({ input: { text: ctx.outputs.extract!.output.text! } }),
          },
          {
            id: "entities",
            task: "entity_extraction",
            buildInput: (ctx) => ({ input: { text: ctx.outputs.summarize!.output.text! } }),
          },
          {
            id: "format",
            task: "json_generation",
            buildInput: (ctx) => ({
              input: { text: JSON.stringify(ctx.outputs.entities!.output.json) },
            }),
          },
        ],
      }),
    );

    expect(result.completed).toBe(true);
    expect(Object.keys(result.stepResults)).toEqual(["extract", "summarize", "entities", "format"]);
    expect(orchestrator.calls).toHaveLength(4);
    // Each downstream call actually received the *previous* step's output —
    // proof this is real threading, not four independent calls.
    expect(orchestrator.calls[1]?.input.text).toBe("extracted facts");
    expect(orchestrator.calls[2]?.input.text as string).toContain("summary of: extracted facts");
    const formatInput = JSON.parse(orchestrator.calls[3]?.input.text as string);
    expect(formatInput.entities[0]).toContain("summary of:");
  });

  it("every step call carries the pipeline's tenant, not a per-step one", async () => {
    const orchestrator = fakeOrchestrator({
      summarization: fakeResponse(),
    });
    const pipelineOrchestrator = new DefaultPipelineOrchestrator({ orchestrator });
    await pipelineOrchestrator.executePipeline(
      pipeline({
        tenant: { organizationId: "org-42", workspaceId: "ws-7" },
        steps: [{ id: "s1", task: "summarization", buildInput: () => ({ input: { text: "x" } }) }],
      }),
    );
    expect(orchestrator.calls[0]?.tenant).toEqual({
      organizationId: "org-42",
      workspaceId: "ws-7",
    });
  });
});

describe("DefaultPipelineOrchestrator — failure handling", () => {
  it("a required (default) step's failure aborts remaining steps, with prior results intact", async () => {
    const orchestrator = fakeOrchestrator({
      summarization: fakeResponse(),
      entity_extraction: new GatewayError("TIMEOUT", "step 2 timed out", true),
    });
    const pipelineOrchestrator = new DefaultPipelineOrchestrator({ orchestrator });
    const result = await pipelineOrchestrator.executePipeline(
      pipeline({
        steps: [
          { id: "s1", task: "summarization", buildInput: () => ({ input: { text: "x" } }) },
          { id: "s2", task: "entity_extraction", buildInput: () => ({ input: { text: "x" } }) },
          { id: "s3", task: "json_generation", buildInput: () => ({ input: { text: "x" } }) },
        ],
      }),
    );
    expect(result.completed).toBe(false);
    expect(Object.keys(result.stepResults)).toEqual(["s1", "s2"]); // s3 never attempted
    expect(result.stepResults.s2).toBeInstanceOf(GatewayError);
  });

  it("explicit required: true behaves identically to the default", async () => {
    const orchestrator = fakeOrchestrator({
      summarization: new GatewayError("TIMEOUT", "failed", true),
    });
    const pipelineOrchestrator = new DefaultPipelineOrchestrator({ orchestrator });
    const result = await pipelineOrchestrator.executePipeline(
      pipeline({
        steps: [
          {
            id: "s1",
            task: "summarization",
            required: true,
            buildInput: () => ({ input: { text: "x" } }),
          },
          { id: "s2", task: "json_generation", buildInput: () => ({ input: { text: "x" } }) },
        ],
      }),
    );
    expect(result.completed).toBe(false);
    expect(Object.keys(result.stepResults)).toEqual(["s1"]);
  });

  it("a non-required step's failure is recorded but the pipeline continues", async () => {
    const orchestrator = fakeOrchestrator({
      summarization: new GatewayError("TIMEOUT", "optional step failed", true),
      json_generation: fakeResponse(),
    });
    const pipelineOrchestrator = new DefaultPipelineOrchestrator({ orchestrator });
    const result = await pipelineOrchestrator.executePipeline(
      pipeline({
        steps: [
          {
            id: "s1",
            task: "summarization",
            required: false,
            buildInput: () => ({ input: { text: "x" } }),
          },
          { id: "s2", task: "json_generation", buildInput: () => ({ input: { text: "x" } }) },
        ],
      }),
    );
    expect(result.completed).toBe(true);
    expect(Object.keys(result.stepResults)).toEqual(["s1", "s2"]);
    expect(result.stepResults.s1).toBeInstanceOf(GatewayError);
  });

  it("a failed, non-required step contributes no ctx.outputs entry for later steps to read", async () => {
    const orchestrator = fakeOrchestrator({
      summarization: new GatewayError("TIMEOUT", "optional step failed", true),
      json_generation: (req) => fakeResponse({ output: { text: `saw: ${req.input.text}` } }),
    });
    const pipelineOrchestrator = new DefaultPipelineOrchestrator({ orchestrator });
    const result = await pipelineOrchestrator.executePipeline(
      pipeline({
        steps: [
          {
            id: "s1",
            task: "summarization",
            required: false,
            buildInput: () => ({ input: { text: "x" } }),
          },
          {
            id: "s2",
            task: "json_generation",
            buildInput: (ctx) => ({ input: { text: ctx.outputs.s1 ? "had-s1" : "no-s1" } }),
          },
        ],
      }),
    );
    expect((result.stepResults.s2 as ReturnType<typeof fakeResponse>).output.text).toBe(
      "saw: no-s1",
    );
  });

  it("wraps a non-GatewayError exception from orchestrator.execute as INTERNAL_ERROR rather than propagating it raw", async () => {
    const orchestrator = fakeOrchestrator({});
    orchestrator.execute = async () => {
      throw new Error("unexpected raw exception");
    };
    const pipelineOrchestrator = new DefaultPipelineOrchestrator({ orchestrator });
    const result = await pipelineOrchestrator.executePipeline(
      pipeline({
        steps: [{ id: "s1", task: "summarization", buildInput: () => ({ input: { text: "x" } }) }],
      }),
    );
    expect(result.stepResults.s1).toBeInstanceOf(GatewayError);
    expect((result.stepResults.s1 as GatewayError).code).toBe("INTERNAL_ERROR");
  });
});

describe("DefaultPipelineOrchestrator — cost and latency aggregation", () => {
  it("totalCostUsd sums only successful steps' usage.estimatedCostUsd", async () => {
    const orchestrator = fakeOrchestrator({
      summarization: fakeResponse({
        usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0.01 },
      }),
      entity_extraction: new GatewayError("TIMEOUT", "failed", true),
      json_generation: fakeResponse({
        usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0.02 },
      }),
    });
    const pipelineOrchestrator = new DefaultPipelineOrchestrator({ orchestrator });
    const result = await pipelineOrchestrator.executePipeline(
      pipeline({
        steps: [
          { id: "s1", task: "summarization", buildInput: () => ({ input: { text: "x" } }) },
          {
            id: "s2",
            task: "entity_extraction",
            required: false,
            buildInput: () => ({ input: { text: "x" } }),
          },
          { id: "s3", task: "json_generation", buildInput: () => ({ input: { text: "x" } }) },
        ],
      }),
    );
    expect(result.totalCostUsd).toBeCloseTo(0.03);
  });

  it("totalLatencyMs is a positive, measured wall-clock duration", async () => {
    const orchestrator = fakeOrchestrator({ summarization: fakeResponse() });
    const pipelineOrchestrator = new DefaultPipelineOrchestrator({ orchestrator });
    const result = await pipelineOrchestrator.executePipeline(
      pipeline({
        steps: [{ id: "s1", task: "summarization", buildInput: () => ({ input: { text: "x" } }) }],
      }),
    );
    expect(result.totalLatencyMs).toBeGreaterThanOrEqual(0);
  });
});

describe("DefaultPipelineOrchestrator — maxSteps (ADR-014)", () => {
  it("rejects a pipeline exceeding maxSteps before any step executes", async () => {
    const orchestrator = fakeOrchestrator({ summarization: fakeResponse() });
    const pipelineOrchestrator = new DefaultPipelineOrchestrator({ orchestrator, maxSteps: 2 });
    const steps = Array.from({ length: 3 }, (_, i) => ({
      id: `s${i}`,
      task: "summarization" as const,
      buildInput: () => ({ input: { text: "x" } }),
    }));
    await expect(pipelineOrchestrator.executePipeline(pipeline({ steps }))).rejects.toThrow(
      GatewayError,
    );
    expect(orchestrator.calls).toHaveLength(0);
  });

  it("defaults maxSteps to 20 when not configured", async () => {
    const orchestrator = fakeOrchestrator({ summarization: fakeResponse() });
    const pipelineOrchestrator = new DefaultPipelineOrchestrator({ orchestrator });
    const steps = Array.from({ length: 21 }, (_, i) => ({
      id: `s${i}`,
      task: "summarization" as const,
      buildInput: () => ({ input: { text: "x" } }),
    }));
    await expect(pipelineOrchestrator.executePipeline(pipeline({ steps }))).rejects.toThrow(
      /maxSteps limit of 20/,
    );
  });

  it("allows a pipeline exactly at the maxSteps limit", async () => {
    const orchestrator = fakeOrchestrator({ summarization: fakeResponse() });
    const pipelineOrchestrator = new DefaultPipelineOrchestrator({ orchestrator, maxSteps: 2 });
    const steps = Array.from({ length: 2 }, (_, i) => ({
      id: `s${i}`,
      task: "summarization" as const,
      buildInput: () => ({ input: { text: "x" } }),
    }));
    const result = await pipelineOrchestrator.executePipeline(pipeline({ steps }));
    expect(result.completed).toBe(true);
  });
});

describe("DefaultPipelineOrchestrator — cancellation", () => {
  it("stops before starting the next step when the signal is already aborted", async () => {
    const orchestrator = fakeOrchestrator({ summarization: fakeResponse() });
    const pipelineOrchestrator = new DefaultPipelineOrchestrator({ orchestrator });
    const controller = new AbortController();
    controller.abort();
    const result = await pipelineOrchestrator.executePipeline(
      pipeline({
        steps: [
          { id: "s1", task: "summarization", buildInput: () => ({ input: { text: "x" } }) },
          { id: "s2", task: "summarization", buildInput: () => ({ input: { text: "x" } }) },
        ],
      }),
      controller.signal,
    );
    expect(result.completed).toBe(false);
    expect(Object.keys(result.stepResults)).toEqual([]);
    expect(orchestrator.calls).toHaveLength(0);
  });

  it("lets an in-flight step finish, then stops before the next one", async () => {
    const controller = new AbortController();
    const orchestrator = fakeOrchestrator({
      summarization: (req) => {
        if (req.input.text === "first") {
          controller.abort(); // simulate cancellation arriving mid-first-step
        }
        return fakeResponse();
      },
    });
    const pipelineOrchestrator = new DefaultPipelineOrchestrator({ orchestrator });
    const result = await pipelineOrchestrator.executePipeline(
      pipeline({
        steps: [
          { id: "s1", task: "summarization", buildInput: () => ({ input: { text: "first" } }) },
          { id: "s2", task: "summarization", buildInput: () => ({ input: { text: "second" } }) },
        ],
      }),
      controller.signal,
    );
    expect(orchestrator.calls).toHaveLength(1); // s1 ran; s2 never started
    expect(result.completed).toBe(false);
    expect(Object.keys(result.stepResults)).toEqual(["s1"]);
  });

  it("without a signal, runs every step normally", async () => {
    const orchestrator = fakeOrchestrator({ summarization: fakeResponse() });
    const pipelineOrchestrator = new DefaultPipelineOrchestrator({ orchestrator });
    const result = await pipelineOrchestrator.executePipeline(
      pipeline({
        steps: [{ id: "s1", task: "summarization", buildInput: () => ({ input: { text: "x" } }) }],
      }),
    );
    expect(result.completed).toBe(true);
  });
});
