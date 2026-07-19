/**
 * @ai-gateway/strategy-layer
 *
 * The AI Strategy Layer (architecture §30): resolves capabilities,
 * execution profile, and runtime profile, runs the Prompt/Cost
 * Optimization Pipeline, wires the Learning extension points, and produces
 * an immutable `StrategyDecision` for the Policy Engine — the "how should
 * this task be executed" question, kept separate from `policy-engine`'s
 * "where should this execution happen" question (architecture §30.1,
 * ADR-008).
 *
 * STATUS: implemented and integrated (Engineering Milestone EM-8).
 * `orchestrator` calls this package first, behind the `enableStrategyLayer`
 * feature flag (ADR-0017); when disabled, `orchestrator` calls
 * `policy-engine` exactly as it did in EM-7.
 *
 * Architecture reference: §30 (see also §13.5, §31, §32, §33, §34, §36)
 */

export type {
  StrategyDecision,
  AIStrategyLayer,
  StrategyContext,
  StrategyPipelineStage,
  TenantContext,
} from "./types.js";

export {
  type StrategyPipeline,
  DefaultStrategyPipeline,
  IncompleteStrategyDecisionError,
} from "./strategy-pipeline.js";

export {
  type StrategyLayerOptions,
  DefaultAIStrategyLayer,
  buildDefaultStages,
} from "./strategy-layer.js";

export {
  CapabilityResolutionStage,
  ExecutionProfileResolutionStage,
  RuntimeProfileResolutionStage,
  PromptOptimizationStage,
  CostOptimizationStage,
  BudgetEnforcementStage,
  LearningHookStage,
} from "./stages/index.js";

export { resolveMessages } from "./messages.js";
