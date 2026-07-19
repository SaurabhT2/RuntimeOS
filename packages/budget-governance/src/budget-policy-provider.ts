import type { ConfigSource } from "@ai-gateway/config";
import { z } from "zod";
import type { BudgetPolicy, BudgetPolicyProvider, BudgetTenantRef } from "./types.js";

const budgetThresholdActionSchema = z.object({
  atPercentOfBudget: z.number(),
  action: z.enum(["alert", "downgrade_model", "switch_provider", "block"]),
});

const budgetPolicySchema = z.object({
  tenant: z.object({ organizationId: z.string(), workspaceId: z.string().optional() }),
  dailyBudgetUsd: z.number().optional(),
  monthlyBudgetUsd: z.number().optional(),
  perProviderSpendCapUsd: z.record(z.number()).optional(),
  thresholds: z.array(budgetThresholdActionSchema),
});

/** Validates a raw `ConfigSource.read()` result as a `BudgetPolicy[]`. Exported for this package's own tests and for a caller wanting the same validation without the caching/lookup behavior below. */
export const budgetPolicyListSchema = z.array(budgetPolicySchema);

function tenantKey(tenant: BudgetTenantRef): string {
  return `${tenant.organizationId}::${tenant.workspaceId ?? ""}`;
}

/**
 * `BudgetPolicy` lookup backed by an `@ai-gateway/config` `ConfigSource`
 * (architecture §43's own package depends on `config`, Blueprint §4.1) —
 * the same in-memory-cache-plus-`watch()`-invalidation pattern architecture
 * §45.3 already validates for the Model/Capability/Execution-Profile
 * registries ("proven infrastructure reused three times, not three new
 * mechanisms"), reused a fourth time here rather than inventing a
 * budget-specific caching mechanism.
 *
 * The `ConfigSource`'s raw value is expected to be a JSON array matching
 * `BudgetPolicy[]`'s shape (validated with `budgetPolicyListSchema`); a
 * tenant absent from that array has no configured policy —
 * `getPolicy` returns `undefined`, never a synthesized zero-budget default.
 */
export class ConfigBackedBudgetPolicyProvider implements BudgetPolicyProvider {
  private cache: Map<string, BudgetPolicy> | undefined;
  private unsubscribe: (() => void) | undefined;

  constructor(private readonly source: ConfigSource) {}

  private async ensureLoaded(): Promise<Map<string, BudgetPolicy>> {
    if (this.cache) {
      return this.cache;
    }
    const raw = await this.source.read();
    const parsed = budgetPolicyListSchema.parse(raw);
    const byTenant = new Map<string, BudgetPolicy>(parsed.map((p) => [tenantKey(p.tenant), p]));
    this.cache = byTenant;
    // Invalidate the cache (not re-read eagerly) on change — the next
    // `getPolicy` call re-reads, same lazy-refresh shape as
    // `execution-profile-registry`'s own cache invalidation.
    this.unsubscribe?.();
    this.unsubscribe = this.source.watch(() => {
      this.cache = undefined;
    });
    return byTenant;
  }

  async getPolicy(tenant: BudgetTenantRef): Promise<BudgetPolicy | undefined> {
    const byTenant = await this.ensureLoaded();
    return byTenant.get(tenantKey(tenant));
  }
}

/**
 * Trivial, `ConfigSource`-free `BudgetPolicyProvider` for tests and small
 * deployments that construct their policy list directly in code rather
 * than through a `ConfigSource` — the same "static in-memory map, real
 * interface" shape as this repository's other `Static*`/`Seeded*`
 * reference implementations.
 */
export class StaticBudgetPolicyProvider implements BudgetPolicyProvider {
  private readonly byTenant: Map<string, BudgetPolicy>;

  constructor(policies: BudgetPolicy[]) {
    this.byTenant = new Map(policies.map((p) => [tenantKey(p.tenant), p]));
  }

  async getPolicy(tenant: BudgetTenantRef): Promise<BudgetPolicy | undefined> {
    return this.byTenant.get(tenantKey(tenant));
  }
}
