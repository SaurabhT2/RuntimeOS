import {
  GatewayError,
  type ExecuteRequest,
  type ExecuteResponse,
} from "@ai-gateway/core-contracts";
import type { ExecutionOrchestrator } from "@ai-gateway/orchestrator";
import { vi } from "vitest";
import type { ExecutionPipeline } from "../src/types.js";

export function fakeResponse(overrides: Partial<ExecuteResponse> = {}): ExecuteResponse {
  return {
    requestId: "req-1",
    output: { text: "ok" },
    usage: { inputTokens: 10, outputTokens: 5, estimatedCostUsd: 0.001 },
    execution: {
      providerId: "groq",
      modelClass: "fast-extraction",
      latencyMs: 5,
      retries: 0,
      failedOver: false,
    },
    finishReason: "stop",
    ...overrides,
  };
}

/**
 * A scriptable fake `ExecutionOrchestrator`: `script` maps a step's `task`
 * to either a fixed `ExecuteResponse`, a `GatewayError`, or a function of
 * the actual `ExecuteRequest` received (so a test can assert what
 * `buildInput` produced). Records every call for assertions.
 */
export function fakeOrchestrator(
  script: Record<
    string,
    ExecuteResponse | GatewayError | ((req: ExecuteRequest) => ExecuteResponse | GatewayError)
  >,
): ExecutionOrchestrator & { calls: ExecuteRequest[] } {
  const calls: ExecuteRequest[] = [];
  return {
    calls,
    execute: vi.fn(async (req: ExecuteRequest) => {
      calls.push(req);
      const scripted = script[req.task];
      const result = typeof scripted === "function" ? scripted(req) : scripted;
      if (!result) {
        throw new GatewayError("INTERNAL_ERROR", `No script entry for task "${req.task}"`, false);
      }
      if (result instanceof GatewayError) {
        throw result;
      }
      return result;
    }),
    executeStream: vi.fn(async function* () {
      throw new Error("pipeline-orchestrator never calls executeStream");
      // Matches the established `failingAdapter` pattern
      // (orchestrator/test/fixtures.ts): a generator needs a `yield` even
      // when it always throws first.
      yield { delta: {}, done: true };
    }),
    cancel: vi.fn(),
  };
}

export function pipeline(overrides: Partial<ExecutionPipeline> = {}): ExecutionPipeline {
  return {
    id: "pipeline-1",
    tenant: { organizationId: "org-1" },
    steps: [],
    ...overrides,
  };
}
