/**
 * @ai-gateway/budget-governance
 *
 * Enterprise Budget & Cost Governance (architecture §43): authoritative,
 * cumulative spend enforcement across organization/tenant/pipeline/request
 * scopes — distinct from `cost-optimizer`'s (architecture §33) advisory,
 * single-request savings recommendations.
 *
 * STATUS: implemented (Engineering Milestone EM-10). Ships in **shadow
 * mode** by default (Blueprint §7 EM-10's explicit risk mitigation) —
 * `DefaultBudgetEnforcer` computes real decisions but does not enforce
 * them until a deployment explicitly passes `mode: "enforcing"`.
 *
 * Architecture reference: §43. See this package's README for the full
 * design, including the one documented gap (`forcedProviderExclusion` is
 * computed but not yet appliable to a live request — architecture §30.3's
 * frozen `StrategyDecision` has no carrier for it).
 */

export type {
  BudgetTenantRef,
  BudgetPolicy,
  BudgetThresholdAction,
  BudgetLedger,
  BudgetEnforcer,
  BudgetDecision,
  BudgetPolicyProvider,
  BudgetEnforcementMode,
} from "./types.js";

export { InMemoryBudgetLedger } from "./budget-ledger.js";
export {
  ConfigBackedBudgetPolicyProvider,
  StaticBudgetPolicyProvider,
  budgetPolicyListSchema,
} from "./budget-policy-provider.js";
export {
  DefaultBudgetEnforcer,
  NO_PROVIDER_SELECTED_YET,
  type DefaultBudgetEnforcerOptions,
} from "./budget-enforcer.js";
export {
  budgetProviderExclusionRule,
  type PolicyContextWithBudgetDecision,
} from "./budget-routing-rule.js";
