import { GatewayError, type ExecuteRequest } from "@ai-gateway/core-contracts";
import type { ModelRegistry } from "@ai-gateway/model-registry";
import { DEFAULT_RETRY_POLICY, type HealthMonitor } from "@ai-gateway/reliability";
import { queryCandidates } from "./candidate-query.js";
import { scoreCandidates } from "./model-scorer.js";
import { applyPrioritization, preferredProvidersRule, rankCandidates } from "./routing-rules.js";
import {
  deriveCapabilityRequirement,
  deriveExecutionPlanOverrides,
  deriveStrategySignals,
} from "./strategy-signals.js";
import { classifyTask } from "./task-classifier.js";
import {
  DEFAULT_SCORING_WEIGHTS,
  type ExecutionPlan,
  type PolicyContext,
  type PolicyEngineConfig,
  type RoutingRule,
  type ScoredCandidate,
  type ScoringWeights,
} from "./types.js";

/** architecture §11, verbatim. */
export interface PolicyEngine {
  selectExecutionPlan(req: ExecuteRequest, ctx: PolicyContext): Promise<ExecutionPlan>;
}

const CREATIVITY_TEMPERATURE: Record<"low" | "medium" | "high", number> = {
  low: 0.2,
  medium: 0.5,
  high: 0.9,
};

function resolveTemperature(req: ExecuteRequest): number {
  return CREATIVITY_TEMPERATURE[req.preferences?.creativity ?? "medium"];
}

export interface DefaultPolicyEngineOptions {
  modelRegistry: ModelRegistry;
  healthMonitor: HealthMonitor;
  config?: PolicyEngineConfig;
}

/**
 * Default `PolicyEngine` (architecture §13, §11): runs the full decision
 * pipeline (§13.2) — Task Classifier -> Candidate Query -> Scoring ->
 * Ranking -> Plan Assembly — producing one primary `ExecutionPlan` with a
 * pre-computed `fallbackPlans` chain (ADR-005: pre-computed, not
 * re-scored on failure).
 *
 * A pure, independently-testable routing function (architecture §24):
 * takes an `ExecuteRequest` + `PolicyContext`, reads only from the
 * injected `ModelRegistry`/`HealthMonitor`, and never performs I/O of its
 * own beyond those two calls.
 *
 * **EM-9 (Independent Architecture & Engineering Review of EM-9):**
 * `selectExecutionPlan`'s signature, and every one of §13.1–§13.4's five
 * pipeline *stages*, are exactly what EM-3 built — see `ctx.strategyDecision`'s
 * own doc comment (`types.ts`) for the precise, field-by-field account of
 * what changed (several stages' *inputs*, not the stages themselves) and
 * why. `deriveCapabilityRequirement`/`deriveStrategySignals`/
 * `deriveExecutionPlanOverrides` (`strategy-signals.ts`) are this
 * activation's entire surface area within this file.
 */
export class DefaultPolicyEngine implements PolicyEngine {
  private readonly modelRegistry: ModelRegistry;
  private readonly healthMonitor: HealthMonitor;
  private readonly weights: ScoringWeights;
  private readonly rules: RoutingRule[];
  private readonly maxFallbacks: number;
  private readonly defaultMaxOutputTokens: number;
  private readonly defaultTimeoutMs: number;

  constructor(options: DefaultPolicyEngineOptions) {
    this.modelRegistry = options.modelRegistry;
    this.healthMonitor = options.healthMonitor;
    this.weights = { ...DEFAULT_SCORING_WEIGHTS, ...options.config?.weights };
    // `preferredProvidersRule` is registered by default: it is a no-op
    // (`applies()` returns false) whenever `ctx.routingOverride` carries no
    // `preferredProviders`, so shipping it unconditionally has no effect on
    // deployments that never set that field.
    this.rules = options.config?.rules ?? [preferredProvidersRule];
    this.maxFallbacks = options.config?.maxFallbacks ?? 2;
    this.defaultMaxOutputTokens = options.config?.defaultMaxOutputTokens ?? 1024;
    this.defaultTimeoutMs = options.config?.defaultTimeoutMs ?? 15_000;
  }

  async selectExecutionPlan(req: ExecuteRequest, ctx: PolicyContext = {}): Promise<ExecutionPlan> {
    // Step 1: Task Classifier. EM-9: `ctx.strategyDecision.requiredCapabilities`,
    // when present and well-formed, supersedes this ad-hoc classification's
    // capability-shaped fields (architecture §32.2) — `creativityAffinity`
    // always comes from here regardless, since the Strategy Layer doesn't
    // resolve a creativity concept. See `deriveCapabilityRequirement`'s own
    // doc comment for the full accounting, including why this can never
    // weaken a hard filter.
    const classified = classifyTask(req);
    const requirement = deriveCapabilityRequirement(
      classified,
      ctx.strategyDecision?.requiredCapabilities,
    );

    // Step 2: Candidate Query.
    const models = await queryCandidates(this.modelRegistry, requirement);

    if (models.length === 0) {
      throw new GatewayError(
        "ALL_PROVIDERS_UNAVAILABLE",
        `No model in the registry satisfies the capability requirements for task "${req.task}".`,
        false,
        { task: req.task, requirement },
      );
    }

    // Step 3: Scoring. EM-9: `strategySignals` (from
    // `executionProfile.preferredModelClasses`/`optimizations.cost`, when
    // present and well-formed) nudge the existing `quality`/`cost` terms —
    // see `model-scorer.ts`'s `qualityScoreForTask`/`costSignalBonus`.
    // `{}` (every field absent) when `ctx.strategyDecision` is absent or
    // malformed, which is a no-op at every consumer.
    const strategySignals = deriveStrategySignals(
      ctx.strategyDecision?.executionProfile,
      ctx.strategyDecision?.optimizations?.cost,
    );
    const scored = scoreCandidates(
      models,
      requirement,
      (providerId) => this.healthMonitor.getHealth(providerId),
      this.weights,
      strategySignals,
    );

    // Step 4: Ranking.
    const weights = applyPrioritization(this.weights, req.preferences?.prioritize);
    const rescored = req.preferences?.prioritize
      ? scoreCandidates(
          models,
          requirement,
          (providerId) => this.healthMonitor.getHealth(providerId),
          weights,
          strategySignals,
        )
      : scored;
    const ranked = rankCandidates(rescored, ctx, this.rules);

    // Step 5: Plan Assembly. EM-9: `executionProfile`'s own resolved
    // inference/timeout/retry/streaming defaults, when present and
    // well-formed, supersede the EM-3 `req`-derived/hardcoded ones —
    // architecture §31.1. `optimizations.cost.disableStreaming`, when
    // `true`, forces `streaming: false` regardless (architecture §33.2:
    // an explicit optimizer decision, not a soft nudge, for this one
    // field only).
    const overrides = deriveExecutionPlanOverrides(
      ctx.strategyDecision?.executionProfile,
      ctx.strategyDecision?.optimizations?.cost,
    );
    return this.assemblePlan(req, ranked, overrides);
  }

  private assemblePlan(
    req: ExecuteRequest,
    ranked: ScoredCandidate[],
    overrides: ReturnType<typeof deriveExecutionPlanOverrides> = {},
  ): ExecutionPlan {
    const temperature = overrides.temperature ?? resolveTemperature(req);
    const maxOutputTokens = overrides.maxOutputTokens ?? this.defaultMaxOutputTokens;
    // A caller-supplied hard latency ceiling (`req.constraints.maxLatencyMs`)
    // always wins over the profile's own default timeout — the same
    // precedence every hard, caller-supplied constraint gets elsewhere in
    // this pipeline (architecture §33.3's "never overrides a hard
    // requirement" principle, applied here to the one field a caller can
    // hard-constrain directly).
    const timeoutMs =
      req.constraints?.maxLatencyMs ?? overrides.timeoutMs ?? this.defaultTimeoutMs;
    const retryPolicy = overrides.retryPolicy ?? DEFAULT_RETRY_POLICY;
    // Same precedence for streaming: an explicit caller ask always wins;
    // otherwise the resolved profile's own default; otherwise EM-3's
    // `false`. `disableStreaming` (Cost Optimizer) is the one signal that
    // forces `false` regardless of either of those — see this method's
    // caller for why that is a deliberate, documented exception to the
    // "soft signal only" rule the rest of this activation follows.
    const streaming = overrides.disableStreaming
      ? false
      : (req.constraints?.streaming ?? overrides.streamingDefault ?? false);

    const buildOne = (
      candidate: ScoredCandidate,
      fallbackPlans: ExecutionPlan[],
    ): ExecutionPlan => ({
      providerId: candidate.providerId,
      modelId: candidate.modelId,
      modelClass: candidate.modelClass,
      temperature,
      maxOutputTokens,
      timeoutMs,
      retryPolicy,
      streaming,
      fallbackPlans,
    });

    const fallbackCandidates = ranked.slice(1, 1 + this.maxFallbacks);
    // Fallback plans are themselves leaf plans (empty `fallbackPlans`) —
    // architecture §13.2 step 5 describes a single-level "ordered fallback
    // chain used by the Retry Engine on failover", not a recursively
    // nested tree of fallbacks-of-fallbacks.
    const fallbackPlans = fallbackCandidates.map((candidate) => buildOne(candidate, []));

    const primary = ranked[0];
    if (!primary) {
      // Unreachable given the `models.length === 0` guard above, but kept
      // as an explicit, typed failure rather than a non-null assertion.
      throw new GatewayError("ALL_PROVIDERS_UNAVAILABLE", "No ranked candidate available.", false);
    }

    return buildOne(primary, fallbackPlans);
  }
}
