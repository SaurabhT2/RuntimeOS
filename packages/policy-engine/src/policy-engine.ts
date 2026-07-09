import { GatewayError, type ExecuteRequest } from "@ai-gateway/core-contracts";
import type { ModelRegistry } from "@ai-gateway/model-registry";
import { DEFAULT_RETRY_POLICY, type HealthMonitor } from "@ai-gateway/reliability";
import { queryCandidates } from "./candidate-query.js";
import { scoreCandidates } from "./model-scorer.js";
import { applyPrioritization, preferredProvidersRule, rankCandidates } from "./routing-rules.js";
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
    // Step 1: Task Classifier.
    const requirement = classifyTask(req);

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

    // Step 3: Scoring.
    const scored = scoreCandidates(
      models,
      requirement,
      (providerId) => this.healthMonitor.getHealth(providerId),
      this.weights,
    );

    // Step 4: Ranking.
    const weights = applyPrioritization(this.weights, req.preferences?.prioritize);
    const rescored = req.preferences?.prioritize
      ? scoreCandidates(
          models,
          requirement,
          (providerId) => this.healthMonitor.getHealth(providerId),
          weights,
        )
      : scored;
    const ranked = rankCandidates(rescored, ctx, this.rules);

    // Step 5: Plan Assembly.
    return this.assemblePlan(req, ranked);
  }

  private assemblePlan(req: ExecuteRequest, ranked: ScoredCandidate[]): ExecutionPlan {
    const streaming = req.constraints?.streaming ?? false;
    const temperature = resolveTemperature(req);
    const maxOutputTokens = this.defaultMaxOutputTokens;
    const timeoutMs = req.constraints?.maxLatencyMs ?? this.defaultTimeoutMs;

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
      retryPolicy: DEFAULT_RETRY_POLICY,
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
