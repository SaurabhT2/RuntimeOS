import type {
  ExecuteRequest,
  ExecuteResponse,
  GatewayError,
  TaskType,
} from "@ai-gateway/core-contracts";

/**
 * architecture §41.2, verbatim: one step in an `ExecutionPipeline`. Every
 * step still executes through the ordinary, unmodified `ExecuteRequest`
 * shape (architecture §10.3) — a pipeline step is not a new kind of
 * request, it's an ordinary one whose `input` is computed from prior
 * steps' outputs instead of supplied directly by the caller.
 */
export interface PipelineStep {
  id: string;
  task: TaskType;
  /**
   * Builds this step's `ExecuteRequest` from the pipeline's running
   * context — `ctx.outputs[someEarlierStep.id]` is how a later step
   * consumes an earlier one's result. Pure (same `ctx` → same request);
   * this package never mutates a `PipelineContext` it's given, it only
   * ever produces a new one (`{...ctx, outputs: {...}}`) between steps —
   * matching `strategy-layer`'s own established "return a fresh object,
   * never mutate the one you were given" convention.
   *
   * Omits both `task` (`PipelineStep.task`, above, always wins) and
   * `tenant` (`ExecutionPipeline.tenant`, below, always wins — every step
   * in one pipeline shares the same tenant; there is no such thing as a
   * per-step tenant override) — a step only ever needs to supply `input`
   * and, optionally, `constraints`/`preferences`.
   */
  buildInput: (ctx: PipelineContext) => Omit<ExecuteRequest, "task" | "tenant">;
  /**
   * Defaults to `true` (architecture §41.2's own words: "the default").
   * `false` means this step's failure is recorded in `stepResults` and the
   * pipeline continues to the next step; `true` (or omitted) means this
   * step's failure aborts every remaining step.
   */
  required?: boolean;
}

/** architecture §41.2, verbatim. */
export interface ExecutionPipeline {
  id: string;
  tenant: ExecuteRequest["tenant"];
  steps: PipelineStep[];
}

/** architecture §41.2, verbatim. */
export interface PipelineContext {
  pipelineId: string;
  /** Only successful steps' responses — a failed, non-required step has no entry here (it has nothing a later step's `buildInput` could meaningfully read), though it does have one in `stepResults` below. */
  outputs: Record<string, ExecuteResponse>;
}

/** architecture §41.2, verbatim. */
export interface PipelineResult {
  pipelineId: string;
  /** Every step that was attempted — successful ones as `ExecuteResponse`, failed ones (whether `required` or not) as the `GatewayError` that stopped them. A step never reached because an earlier `required` step failed has no entry at all. */
  stepResults: Record<string, ExecuteResponse | GatewayError>;
  /** Sum of every *successful* step's `usage.estimatedCostUsd` (architecture §41.2, verbatim: "sum of each step's already-recorded usage.estimatedCostUsd") — a failed step contributed nothing to execute, so it contributes nothing here either. */
  totalCostUsd: number;
  /**
   * Measured wall-clock duration of the whole `executePipeline` call, in
   * milliseconds. Not architecture-specified as sum-vs-wall-clock (§41.2's
   * snippet names the field but not its derivation) — wall-clock is this
   * package's documented choice: it stays correct if a future milestone
   * ever parallelizes independent steps (§41.5's explicitly deferred
   * scope), where a sum of per-step latencies would silently become
   * wrong, and it needs no per-step latency field that a `GatewayError`
   * (an aborted/failed step) wouldn't have anyway.
   */
  totalLatencyMs: number;
  /**
   * `true` iff every step in `pipeline.steps` was attempted — i.e. no
   * `required` step's failure aborted the pipeline early. A non-required
   * step's own failure does not, by itself, make this `false`: a pipeline
   * that ran to the end of its step list despite an optional step failing
   * along the way is still `completed: true` (check that step's own entry
   * in `stepResults` to see whether it succeeded).
   */
  completed: boolean;
}
