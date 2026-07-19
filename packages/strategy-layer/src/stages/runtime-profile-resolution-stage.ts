import type { RuntimeProfileRegistry, TenantRef } from "@ai-gateway/runtime-profiles";
import type { StrategyContext, StrategyPipelineStage } from "../types.js";

/**
 * Not a named node in architecture §30.2's diagram (that diagram predates
 * Runtime Profiles, architecture §37, being folded into the Strategy
 * Layer's pipeline) — but the EM-8 work order explicitly lists "Resolve
 * Runtime Profile" as a required pipeline stage, and `cost-optimizer`'s
 * frozen `OptimizationContext.runtimeProfile` (architecture §33.2) requires
 * one. `TenantRef` (from `runtime-profiles`) is structurally satisfied by
 * `TenantContext` (`{organizationId, workspaceId?}` is a subset of
 * `ExecuteRequest["tenant"]`'s fields), so no adapter is needed.
 */
export class RuntimeProfileResolutionStage implements StrategyPipelineStage {
  readonly name = "runtime_profile_resolution";

  constructor(private readonly registry: RuntimeProfileRegistry) {}

  async run(ctx: StrategyContext): Promise<StrategyContext> {
    const tenantRef: TenantRef = {
      organizationId: ctx.tenant.organizationId,
      workspaceId: ctx.tenant.workspaceId,
    };
    const runtimeProfile = await this.registry.getActiveRuntimeProfile(tenantRef);
    return { ...ctx, runtimeProfile };
  }
}
