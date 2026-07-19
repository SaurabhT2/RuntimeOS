import { z } from "zod";
import { gatewayErrorCodeSchema } from "@ai-gateway/core-contracts";
import { type RetryPolicy, BACKOFF_STRATEGIES } from "./retry-policy.js";

/**
 * architecture §31.2. The named profiles are the illustrative seed set
 * (architecture §31.3); `vision`/`embedding`/`agent` are reserved but
 * disabled until a corresponding `CapabilityAdapter` exists (architecture
 * §31.2's own comment, §42) — this package ships their schema/seed rows but
 * nothing consumes them yet (see `seed-data.ts`). Extensible beyond the
 * named set via `registerMapping`/`upsertProfile`, exactly like
 * `capability-registry`'s `TaskType`.
 */
export type ExecutionProfileId =
  | "extraction"
  | "classification"
  | "summarization"
  | "json_generation"
  | "reasoning"
  | "composition"
  | "coding"
  | "translation"
  | "vision"
  | "embedding"
  | "agent"
  | (string & {});

export const KNOWN_EXECUTION_PROFILE_IDS = [
  "extraction",
  "classification",
  "summarization",
  "json_generation",
  "reasoning",
  "composition",
  "coding",
  "translation",
  "vision",
  "embedding",
  "agent",
] as const;

/** architecture §31.2, verbatim shape. */
export interface ExecutionProfile {
  id: ExecutionProfileId;
  preferredModelClasses: string[];
  inference: {
    temperature: number;
    topP?: number;
    topK?: number;
    maxOutputTokens: number;
  };
  timeoutMs: number;
  retryPolicy: RetryPolicy;
  streaming: { defaultEnabled: boolean; chunking?: "token" | "sentence" };
  structuredOutput: { defaultEnabled: boolean };
  caching: { defaultEnabled: boolean; ttlSeconds?: number; keyStrategy: "exact" | "semantic" };
}

/**
 * architecture §31.2. Set by the Strategy Layer (Wave 8, EM-8) after
 * applying Runtime Profile (architecture §37) adjustments — per architecture
 * §31.4's own sequence diagram, the merge itself happens in `strategy-layer`,
 * not here or in `runtime-profiles`. This package exports the type now
 * (it's this package's own file per the architecture's illustrative code
 * path, `packages/strategy-layer/src/execution-profile-registry.ts` —
 * Blueprint §4.1 makes `execution-profile-registry` the actual top-level
 * package) so `strategy-layer` has it available the moment EM-8 begins,
 * without a wire-contract change to this package at that point.
 */
export interface ResolvedExecutionProfile extends ExecutionProfile {
  adjustedBy?: { runtimeProfileId: string; fieldsOverridden: string[] };
}

export const retryPolicySchema: z.ZodType<RetryPolicy> = z.object({
  maxAttempts: z.number().int().positive(),
  backoff: z.enum(BACKOFF_STRATEGIES),
  baseDelayMs: z.number().nonnegative(),
  maxDelayMs: z.number().nonnegative(),
  jitter: z.boolean(),
  retryableErrorCodes: z.array(gatewayErrorCodeSchema),
});

export const executionProfileSchema: z.ZodType<ExecutionProfile> = z.object({
  id: z.string().min(1),
  preferredModelClasses: z.array(z.string().min(1)),
  inference: z.object({
    temperature: z.number().min(0).max(2),
    topP: z.number().min(0).max(1).optional(),
    topK: z.number().int().positive().optional(),
    maxOutputTokens: z.number().int().positive(),
  }),
  timeoutMs: z.number().int().positive(),
  retryPolicy: retryPolicySchema,
  streaming: z.object({
    defaultEnabled: z.boolean(),
    chunking: z.enum(["token", "sentence"]).optional(),
  }),
  structuredOutput: z.object({ defaultEnabled: z.boolean() }),
  caching: z.object({
    defaultEnabled: z.boolean(),
    ttlSeconds: z.number().int().positive().optional(),
    keyStrategy: z.enum(["exact", "semantic"]),
  }),
});
