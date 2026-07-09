import { z } from "zod";

/**
 * architecture §14.1, verbatim shape. One entry per `(providerId, modelId)`
 * pair — the unit of data the registry stores, serves, and lets an
 * operator update without a redeploy (architecture §14.2).
 */
export interface ModelDescriptor {
  /** e.g. "groq" */
  providerId: string;
  /** The provider's native model identifier. */
  modelId: string;
  /** e.g. "fast-extraction" | "complex-reasoning" | "creative" | ... */
  modelClass: string;
  capabilities: {
    contextWindow: number;
    structuredOutput: boolean;
    streaming: boolean;
    toolCalling: boolean;
    reasoningDepth: "shallow" | "moderate" | "deep";
    /** 0-1, curated/benchmarked. */
    creativityScore: number;
  };
  performance: {
    p50LatencyMs: number;
    p99LatencyMs: number;
    tokensPerSecond: number;
  };
  cost: {
    inputPer1kTokensUsd: number;
    outputPer1kTokensUsd: number;
    tier: "free" | "paid";
  };
  availability: {
    enabled: boolean;
    regions?: string[];
    rateLimits: { requestsPerMinute?: number; tokensPerMinute?: number };
  };
}

export const REASONING_DEPTHS = ["shallow", "moderate", "deep"] as const;
export const COST_TIERS = ["free", "paid"] as const;

export const modelDescriptorSchema: z.ZodType<ModelDescriptor> = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  modelClass: z.string().min(1),
  capabilities: z.object({
    contextWindow: z.number().int().positive(),
    structuredOutput: z.boolean(),
    streaming: z.boolean(),
    toolCalling: z.boolean(),
    reasoningDepth: z.enum(REASONING_DEPTHS),
    creativityScore: z.number().min(0).max(1),
  }),
  performance: z.object({
    p50LatencyMs: z.number().nonnegative(),
    p99LatencyMs: z.number().nonnegative(),
    tokensPerSecond: z.number().nonnegative(),
  }),
  cost: z.object({
    inputPer1kTokensUsd: z.number().nonnegative(),
    outputPer1kTokensUsd: z.number().nonnegative(),
    tier: z.enum(COST_TIERS),
  }),
  availability: z.object({
    enabled: z.boolean(),
    regions: z.array(z.string().min(1)).optional(),
    rateLimits: z.object({
      requestsPerMinute: z.number().int().positive().optional(),
      tokensPerMinute: z.number().int().positive().optional(),
    }),
  }),
});

/**
 * `providerId` + `modelId` together are the registry's primary key
 * (architecture §14.1: "One entry per `(providerId, modelId)` pair" is
 * this package's own reading of §14 — not spelled out as a formal key
 * anywhere in the architecture doc, but implied by `ModelRegistry.getModel`
 * taking exactly those two fields, architecture §11).
 */
export interface ModelKey {
  providerId: string;
  modelId: string;
}

/**
 * architecture §11's `queryModels(filter: ModelQuery)` — `ModelQuery`'s
 * shape isn't spelled out there. Designed, not specified: every field is
 * optional and ANDed together, mirroring the filterable fields an operator
 * or the Policy Engine (architecture §13.2's Candidate Query step, Wave 3)
 * would realistically need — task-appropriate `modelClass`, a specific
 * `providerId`, and `enabledOnly` to exclude availability-disabled entries
 * by default.
 */
export interface ModelQuery {
  providerId?: string;
  modelClass?: string;
  /** Only return entries with `availability.enabled === true`. Defaults to `true` at the call site (see `registry.ts`). */
  enabledOnly?: boolean;
  /** Only return entries whose `capabilities.contextWindow` is at least this large. */
  minContextWindow?: number;
  /** Only return entries whose `capabilities.structuredOutput` is `true`. */
  requiresStructuredOutput?: boolean;
  /** Only return entries whose `capabilities.toolCalling` is `true`. */
  requiresToolCalling?: boolean;
  /** Only return entries whose `cost.tier` matches. */
  costTier?: ModelDescriptor["cost"]["tier"];
}
