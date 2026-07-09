import type { ExecuteResponse } from "@ai-gateway/core-contracts";
import type { NormalizedResult } from "./types.js";

/** Per-request execution bookkeeping the orchestrator accumulates across retries/failover. */
export interface ExecutionMeta {
  requestId: string;
  providerId: string;
  modelClass: string;
  latencyMs: number;
  retries: number;
  failedOver: boolean;
  /** Present when the plan carried an `estimateCost`-derived figure; `0` otherwise (never omitted — `usage.estimatedCostUsd` is a required field). */
  estimatedCostUsd: number;
}

/**
 * Translates a successful `NormalizedResult` (provider-facing) plus this
 * request's accumulated `ExecutionMeta` into the public `ExecuteResponse`
 * (architecture §10.4) — the mirror image of `invocation-builder.ts`'s
 * `buildNormalizedInvocation`. Pure, independently unit-tested.
 */
export function buildExecuteResponse(
  result: NormalizedResult,
  meta: ExecutionMeta,
): ExecuteResponse {
  return {
    requestId: meta.requestId,
    output: {
      text: result.text,
      json: result.json,
      toolCalls: result.toolCalls,
    },
    usage: {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      estimatedCostUsd: meta.estimatedCostUsd,
    },
    execution: {
      providerId: meta.providerId,
      modelClass: meta.modelClass,
      latencyMs: meta.latencyMs,
      retries: meta.retries,
      failedOver: meta.failedOver,
    },
    finishReason: result.finishReason,
  };
}
