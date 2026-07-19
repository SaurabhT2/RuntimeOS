import type { BudgetLedger, BudgetTenantRef } from "./types.js";

function tenantKey(tenant: BudgetTenantRef): string {
  return `${tenant.organizationId}::${tenant.workspaceId ?? ""}`;
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7); // YYYY-MM
}

interface SpendRecord {
  costUsd: number;
  providerId: string;
  recordedAt: Date;
}

/**
 * Reference `BudgetLedger` implementation — in-memory, process-local.
 *
 * architecture §45.2 / ADR-013 (architecture §46): `BudgetLedger` writes are
 * "financially-adjacent and durability-sensitive... a lost budget-ledger
 * write could let a tenant exceed a hard cap unnoticed," and the
 * architecture's own recommendation is a durable store (Postgres in the
 * reference deployment) with Redis only as a read-through cache — **not**
 * this in-memory implementation. This class exists for the same reason
 * `InMemoryCircuitBreaker`/`InMemoryCacheClient`/`DefaultModelRegistry`'s
 * seed-backed store exist: a real, fully-functional, test/demo-appropriate
 * implementation of a durability-sensitive interface, explicitly not
 * intended as the production-durable one. A production deployment must
 * supply its own `BudgetLedger` backed by the durable Config/Credential DB,
 * per ADR-013 — this package does not (and, without a real database
 * available in this repository, cannot) ship one; see this package's
 * README, "Known gap: no durable BudgetLedger implementation."
 */
export class InMemoryBudgetLedger implements BudgetLedger {
  private readonly records = new Map<string, SpendRecord[]>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async recordSpend(tenant: BudgetTenantRef, providerId: string, costUsd: number): Promise<void> {
    const key = tenantKey(tenant);
    const existing = this.records.get(key) ?? [];
    existing.push({ costUsd, providerId, recordedAt: this.now() });
    this.records.set(key, existing);
  }

  async getSpend(
    tenant: BudgetTenantRef,
    window: "day" | "month",
    providerId?: string,
  ): Promise<number> {
    const key = tenantKey(tenant);
    const existing = this.records.get(key) ?? [];
    const nowValue = this.now();
    const currentWindowKey = window === "day" ? dayKey(nowValue) : monthKey(nowValue);
    return existing
      .filter((r) => {
        const recordWindowKey = window === "day" ? dayKey(r.recordedAt) : monthKey(r.recordedAt);
        if (recordWindowKey !== currentWindowKey) {
          return false;
        }
        return providerId === undefined || r.providerId === providerId;
      })
      .reduce((sum, r) => sum + r.costUsd, 0);
  }
}
