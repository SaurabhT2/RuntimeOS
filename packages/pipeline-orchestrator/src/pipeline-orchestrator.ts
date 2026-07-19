import { GatewayError, isGatewayError, type ExecuteResponse } from "@ai-gateway/core-contracts";
import type { ExecutionOrchestrator } from "@ai-gateway/orchestrator";
import type { ExecutionPipeline, PipelineContext, PipelineResult, PipelineStep } from "./types.js";

export interface PipelineOrchestratorOptions {
  /**
   * The *same*, unmodified `ExecutionOrchestrator` every other caller in
   * this platform uses (architecture §41.1: "reuses the existing
   * execution flow ... does not duplicate policy, provider, or retry
   * logic"). This package calls only `.execute()` — never a provider
   * adapter, `PolicyEngine`, or `AIStrategyLayer` directly.
   */
  orchestrator: ExecutionOrchestrator;
  /**
   * architecture ADR-014 (§46): a mandatory, platform-configured hard cap
   * on `pipeline.steps.length`, enforced *before* any step executes.
   * Defaults to `20` — this package's own documented, conservative
   * default (ADR-014 says "e.g., 20", not a fixed number); a deployment
   * that wants a different platform-wide cap sets this at construction
   * time, not per-pipeline (ADR-014: mandatory, not a per-request
   * opt-out).
   */
  maxSteps?: number;
}

/**
 * architecture §41: Multi-Step Execution Pipelines. Sequences ordinary
 * `ExecuteRequest`s through the existing `ExecutionOrchestrator.execute()`
 * — the *same* Strategy Layer → Policy Engine → Execution Plan → Provider
 * flow every single-request caller already goes through (architecture
 * §41.1). This class contains no execution logic of its own: no provider
 * calls, no retry/failover, no Strategy or Policy decisions — it only
 * decides *which* `ExecuteRequest` to build next and *whether* to keep
 * going.
 *
 * v1.2 scope (architecture §41.5, explicit): steps execute strictly
 * sequentially. No DAG, no fan-out/fan-in, no parallel step execution —
 * deferred to a future milestone, not attempted here.
 */
export class DefaultPipelineOrchestrator {
  private readonly orchestrator: ExecutionOrchestrator;
  private readonly maxSteps: number;

  constructor(options: PipelineOrchestratorOptions) {
    this.orchestrator = options.orchestrator;
    this.maxSteps = options.maxSteps ?? 20;
  }

  /**
   * `signal`, when provided, is checked *between* steps (never mid-step —
   * a step already in flight runs to completion, exactly like every other
   * `ExecutionOrchestrator.execute()` caller's own cancellation semantics,
   * architecture §17's streaming cancellation being the closest analogue).
   * A cancellation between steps behaves exactly like a `required` step
   * failure: the pipeline stops, `completed` is `false`, and every prior
   * step's result is still returned in `stepResults`.
   */
  async executePipeline(
    pipeline: ExecutionPipeline,
    signal?: AbortSignal,
  ): Promise<PipelineResult> {
    // ADR-014: enforced before any step executes — a pipeline that would
    // exceed the cap runs *zero* steps, not "runs until the cap is hit."
    if (pipeline.steps.length > this.maxSteps) {
      throw new GatewayError(
        "INVALID_TASK",
        `Pipeline "${pipeline.id}" has ${pipeline.steps.length} steps, exceeding the platform's maxSteps limit of ${this.maxSteps}.`,
        false,
        { pipelineId: pipeline.id, stepCount: pipeline.steps.length, maxSteps: this.maxSteps },
      );
    }

    const startedAt = Date.now();
    let ctx: PipelineContext = { pipelineId: pipeline.id, outputs: {} };
    const stepResults: PipelineResult["stepResults"] = {};
    let totalCostUsd = 0;
    let completed = true;

    for (const step of pipeline.steps) {
      if (signal?.aborted) {
        completed = false;
        break;
      }

      const outcome = await this.runStep(pipeline, step, ctx);
      stepResults[step.id] = outcome;

      if (isGatewayError(outcome)) {
        if (step.required ?? true) {
          completed = false;
          break;
        }
        // Non-required failure: recorded, pipeline continues, but this
        // step contributes no `outputs` entry (see `PipelineContext`'s own
        // doc comment) and no cost.
        continue;
      }

      totalCostUsd += outcome.usage.estimatedCostUsd;
      ctx = { ...ctx, outputs: { ...ctx.outputs, [step.id]: outcome } };
    }

    return {
      pipelineId: pipeline.id,
      stepResults,
      totalCostUsd,
      totalLatencyMs: Date.now() - startedAt,
      completed,
    };
  }

  private async runStep(
    pipeline: ExecutionPipeline,
    step: PipelineStep,
    ctx: PipelineContext,
  ): Promise<ExecuteResponse | GatewayError> {
    const input = step.buildInput(ctx);
    try {
      return await this.orchestrator.execute({ ...input, task: step.task, tenant: pipeline.tenant });
    } catch (error) {
      // `ExecutionOrchestrator.execute` never rejects with anything but a
      // `GatewayError` (its own doc comment, architecture §17) — this
      // catch exists to make that guarantee explicit at this call site
      // too, not to paper over an unexpected exception type.
      if (isGatewayError(error)) {
        return error;
      }
      return new GatewayError(
        "INTERNAL_ERROR",
        error instanceof Error ? error.message : "Unknown pipeline step failure.",
        false,
        { pipelineId: pipeline.id, stepId: step.id },
      );
    }
  }
}
