import { GatewayError } from "@ai-gateway/core-contracts";
import { NO_PROVIDER_SELECTED_YET, type BudgetEnforcer } from "@ai-gateway/budget-governance";
import type { StrategyContext, StrategyPipelineStage } from "../types.js";

/**
 * architecture §43.3: "The Budget Enforcer runs as the last step of the
 * Optimization Pipeline (Section 33.3), immediately before the
 * StrategyDecision is handed to the Policy Engine (Section 13.5) — so it
 * sees the already cost-optimized planned spend, not the naive
 * pre-optimization estimate." Runs after `CostOptimizationStage` (so
 * `ctx.costOptimization.estimatedCostUsd` reflects the Cost Optimizer's
 * already-applied savings) and before `LearningHookStage` (§43 is about
 * *this* Optimization Pipeline; Learning Hooks are a separate,
 * side-channel concern per §30.2's own diagram — their relative order
 * doesn't affect either one's outcome).
 *
 * **Optional, by construction (EM-10, matching the "every addition is
 * optional and orthogonal to the simple path" principle, architecture
 * §45.5).** `buildDefaultStages` only includes this stage at all when
 * `options.budgetEnforcer` is supplied — a `strategy-layer` instance that
 * doesn't configure Budget Governance runs exactly as it did before this
 * milestone, not even a no-op stage added to the list.
 *
 * **Blocking:** a `{allowed: false}` `BudgetDecision` throws a
 * `GatewayError("BUDGET_EXCEEDED", ...)` — the *same* "an uncaught
 * exception from a Strategy Pipeline stage propagates through
 * `strategyLayer.buildStrategy()`, `orchestrator`'s uncaught
 * `buildStrategyDecision()`, and out to the caller as a typed error"
 * mechanism the EM-8 Review Closure (Finding 5) already confirmed is
 * architecture-compliant (§3's P6) — no new error-propagation mechanism
 * needed, and `orchestrator` itself needs no code change for this
 * milestone. Policy Engine, Credential Resolver, and every Provider
 * Adapter are never reached once this throws.
 *
 * **Forced downgrade:** folded into the *already-existing*
 * `ctx.costOptimization.recommendedModelClassDowngrade` field — the same
 * "a later stage overrides an earlier one's field, `StrategyDecision`'s
 * own shape is unchanged" mechanism EM-9 used for Runtime Profile
 * adjustments (`ExecutionProfileResolutionStage`). Budget Governance is
 * authoritative (architecture §43.1) over Cost Optimizer's advisory
 * recommendation, so a forced downgrade always overrides whatever Cost
 * Optimizer itself recommended, never merges with it.
 *
 * **Forced provider exclusion:** computed by `BudgetEnforcer` (visible on
 * the `BudgetDecision` this stage receives) but **not applied** — there is
 * no field on the frozen `StrategyDecision` (architecture §30.3) this data
 * can travel through to reach `orchestrator`/`policy-engine`. See this
 * package's README, "EM-10: Budget Enforcement," and this milestone's
 * Draft ADR for the full reasoning and the options left for the
 * Architecture Board. Recorded via telemetry inside `budget-governance`
 * itself (`DefaultBudgetEnforcer`), not silently dropped.
 */
export class BudgetEnforcementStage implements StrategyPipelineStage {
  readonly name = "budget_enforcement";

  constructor(private readonly budgetEnforcer: BudgetEnforcer) {}

  async run(ctx: StrategyContext): Promise<StrategyContext> {
    const plannedCostUsd = ctx.costOptimization?.estimatedCostUsd ?? 0;
    // architecture §43.2's `evaluate(tenant, plannedCostUsd, providerId)`
    // assumes a provider is already known; at this pipeline position (per
    // §43.3, *before* Policy Engine's candidate selection) none is. See
    // `budget-governance`'s own `NO_PROVIDER_SELECTED_YET` doc comment and
    // this milestone's Draft ADR for the full reasoning.
    const decision = await this.budgetEnforcer.evaluate(
      ctx.tenant,
      plannedCostUsd,
      NO_PROVIDER_SELECTED_YET,
    );

    if (!decision.allowed) {
      throw new GatewayError(
        "BUDGET_EXCEEDED",
        decision.reason === "BUDGET_EXCEEDED"
          ? "This request would exceed the tenant's configured budget."
          : "This request was denied by Budget Governance.",
        false,
        { alertsTriggered: decision.alertsTriggered },
      );
    }

    if (!decision.forcedModelClassDowngrade || !ctx.costOptimization) {
      return ctx;
    }

    return {
      ...ctx,
      costOptimization: {
        ...ctx.costOptimization,
        recommendedModelClassDowngrade: decision.forcedModelClassDowngrade,
      },
    };
  }
}
