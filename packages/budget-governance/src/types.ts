import type { ExecuteRequest } from "@ai-gateway/core-contracts";

/** Same tenant shape as `ExecuteRequest.tenant` (architecture §10.3) — not imported directly (this package has no reason to depend on the full request shape for this one field), duplicated locally the same way `policy-engine`'s `StrategyDecisionLike` duplicates fields it doesn't own. */
export type BudgetTenantRef = ExecuteRequest["tenant"];

/**
 * architecture §43.2, verbatim. A tenant's (organization or, when
 * `workspaceId` is set, a specific workspace's) spend limits and the
 * ordered actions to take as spend approaches them.
 */
export interface BudgetPolicy {
  tenant: BudgetTenantRef;
  dailyBudgetUsd?: number;
  monthlyBudgetUsd?: number;
  perProviderSpendCapUsd?: Partial<Record<string, number>>;
  /** Ordered, evaluated low-to-high. */
  thresholds: BudgetThresholdAction[];
}

/** architecture §43.2, verbatim. */
export interface BudgetThresholdAction {
  /** e.g. 80, 100. */
  atPercentOfBudget: number;
  action: "alert" | "downgrade_model" | "switch_provider" | "block";
}

/**
 * architecture §43.2, verbatim, plus a `window` parameter `getSpend` needs
 * to actually be callable (the architecture snippet elides parameter names
 * on the return type but "day" | "month" windows are §43.2's own prose:
 * "tracks spend over time against tenant-configured limits").
 */
export interface BudgetLedger {
  recordSpend(tenant: BudgetTenantRef, providerId: string, costUsd: number): Promise<void>;
  getSpend(tenant: BudgetTenantRef, window: "day" | "month", providerId?: string): Promise<number>;
}

/** architecture §43.2, verbatim. */
export interface BudgetEnforcer {
  evaluate(
    tenant: BudgetTenantRef,
    plannedCostUsd: number,
    providerId: string,
  ): Promise<BudgetDecision>;
}

/** architecture §43.2, verbatim. */
export interface BudgetDecision {
  allowed: boolean;
  /** Reuses `CostOptimizationResult.recommendedModelClassDowngrade`'s exact shape (architecture §33.2) — see this package's README, "Applying a BudgetDecision," for how `strategy-layer` folds this into `optimizations.cost`. */
  forcedModelClassDowngrade?: string;
  /**
   * Computed and returned for every caller (tests, telemetry, and shadow-mode
   * observability all need the real, complete decision), but **not fully
   * appliable** to a live request as of EM-10 — `StrategyDecision`
   * (architecture §30.3, frozen) has no field a hard provider exclusion can
   * travel through to `policy-engine` without a new field on a frozen
   * interface. See ADR-00XX (this milestone) and this package's README,
   * "Known gap: forcedProviderExclusion is computed but not enforced."
   */
  forcedProviderExclusion?: string[];
  alertsTriggered: BudgetThresholdAction[];
  reason?: "BUDGET_EXCEEDED" | "APPROACHING_LIMIT";
}

/**
 * Not in architecture §43.2's snippet (which shows only the interfaces a
 * caller consumes) — this is this package's own registry-style seam for
 * *where a `BudgetPolicy` comes from*, matching every other Strategy-Layer-adjacent
 * registry's "designed, not specified" extension pattern
 * (`ExecutionProfileRegistry`, `RuntimeProfileRegistry`, `CapabilityRegistry`
 * are all interfaces with a swappable, seed-data-backed default
 * implementation; this is the same shape of decision for the same reason).
 */
export interface BudgetPolicyProvider {
  /** `undefined` when the tenant has no configured policy — every caller must treat that as "no budget governance applies," never as an implicit zero-budget block. */
  getPolicy(tenant: BudgetTenantRef): Promise<BudgetPolicy | undefined>;
}

/**
 * Blueprint §7 EM-10's explicit risk mitigation: "shipping with a 'shadow
 * mode' (log what would have been blocked, block nothing) for the first
 * release, promoted to enforcing mode only after a burn-in period." Not
 * architecture-specified (architecture §43 doesn't mention shadow mode at
 * all — it's an engineering-process safeguard, Blueprint-level, same
 * category of decision as EM-8's `enableStrategyLayer` feature flag), but
 * required by the Blueprint's own EM-10 entry, verified rather than
 * assumed by this package's tests.
 */
export type BudgetEnforcementMode = "shadow" | "enforcing";
