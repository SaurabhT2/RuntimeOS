import type { ChatMessage } from "@ai-gateway/core-contracts";
import type { ResolvedExecutionProfile } from "@ai-gateway/execution-profile-registry";
import type { TokenBudget } from "../src/types.js";

export function profile(
  id: string,
  overrides: Partial<ResolvedExecutionProfile> = {},
): ResolvedExecutionProfile {
  return {
    id,
    preferredModelClasses: ["fast-extraction"],
    inference: { temperature: 0.3, maxOutputTokens: 1024 },
    timeoutMs: 20_000,
    retryPolicy: {
      maxAttempts: 3,
      backoff: "exponential",
      baseDelayMs: 200,
      maxDelayMs: 4_000,
      jitter: true,
      retryableErrorCodes: [],
    },
    streaming: { defaultEnabled: false },
    structuredOutput: { defaultEnabled: false },
    caching: { defaultEnabled: false, keyStrategy: "exact" },
    ...overrides,
  };
}

export function msg(role: ChatMessage["role"], content: string): ChatMessage {
  return { role, content };
}

export function generousBudget(): TokenBudget {
  return { maxInputTokens: 100_000, reservedForOutput: 1_000 };
}
