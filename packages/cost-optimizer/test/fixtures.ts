import type { CapabilitySet } from "@ai-gateway/capability-registry";
import type { ResolvedExecutionProfile } from "@ai-gateway/execution-profile-registry";
import type { RuntimeProfile } from "@ai-gateway/runtime-profiles";
import { SEED_RUNTIME_PROFILES } from "@ai-gateway/runtime-profiles";

export function capabilities(overrides: Partial<CapabilitySet> = {}): CapabilitySet {
  return {
    structuredOutput: false,
    toolCalling: false,
    reasoningDepth: "moderate",
    streamingPreferred: false,
    minContextTokens: 4_000,
    ...overrides,
  };
}

export function reasoningProfile(
  overrides: Partial<ResolvedExecutionProfile> = {},
): ResolvedExecutionProfile {
  return {
    id: "reasoning",
    preferredModelClasses: ["complex-reasoning"],
    inference: { temperature: 0.4, maxOutputTokens: 4096 },
    timeoutMs: 60_000,
    retryPolicy: {
      maxAttempts: 2,
      backoff: "exponential",
      baseDelayMs: 500,
      maxDelayMs: 8_000,
      jitter: true,
      retryableErrorCodes: [],
    },
    streaming: { defaultEnabled: true, chunking: "token" },
    structuredOutput: { defaultEnabled: false },
    caching: { defaultEnabled: false, keyStrategy: "exact" },
    ...overrides,
  };
}

export function extractionProfile(
  overrides: Partial<ResolvedExecutionProfile> = {},
): ResolvedExecutionProfile {
  return {
    id: "extraction",
    preferredModelClasses: ["fast-extraction"],
    inference: { temperature: 0.0, maxOutputTokens: 128 },
    timeoutMs: 15_000,
    retryPolicy: {
      maxAttempts: 3,
      backoff: "exponential",
      baseDelayMs: 200,
      maxDelayMs: 4_000,
      jitter: true,
      retryableErrorCodes: [],
    },
    streaming: { defaultEnabled: false },
    structuredOutput: { defaultEnabled: true },
    caching: { defaultEnabled: true, ttlSeconds: 3600, keyStrategy: "exact" },
    ...overrides,
  };
}

export function runtimeProfile(id: RuntimeProfile["id"]): RuntimeProfile {
  const found = SEED_RUNTIME_PROFILES.find((p) => p.id === id);
  if (!found) {
    throw new Error(`no seed runtime profile "${id}"`);
  }
  return found;
}
