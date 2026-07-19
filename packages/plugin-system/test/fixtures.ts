import type { ExecuteRequest, ExecuteResponse } from "@ai-gateway/core-contracts";

export function request(overrides: Partial<ExecuteRequest> = {}): ExecuteRequest {
  return {
    task: "summarization",
    input: { text: "summarize this" },
    tenant: { organizationId: "org-1" },
    ...overrides,
  };
}

export function response(overrides: Partial<ExecuteResponse> = {}): ExecuteResponse {
  return {
    requestId: "req-1",
    output: { text: "a summary" },
    usage: { inputTokens: 10, outputTokens: 5, estimatedCostUsd: 0.001 },
    execution: {
      providerId: "groq",
      modelClass: "fast-extraction",
      latencyMs: 120,
      retries: 0,
      failedOver: false,
    },
    finishReason: "stop",
    ...overrides,
  };
}
