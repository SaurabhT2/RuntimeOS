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
 * architecture §30.3's `StrategyDecision` (`@ai-gateway/strategy-layer`'s
 * own exported type), duplicated here as a small, structurally-compatible
 * local shape — same rationale as `RoutingOverrideLike` immediately below:
 * `policy-engine` has no dependency edge onto `strategy-layer` (and, per
 * ADR-0016/ADR-0018, must not gain one — `strategy-layer` itself never
 * depends on `policy-engine` either, after ADR-0016's correction, so
 * adding an edge here would create a fresh, needless coupling in a
 * direction this package has never had one), nor onto
 * `capability-registry`/`execution-profile-registry`/`cost-optimizer`/
 * `prompt-optimizer` for the same reason.
 *
 * **EM-9 (Independent Architecture & Engineering Review of EM-9,
 * activating what ADR-0018 deliberately deferred):** ADR-0018 typed every
 * field here as `unknown` because `DefaultPolicyEngine` did not read into
 * any of them that milestone — "structural precision beyond 'this is
 * present or absent' has no consumer yet," in that ADR's own words. EM-9
 * is that consumer. Each field below is now a small, locally-declared
 * shape covering only the sub-fields `DefaultPolicyEngine` actually reads
 * (`deriveCapabilityRequirement`/`deriveStrategySignals`/`assemblePlan` in
 * `policy-engine.ts`) — still no new dependency edge, still
 * structurally-open beyond that (e.g. `CapabilitySetLike` omits
 * `visionInput`/`audioInput`, which nothing here reads), and still
 * validated defensively at every read site (`isCapabilitySetLike` et al.,
 * `strategy-signals.ts`) rather than trusted blindly — a value that came
 * from `unknown` a milestone ago gets no special trust just because this
 * file now gives it a name.
 */
export interface CapabilitySetLike {
  structuredOutput?: unknown;
  toolCalling?: unknown;
  reasoningDepth?: unknown;
  streamingPreferred?: unknown;
  minContextTokens?: unknown;
}

export interface ResolvedExecutionProfileLike {
  preferredModelClasses?: unknown;
  inference?: {
    temperature?: unknown;
    maxOutputTokens?: unknown;
  };
  timeoutMs?: unknown;
  retryPolicy?: unknown;
  streaming?: {
    defaultEnabled?: unknown;
  };
}

export interface CostOptimizationResultLike {
  recommendedModelClassDowngrade?: unknown;
  disableStreaming?: unknown;
  preferFreeTierProviders?: unknown;
}

export interface StrategyDecisionLike {
  requiredCapabilities: CapabilitySetLike | unknown;
  executionProfile: ResolvedExecutionProfileLike | unknown;
  optimizations: {
    cost: CostOptimizationResultLike | unknown;
    prompt: unknown;
  };
  cacheHit?: unknown;
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
  /**
   * architecture §13.5 / EM-8 (ADR-0018): the `strategy-layer`-resolved
   * decision for this request, when the Strategy Layer is enabled
   * (`GatewayConfig.enableStrategyLayer`, ADR-0017). `orchestrator`
   * supplies this.
   *
   * **EM-9 update:** as of EM-9 (Independent Architecture & Engineering
   * Review of EM-9), `DefaultPolicyEngine` reads this field —
   * `deriveCapabilityRequirement`/`deriveStrategySignals` in
   * `policy-engine.ts` — architecture §13.1–§13.4's scoring/candidate-query/
   * routing-rules *pipeline stages* are still exactly the ones EM-3 built
   * (still Task Classifier → Candidate Query → Scoring → Ranking → Plan
   * Assembly, still the same weighted-sum formula, §13.3), but several of
   * those stages' *inputs* now come from this field when it is present and
   * well-formed, superseding the `ExecuteRequest`-only inputs EM-3 used —
   * this is the literal reading of architecture §13.5 ("it simply operates
   * on the richer, pre-resolved `StrategyDecision` instead of the raw
   * request") that ADR-0018 deliberately deferred. Every one of those
   * inputs is a **soft** signal (a scoring nudge or an execution-profile
   * default), never a hard override of a capability/schema/provider/model-class
   * constraint (architecture §33.3: "never overrides a hard capability
   * requirement") — and a present-but-malformed `strategyDecision` (this
   * field's structural typing, `StrategyDecisionLike`, is deliberately
   * loose) falls back to the exact EM-3/EM-8 behavior field-by-field rather
   * than throwing. See this package's README, "EM-9 Architecture Compliance
   * Notes," for the full field-by-field accounting, and ADR-0018 for why
   * this is a field on the existing `PolicyContext` rather than a change to
   * `selectExecutionPlan`'s own signature (that reasoning is unchanged by
   * EM-9 — the signature still hasn't changed, only this field's
   * consumption has).
   */
  strategyDecision?: StrategyDecisionLike;
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
 * EM-9 (Independent Architecture & Engineering Review of EM-9): soft
 * scoring signals derived from a well-formed `PolicyContext.strategyDecision`,
 * consumed by `model-scorer.ts`. Every field here is optional and every
 * consumer treats absence as "no signal, behave exactly as EM-3/EM-8 did" —
 * this type carries *nudges* to the existing four §13.3 weighted terms
 * (quality, cost), never a new term and never a hard filter (candidate
 * filtering happens earlier, in `queryCandidates`, and is untouched by
 * this type).
 */
export interface StrategySignals {
  /**
   * architecture §31.2: "`preferredModelClasses`: ordered preference,
   * consumed by Policy Engine scoring (Section 13.3)." A candidate whose
   * `modelClass` appears earlier in this list scores a bigger bonus inside
   * the existing `quality` term (`model-scorer.ts`'s `qualityScoreForTask`,
   * the same place the existing `structuredBonus` already lives) — never a
   * new, fifth weighted term.
   */
  preferredModelClasses?: string[];
  /**
   * architecture §33.2's table, verbatim: "Can we downgrade providers?
   * Expressed as a `recommendedModelClassDowngrade` plus
   * `preferFreeTierProviders`, both consumed as *soft* signals by Policy
   * Engine scoring (Section 13.3's `w_cost` term) — never a hard override."
   * A candidate whose `modelClass` matches this value scores a bonus
   * inside the existing `cost` term.
   */
  recommendedModelClassDowngrade?: string;
  /** Same architecture §33.2 sentence as {@link StrategySignals.recommendedModelClassDowngrade}: a `ModelDescriptor.cost.tier === "free"` candidate scores a bonus inside the existing `cost` term when this is `true`. */
  preferFreeTierProviders?: boolean;
}

/**
 * architecture §32.2's `CapabilitySet.reasoningDepth` -> this package's own
 * `reasoningAffinity` (a 0-1 soft signal, architecture §13.3's `w_quality`
 * term). Not architecture-specified (§32 defines `reasoningDepth`, §13.3
 * only illustrates `qualityScoreForTask` without defining this specific
 * mapping) — designed to line up with `model-scorer.ts`'s own pre-existing
 * `REASONING_DEPTH_SCORE` table (`shallow: 0.3, moderate: 0.6, deep: 0.9`),
 * so a task whose *resolved* (Capability-Registry-authoritative, not
 * ad-hoc-per-task-guessed) reasoning need is `"deep"` rewards a
 * `deep`-reasoning candidate exactly as strongly as `qualityScoreForTask`
 * already rewards one, and not more.
 */
export const REASONING_DEPTH_AFFINITY: Record<"shallow" | "moderate" | "deep", number> = {
  shallow: 0.3,
  moderate: 0.6,
  deep: 0.9,
};

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
