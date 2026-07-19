import type { CacheClient, CostOptimizer } from "@ai-gateway/cost-optimizer";
import type { StrategyContext, StrategyPipelineStage } from "../types.js";

/**
 * architecture §30.2's `OPT` node (Optimization Pipeline), Cost
 * Optimization half. Requires `ctx.requiredCapabilities`, `ctx.executionProfile`,
 * `ctx.runtimeProfile`, and `ctx.optimizedPrompt` to already be resolved —
 * `ctx.optimizedPrompt.estimatedTokens` becomes this stage's
 * `promptTokenEstimate` input (architecture §33.2's table: "the Cost
 * Optimizer reads back `estimatedTokens` post-optimization").
 */
export class CostOptimizationStage implements StrategyPipelineStage {
  readonly name = "cost_optimization";

  constructor(
    private readonly optimizer: CostOptimizer,
    private readonly cache: CacheClient,
  ) {}

  async run(ctx: StrategyContext): Promise<StrategyContext> {
    if (!ctx.requiredCapabilities || !ctx.executionProfile || !ctx.runtimeProfile) {
      throw new Error(
        "CostOptimizationStage requires ctx.requiredCapabilities, ctx.executionProfile, and ctx.runtimeProfile to already be resolved.",
      );
    }
    if (!ctx.optimizedPrompt) {
      throw new Error("CostOptimizationStage requires ctx.optimizedPrompt to already be resolved.");
    }
    const costOptimization = await this.optimizer.optimize({
      task: ctx.request.task,
      capabilities: ctx.requiredCapabilities,
      profile: ctx.executionProfile,
      promptTokenEstimate: ctx.optimizedPrompt.estimatedTokens,
      runtimeProfile: ctx.runtimeProfile,
      cache: this.cache,
    });
    return { ...ctx, costOptimization };
  }
}
