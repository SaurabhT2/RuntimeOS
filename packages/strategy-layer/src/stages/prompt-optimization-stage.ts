import type { PromptOptimizer } from "@ai-gateway/prompt-optimizer";
import { resolveMessages } from "../messages.js";
import type { StrategyContext, StrategyPipelineStage } from "../types.js";

/**
 * architecture §30.2's `OPT` node (Optimization Pipeline), Prompt
 * Optimization half. Requires `ctx.executionProfile` (from
 * `ExecutionProfileResolutionStage`) to already be resolved.
 *
 * **Ordering note — this runs before `CostOptimizationStage`, not after,
 * despite the EM-8 work order's own listed pipeline order ("Optimize Cost
 * ↓ Optimize Prompt").** Architecture §33.2's own table is explicit:
 * *"Can prompt length be reduced? Delegated to the Prompt Optimization
 * Layer (Section 34); the Cost Optimizer reads back `estimatedTokens`
 * post-optimization to refine `estimatedCostUsd`."* Architecture §33.3's
 * diagram is the same: `PROMPT --> COST`. Per this whole project's
 * established governance (the architecture spec is authoritative over any
 * other document, including a work order), this pipeline runs Prompt
 * Optimization first and threads its `estimatedTokens` into the Cost
 * Optimizer's `promptTokenEstimate` input — the work order's listed order
 * would have Cost Optimization run with no token estimate to read yet.
 */
/**
 * architecture §34.2's `TokenBudget` isn't specified in terms of *where*
 * `maxInputTokens` comes from — no concrete model (with its own real
 * context window) has been selected yet at this pre-Policy-Engine pipeline
 * stage (model selection is the Policy Engine's Candidate Query, §13.2).
 * Designed, not specified: `ctx.requiredCapabilities.minContextTokens`
 * (architecture §32.2 — "this task needs at least this many context
 * tokens to do its job") is the one already-resolved, task-derived number
 * available at this point, so it is used as the working ceiling for this
 * pipeline's own trimming decisions — a deliberately conservative proxy,
 * not a claim about any specific model's actual context window. A generous
 * floor (`MINIMUM_INPUT_TOKEN_BUDGET`) guards against a task with a very
 * small declared minimum still needing reasonable room to breathe before
 * trimming kicks in.
 */
const MINIMUM_INPUT_TOKEN_BUDGET = 4_000;

export class PromptOptimizationStage implements StrategyPipelineStage {
  readonly name = "prompt_optimization";

  constructor(private readonly optimizer: PromptOptimizer) {}

  async run(ctx: StrategyContext): Promise<StrategyContext> {
    if (!ctx.executionProfile) {
      throw new Error(
        "PromptOptimizationStage requires ctx.executionProfile to already be resolved.",
      );
    }
    if (!ctx.requiredCapabilities) {
      throw new Error(
        "PromptOptimizationStage requires ctx.requiredCapabilities to already be resolved.",
      );
    }
    const messages = resolveMessages(ctx.request);
    const budget = {
      maxInputTokens: Math.max(
        ctx.requiredCapabilities.minContextTokens,
        MINIMUM_INPUT_TOKEN_BUDGET,
      ),
      reservedForOutput: ctx.executionProfile.inference.maxOutputTokens,
    };
    const optimizedPrompt = await this.optimizer.optimize(messages, budget, ctx.executionProfile);
    return { ...ctx, optimizedPrompt };
  }
}
