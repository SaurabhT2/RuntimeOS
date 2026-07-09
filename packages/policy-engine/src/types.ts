import type { RetryPolicy } from "@ai-gateway/reliability";

/**
 * architecture §13.1, verbatim shape. The concrete, ready-to-execute output
 * of the Policy Engine's decision pipeline (§13.2). `providers/groq` and
 * `providers/nvidia-nim` never see this type directly — the orchestrator
 * (EM-4) is the seam that translates an `ExecutionPlan` into the
 * `NormalizedInvocation` + `ScopedCredential` pair a `ProviderAdapter`
 * actually consumes (see this package's README, "Relationship to
 * orchestrator/streaming").
 */
export interface ExecutionPlan {
  providerId: string;
  modelId: string;
  modelClass: string;
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
  retryPolicy: RetryPolicy;
  streaming: boolean;
  /** Ordered failover chain, pre-computed (architecture §13.2 step 5, ADR-005). */
  fallbackPlans: ExecutionPlan[];
}

/**
 * architecture §11's `PolicyEngine.selectExecutionPlan(req, ctx: PolicyContext)`
 * — `PolicyContext`'s shape isn't spelled out there. Designed, not
 * specified: carries request-scoped routing input that does not belong on
 * the public `ExecuteRequest` wire contract (architecture §10.1's "no field
 * ever accepts a provider name from the caller" — `routingOverride` is an
 * operator/workspace-level policy decision, never caller-supplied) and that
 * `policy-engine` cannot resolve itself, since it has no dependency on
 * `@ai-gateway/config` (Section 4.1's `DEPENDENCY_TABLE`). A future
 * composition root (`apps/gateway-server/src/bootstrap.ts`, or the
 * orchestrator, EM-4) is expected to resolve a workspace/org's
 * `GatewayConfig.routing.perTaskOverrides` and pass the result in here per
 * call — seeAgentDecisions / ADR candidate in this milestone's README for
 * why that wiring is deliberately not built yet.
 */
export interface PolicyContext {
  /**
   * Mirrors `@ai-gateway/config`'s `RoutingOverride` shape field-for-field
   * (same duplication rationale as `provider-sdk`'s `CredentialScope` /
   * `reliability`'s `ProviderHealthSnapshot`: an allowed dependency edge
   * doesn't exist for importing the original type, so an equivalent local
   * shape is defined instead).
   */
  routingOverride?: RoutingOverrideLike;
  /** Injectable clock, test seam only. Defaults to `() => new Date()`. */
  now?: () => Date;
}

export const ROUTING_STRATEGIES = [
  "cost_optimized",
  "latency_optimized",
  "quality_optimized",
] as const;
export type RoutingStrategy = (typeof ROUTING_STRATEGIES)[number];

export interface RoutingOverrideLike {
  strategy?: RoutingStrategy;
  preferredProviders?: string[];
}

/**
 * architecture §13.3's four named weights, as `GatewayConfig.routing`
 * overridable knobs. `policy-engine` cannot read `GatewayConfig` itself
 * (no dependency edge), so these are supplied as constructor options with
 * documented, sane defaults instead (Blueprint §7's "static weights, no
 * cost/capability sophistication yet" EM-3 scope) — a future composition
 * root wires `GatewayConfig.routing`'s values into these same fields.
 */
export interface ScoringWeights {
  quality: number;
  latency: number;
  cost: number;
  health: number;
}

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  quality: 0.4,
  latency: 0.25,
  cost: 0.2,
  health: 0.15,
};

/** architecture §13.2 step 1's output: what a candidate model must support. */
export interface CapabilityRequirement {
  requiresJsonMode: boolean;
  requiresToolCalling: boolean;
  requiresStreaming: boolean;
  minContextTokens?: number;
  maxCostUsd?: number;
  /** Soft signal (0-1) for how much the task rewards a high `creativityScore`, used by the scorer, not the candidate filter. */
  creativityAffinity: number;
  /** Soft signal for how much the task rewards deep `reasoningDepth`, used by the scorer, not the candidate filter. */
  reasoningAffinity: number;
}

/**
 * A per-model score with its breakdown retained for testability/observability
 * — never exposed on `ExecutionPlan` itself, but useful for unit tests and
 * (later) telemetry/debugging tooling to assert *why* a candidate ranked
 * where it did, not just that it did.
 */
export interface ScoredCandidate {
  providerId: string;
  modelId: string;
  modelClass: string;
  score: number;
  breakdown: {
    quality: number;
    latency: number;
    cost: number;
    health: number;
    rateLimitPenalty: number;
  };
  contextWindow: number;
  structuredOutput: boolean;
  toolCalling: boolean;
  streaming: boolean;
}

/**
 * Small, independently-testable predicate objects that can veto or force a
 * candidate after scoring (architecture §13.4). Registered via constructor
 * options in EM-3 (see this package's README, Engineering Decisions) rather
 * than "via config" as architecture §13.4 states verbatim — `policy-engine`
 * has no dependency on `@ai-gateway/config` to read rule configuration
 * from, so a future composition root is expected to translate config-driven
 * rule declarations into `RoutingRule` instances before construction.
 */
export interface RoutingRule {
  name: string;
  applies(ctx: PolicyContext): boolean;
  apply(candidates: ScoredCandidate[], ctx: PolicyContext): ScoredCandidate[];
}

export interface PolicyEngineConfig {
  weights?: Partial<ScoringWeights>;
  rules?: RoutingRule[];
  /** Number of candidates (beyond the primary) pre-computed as `fallbackPlans` (architecture §13.2 step 5: "1-2 candidates"). Defaults to 2. */
  maxFallbacks?: number;
  /** Default `maxOutputTokens` when neither the request nor a future Execution Profile specifies one. Defaults to 1024. */
  defaultMaxOutputTokens?: number;
  /** Default per-attempt timeout, ms. Defaults to 15000. */
  defaultTimeoutMs?: number;
}
