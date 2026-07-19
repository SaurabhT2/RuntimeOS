import type { CapabilityRegistry } from "@ai-gateway/capability-registry";
import type { StrategyContext, StrategyPipelineStage } from "../types.js";

/**
 * architecture §30.2's `CAP` node: "Capability Registry: task -> required
 * capabilities." First stage of the pipeline — every later stage
 * (Execution Profile, Cost Optimization) reads `ctx.requiredCapabilities`.
 */
export class CapabilityResolutionStage implements StrategyPipelineStage {
  readonly name = "capability_resolution";

  constructor(private readonly registry: CapabilityRegistry) {}

  async run(ctx: StrategyContext): Promise<StrategyContext> {
    const requiredCapabilities = await this.registry.resolveCapabilities(
      ctx.request.task,
      ctx.request,
    );
    return { ...ctx, requiredCapabilities };
  }
}
