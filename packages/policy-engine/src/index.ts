/**
 * @ai-gateway/policy-engine
 *
 * Task-to-model scoring, ranking, and ExecutionPlan assembly.
 *
 * STATUS: implemented (Engineering Milestone EM-3, Blueprint §7, §8.7).
 * Scoring uses static, config-independent weights (Blueprint §7: "no
 * cost/capability sophistication yet — static weights") — cost-aware and
 * capability-sophisticated routing is v1.1 Strategy Layer scope
 * (architecture §30, §33).
 *
 * Architecture reference: §13
 */

export type {
  ExecutionPlan,
  PolicyContext,
  RoutingOverrideLike,
  StrategyDecisionLike,
  CapabilitySetLike,
  ResolvedExecutionProfileLike,
  CostOptimizationResultLike,
  RoutingStrategy,
  ScoringWeights,
  CapabilityRequirement,
  StrategySignals,
  ScoredCandidate,
  RoutingRule,
  PolicyEngineConfig,
} from "./types.js";
export { ROUTING_STRATEGIES, DEFAULT_SCORING_WEIGHTS, REASONING_DEPTH_AFFINITY } from "./types.js";

export { classifyTask } from "./task-classifier.js";
export { buildModelQuery, queryCandidates } from "./candidate-query.js";
export {
  qualityScoreForTask,
  normalize,
  healthScore,
  rateLimitPenalty,
  scoreCandidate,
  scoreCandidates,
  type ScoreCandidateInput,
} from "./model-scorer.js";
export { applyPrioritization, preferredProvidersRule, rankCandidates } from "./routing-rules.js";
export {
  deriveCapabilityRequirement,
  deriveExecutionPlanOverrides,
  deriveOptimizedMessages,
  deriveStrategySignals,
  type ExecutionPlanOverrides,
} from "./strategy-signals.js";
export {
  type PolicyEngine,
  DefaultPolicyEngine,
  type DefaultPolicyEngineOptions,
} from "./policy-engine.js";
