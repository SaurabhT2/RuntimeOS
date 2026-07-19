import { randomUUID } from "node:crypto";
import type { CredentialScope } from "@ai-gateway/config";
import type { TenantContext } from "../types.js";

/**
 * One stored BYOK credential row (architecture §16.2's "store
 * encrypted(apiKey), scope=workspace"). `encryptedKey` is always ciphertext
 * (see `encryption.ts`) — never the plaintext key, matching architecture
 * §20.1's "encrypted at rest" requirement even for this in-memory
 * stand-in.
 */
export interface CredentialRow {
  rowId: string;
  scope: CredentialScope;
  provider: string;
  /**
   * The tenant scoping tag this row was registered under (architecture
   * §20.4: "every credential... is tagged with full tenant scope... and
   * every read path filters on it"). Only the field matching `scope` is
   * meaningful for lookup (e.g. a `workspace`-scoped row is looked up by
   * `tenant.workspaceId`); the others are carried along for audit/display
   * purposes only.
   */
  tenant: TenantContext;
  encryptedKey: string;
  createdAt: string;
}

/**
 * The registry's storage seam for DB-backed (BYOK + platform) credentials
 * (architecture §15.3: "`db`... encrypted-at-rest column, for workspace/
 * org/user BYOK keys"). Row-level tenant scoping is enforced here
 * (`findByScope`'s filtering) as the first of architecture §16.3's two
 * isolation layers ("enforced at the data layer... and re-verified at the
 * resolver layer, so a bug in one layer cannot alone cause cross-tenant
 * credential leakage") — `resolver.ts` is the second layer.
 *
 * No real database driver exists anywhere in this repo yet (that wiring is
 * `apps/gateway-server`'s composition root, Blueprint §6.4, EM-5 scope,
 * same deferral already established for `reliability`'s `HealthStateStore`
 * and `model-registry`'s `ModelStore`) — `InMemoryCredentialStore` is the
 * only implementation shipped in EM-2, and a real DB-backed implementation
 * is additive future work, not a redesign.
 */
export interface CredentialStore {
  put(row: Omit<CredentialRow, "rowId" | "createdAt">): Promise<CredentialRow>;
  getById(rowId: string): Promise<CredentialRow | null>;
  /**
   * Looks up the row (if any) matching `scope`/`provider`/the tenant field
   * `scope` implies (architecture §15.2's `ScopeResolver.lookup`, one
   * concrete lookup per scope). Returns `null` — never a row belonging to
   * a different tenant — when no exact match exists; this is the row-level
   * scoping half of §16.3's isolation guarantee.
   */
  findByScope(
    scope: CredentialScope,
    provider: string,
    tenant: TenantContext,
  ): Promise<CredentialRow | null>;
  delete(rowId: string): Promise<boolean>;
}

/**
 * Extracts the tenant-scoping field relevant to `scope` (architecture
 * §20.4's "every credential... is tagged with full tenant scope... and
 * every read path filters on it" — this is that filter, made concrete per
 * scope level). `"platform"` has no tenant-specific field: a
 * platform-managed key is global by definition (architecture §16.1), so it
 * resolves to a fixed sentinel rather than any tenant field.
 *
 * Returns `null` — "no meaningful scope value" — for `undefined`, `null`
 * (a caller may hand this function a value that violates `TenantContext`'s
 * type at runtime even though the type disallows it, e.g. JSON parsed from
 * an external source), an empty string, or a whitespace-only string. This
 * is a deliberate, EM-2-review-driven fix: treating an empty/whitespace
 * string as if it were a real, comparable scope value let two distinct
 * tenants that both happened to have (say) `workspaceId: ""` resolve to
 * the *same* store row — see this milestone's Security Fix Summary. A
 * value that carries no real tenant identity must never be treated as
 * equal to another tenant's equally-absent value.
 */
function scopeKeyValue(scope: CredentialScope, tenant: TenantContext): string | null {
  if (scope === "platform") {
    return "platform";
  }

  let candidate: string | null | undefined;
  switch (scope) {
    case "user":
      candidate = tenant.userId;
      break;
    case "project":
      candidate = tenant.projectId;
      break;
    case "workspace":
      candidate = tenant.workspaceId;
      break;
    case "organization":
      candidate = tenant.organizationId;
      break;
    /* v8 ignore next 4 -- exhaustiveness guard, unreachable given CredentialScope's type */
    default: {
      const exhaustiveCheck: never = scope;
      throw new RangeError(`Unknown credential scope: ${String(exhaustiveCheck)}`);
    }
  }

  if (candidate === null || candidate === undefined) {
    return null;
  }
  // `.trim().length === 0` catches both `""` and whitespace-only strings
  // (`"   "`) — both carry no real tenant identity, per the review finding.
  if (candidate.trim().length === 0) {
    return null;
  }
  return candidate;
}

function lookupKey(scope: CredentialScope, provider: string, scopeValue: string): string {
  return `${scope}::${provider}::${scopeValue}`;
}

export class InMemoryCredentialStore implements CredentialStore {
  private readonly rowsById = new Map<string, CredentialRow>();
  private readonly rowIdByLookupKey = new Map<string, string>();

  put(row: Omit<CredentialRow, "rowId" | "createdAt">): Promise<CredentialRow> {
    const scopeValue = scopeKeyValue(row.scope, row.tenant);
    if (scopeValue === null) {
      const fieldName = `${row.scope}Id` as keyof TenantContext;
      return Promise.reject(
        new RangeError(
          `Cannot store a "${row.scope}"-scoped credential: tenant.${fieldName} must be a ` +
            `non-empty, non-whitespace string (got ${JSON.stringify(row.tenant[fieldName])}).`,
        ),
      );
    }

    const full: CredentialRow = {
      ...row,
      rowId: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.rowsById.set(full.rowId, full);
    this.rowIdByLookupKey.set(lookupKey(row.scope, row.provider, scopeValue), full.rowId);
    return Promise.resolve(full);
  }

  getById(rowId: string): Promise<CredentialRow | null> {
    return Promise.resolve(this.rowsById.get(rowId) ?? null);
  }

  findByScope(
    scope: CredentialScope,
    provider: string,
    tenant: TenantContext,
  ): Promise<CredentialRow | null> {
    const scopeValue = scopeKeyValue(scope, tenant);
    if (scopeValue === null) {
      return Promise.resolve(null);
    }
    const rowId = this.rowIdByLookupKey.get(lookupKey(scope, provider, scopeValue));
    return Promise.resolve(rowId ? (this.rowsById.get(rowId) ?? null) : null);
  }

  delete(rowId: string): Promise<boolean> {
    const row = this.rowsById.get(rowId);
    if (!row) {
      return Promise.resolve(false);
    }
    this.rowsById.delete(rowId);
    const scopeValue = scopeKeyValue(row.scope, row.tenant);
    if (scopeValue !== null) {
      this.rowIdByLookupKey.delete(lookupKey(row.scope, row.provider, scopeValue));
    }
    return Promise.resolve(true);
  }
}
