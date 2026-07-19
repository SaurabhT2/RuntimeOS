import { z } from "zod";

/**
 * architecture §35.1's `ModelDescriptor.lifecycle.state` field. Duplicated
 * here (not imported from `model-registry`) for two independent reasons:
 * 1. This package's frozen dependency edge (Blueprint §4.1) is `config`
 *    only — a `model-registry` edge isn't declared and would be a genuine
 *    layering inversion (`runtime-profiles` sits below `strategy-layer`,
 *    which is the package the architecture actually names as
 *    `model-registry`'s consumer for lifecycle metadata, per the root
 *    dependency rule comment in architecture §4/the file-tree section).
 * 2. `model-registry`'s `ModelDescriptor` does not have a `lifecycle` field
 *    yet — architecture §35 is the specification for it, but adding it is
 *    scoped to a different milestone than this one (Blueprint's EM-6 lists
 *    only `capability-registry`, `execution-profile-registry`,
 *    `runtime-profiles`; the architecture spec's own roadmap addendum
 *    Milestone 9 bundles that field-add with a Policy Engine change this
 *    milestone explicitly does not make). `allowedLifecycleStates` is
 *    still part of `RuntimeProfile`'s schema today, exactly as §37.2
 *    specifies — it simply has no consumer until the Policy Engine's
 *    Candidate Query (§13.2) is updated to filter by it, per §37.4.
 */
export const MODEL_LIFECYCLE_STATES = [
  "experimental",
  "preview",
  "recommended",
  "stable",
  "deprecated",
  "retired",
] as const;
export type ModelLifecycleState = (typeof MODEL_LIFECYCLE_STATES)[number];

/** architecture §37.2, verbatim. */
export type RuntimeProfileId =
  | "development"
  | "free_tier"
  | "production"
  | "enterprise"
  | "offline"
  | "high_availability"
  | (string & {});

export const KNOWN_RUNTIME_PROFILE_IDS = [
  "development",
  "free_tier",
  "production",
  "enterprise",
  "offline",
  "high_availability",
] as const;

/** architecture §37.2, verbatim shape. */
export interface RuntimeProfile {
  id: RuntimeProfileId;
  provider: {
    preferFreeTier: boolean;
    /** e.g. `enterprise` excludes `"experimental"` — architecture §37.2's own comment. */
    allowedLifecycleStates: ModelLifecycleState[];
    maxProvidersInFailoverChain: number;
  };
  reliability: {
    retryAggressiveness: "conservative" | "standard" | "aggressive";
    failoverAggressiveness: "conservative" | "standard" | "aggressive";
  };
  cost: {
    tokenUsageCeilingPerRequest?: number;
    dailyBudgetUsd?: number;
  };
  telemetry: {
    verbosity: "minimal" | "standard" | "verbose";
  };
  caching: {
    aggressiveness: "off" | "standard" | "aggressive";
  };
}

export const runtimeProfileSchema: z.ZodType<RuntimeProfile> = z.object({
  id: z.string().min(1),
  provider: z.object({
    preferFreeTier: z.boolean(),
    allowedLifecycleStates: z.array(z.enum(MODEL_LIFECYCLE_STATES)),
    maxProvidersInFailoverChain: z.number().int().positive(),
  }),
  reliability: z.object({
    retryAggressiveness: z.enum(["conservative", "standard", "aggressive"]),
    failoverAggressiveness: z.enum(["conservative", "standard", "aggressive"]),
  }),
  cost: z.object({
    tokenUsageCeilingPerRequest: z.number().int().positive().optional(),
    dailyBudgetUsd: z.number().positive().optional(),
  }),
  telemetry: z.object({
    verbosity: z.enum(["minimal", "standard", "verbose"]),
  }),
  caching: z.object({
    aggressiveness: z.enum(["off", "standard", "aggressive"]),
  }),
});
