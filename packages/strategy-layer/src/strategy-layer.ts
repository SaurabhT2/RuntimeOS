import type { CapabilityRegistry } from "@ai-gateway/capability-registry";
import type { BudgetEnforcer } from "@ai-gateway/budget-governance";
import type { CacheClient, CostOptimizer } from "@ai-gateway/cost-optimizer";
import type { ExecuteRequest } from "@ai-gateway/core-contracts";
import type { ExecutionProfileRegistry } from "@ai-gateway/execution-profile-registry";
import type { LearningRegistry } from "@ai-gateway/learning";
import type { PromptOptimizer } from "@ai-gateway/prompt-optimizer";
import type { RuntimeProfileRegistry } from "@ai-gateway/runtime-profiles";
import { DefaultStrategyPipeline, type StrategyPipeline } from "./strategy-pipeline.js";
import {
  BudgetEnforcementStage,
  CapabilityResolutionStage,
  CostOptimizationStage,
  ExecutionProfileResolutionStage,
  LearningHookStage,
  PromptOptimizationStage,
  RuntimeProfileResolutionStage,
} from "./stages/index.js";
import type {
  AIStrategyLayer,
  StrategyDecision,
  StrategyPipelineStage,
  TenantContext,
} from "./types.js";

export interface StrategyLayerOptions {
  capabilityRegistry: CapabilityRegistry;
  executionProfileRegistry: ExecutionProfileRegistry;
  runtimeProfileRegistry: RuntimeProfileRegistry;
  costOptimizer: CostOptimizer;
  promptOptimizer: PromptOptimizer;
  learningRegistry: LearningRegistry;
  cache: CacheClient;
  /**
   * EM-10 (architecture §43.3), optional — omitted entirely (the default)
   * means no `BudgetEnforcementStage` is added to the pipeline at all, not
   * even a no-op one; a `strategy-layer` instance with no Budget
   * Governance configured behaves exactly as it did before this milestone
   * (architecture §45.5's "every addition is optional and orthogonal to
   * the simple path").
   */
  budgetEnforcer?: BudgetEnforcer;
}

/**
 * architecture §30.2's diagram order (Capability → Execution Profile →
 * Optimization Pipeline), refined by `PromptOptimizationStage`/
 * `CostOptimizationStage`'s own doc comments into the six concrete stages
 * this milestone implements. Exported so a caller can compose a
 * `DefaultStrategyPipeline` from a *different* stage list (EM-8: "every
 * stage must remain independently replaceable") without reimplementing
 * this default ordering from scratch.
 *
 * **EM-9 reordering:** `RuntimeProfileResolutionStage` now runs *before*
 * `ExecutionProfileResolutionStage` (§30.2's own diagram is silent on
 * their relative order — Runtime Profiles aren't a named node in it at
 * all, per `RuntimeProfileResolutionStage`'s own doc comment). This is
 * the minimum reordering that lets `ExecutionProfileResolutionStage`
 * read `ctx.runtimeProfile` and apply architecture §37.4's first read
 * site ("the Execution Profile Registry, to adjust `streaming`,
 * `caching`, and `timeoutMs` defaults") — EM-8 deliberately left that
 * unimplemented specifically because, at EM-8's stage order, the runtime
 * profile did not exist yet at this point in the pipeline (see that
 * stage's EM-8 doc comment). `CapabilityResolutionStage` depends on
 * neither and stays first; `PromptOptimizationStage`/`CostOptimizationStage`
 * already ran after both in every prior ordering, so they are unaffected.
 *
 * **EM-10 addition:** `BudgetEnforcementStage` is appended after
 * `CostOptimizationStage` and before `LearningHookStage` — but only when
 * `options.budgetEnforcer` is supplied (see that field's own doc comment).
 * A stage list built with no `budgetEnforcer` is byte-for-byte the same
 * six stages EM-9 produced.
 */
export function buildDefaultStages(options: StrategyLayerOptions): StrategyPipelineStage[] {
  const stages: StrategyPipelineStage[] = [
    new CapabilityResolutionStage(options.capabilityRegistry),
    new RuntimeProfileResolutionStage(options.runtimeProfileRegistry),
    new ExecutionProfileResolutionStage(options.executionProfileRegistry),
    new PromptOptimizationStage(options.promptOptimizer),
    new CostOptimizationStage(options.costOptimizer, options.cache),
  ];
  if (options.budgetEnforcer) {
    stages.push(new BudgetEnforcementStage(options.budgetEnforcer));
  }
  stages.push(new LearningHookStage(options.learningRegistry));
  return stages;
}

/**
 * architecture §30.3's `AIStrategyLayer`. Provider-agnostic and
 * domain-agnostic (EM-8 constraints 2–3): every dependency this class
 * takes is itself provider-agnostic/domain-agnostic (see ADR-0016's
 * corrected dependency list), and `buildStrategy` never branches on a
 * `providerId`/`modelId` or any business-domain concept — only on `task`
 * and the capability/profile shapes resolved from it.
 */
export class DefaultAIStrategyLayer implements AIStrategyLayer {
  private readonly pipeline: StrategyPipeline;

  constructor(options: StrategyLayerOptions | { pipeline: StrategyPipeline }) {
    this.pipeline =
      "pipeline" in options
        ? options.pipeline
        : new DefaultStrategyPipeline(buildDefaultStages(options));
  }

  async buildStrategy(req: ExecuteRequest, ctx: TenantContext): Promise<StrategyDecision> {
    return this.pipeline.run(req, ctx);
  }
}
