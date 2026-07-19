/**
 * A minimal tenant identifier, local to this package. `core-contracts`'
 * `ExecuteRequest.tenant` shape would be the natural type to reuse, but
 * this package's frozen dependency edge (Blueprint §4.1) is `config`
 * only — `core-contracts` is not on that list, so a small local duplicate
 * is used instead, matching the "duplicate rather than introduce a
 * disallowed edge" precedent already established in this codebase (see
 * `@ai-gateway/reliability`'s `ProviderHealthSnapshot`, and this milestone's
 * own `execution-profile-registry/src/cache.ts` and `retry-policy.ts`).
 * Whoever calls this package with a real `ExecuteRequest.tenant` value
 * (future `strategy-layer` wiring, EM-8) can pass it directly — the shapes
 * are structurally compatible.
 */
export interface TenantRef {
  organizationId: string;
  workspaceId?: string;
}

/** Composite key used for per-tenant override storage — workspace-scoped when present, org-wide otherwise. */
export function tenantKey(tenant: TenantRef): string {
  return tenant.workspaceId
    ? `${tenant.organizationId}::${tenant.workspaceId}`
    : tenant.organizationId;
}
