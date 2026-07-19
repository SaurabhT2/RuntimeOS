import type { CredentialScope } from "@ai-gateway/config";
import type { CredentialReference, ScopeResolver, TenantContext } from "./types.js";
import { makeCredentialReference } from "./types.js";
import type { CredentialStore } from "./store/credential-store.js";
import { ENV_SECRET_SOURCE_ID } from "./sources/env-secret-source.js";
import { DB_SECRET_SOURCE_ID } from "./sources/db-secret-source.js";

/**
 * architecture §16.1: platform-managed keys are the "always-present
 * fallback" — one env-var-backed key per provider, with no tenant scoping
 * (there is exactly one platform key, shared by every tenant that hasn't
 * BYOK'd their own). `envVarByProvider` is the operator-configured mapping
 * from provider ID to the env var holding that provider's platform key
 * (e.g. `{ groq: "GROQ_PLATFORM_API_KEY" }`) — deliberately explicit rather
 * than a naming convention like `${PROVIDER}_API_KEY`, so an operator can
 * name env vars however their deployment already does.
 */
export class PlatformScopeResolver implements ScopeResolver {
  public readonly scope: CredentialScope = "platform";

  constructor(private readonly envVarByProvider: Record<string, string>) {}

  async lookup(provider: string, _tenant: TenantContext): Promise<CredentialReference | null> {
    const envVar = this.envVarByProvider[provider];
    if (!envVar) {
      return null;
    }
    return makeCredentialReference(ENV_SECRET_SOURCE_ID, envVar);
  }
}

/**
 * architecture §16.3: "enforced at the data layer (row-level scoping) and
 * re-verified at the resolver layer (defense in depth), so a bug in one
 * layer cannot alone cause cross-tenant credential leakage." This function
 * is deliberately a *separate, independently-written* piece of logic from
 * `store/credential-store.ts`'s own tenant-field mapping (not a shared
 * import) — the whole point of a second layer is that a bug in one
 * implementation doesn't automatically exist in the other. If this function
 * and the store's internal mapping were unified into one shared helper, a
 * single bug in that helper would silently defeat both layers at once,
 * which is exactly the failure mode §16.3 calls out.
 *
 * **Post-EM-2-review fix:** this function previously used
 * `tenant.workspaceId ?? null`-style null-coalescing, which let an empty
 * or whitespace-only string (a value carrying no real tenant identity)
 * pass through as if it were a genuine, comparable scope value — so two
 * tenants that both happened to have, say, `workspaceId: ""` would
 * compare as "the same tenant" here. The store's own tenant-field mapping
 * had the identical gap, so both "independent" layers failed together on
 * the same input class (see this milestone's Security Fix Summary for the
 * full account). The fix below is deliberately implemented as a
 * differently-shaped check (a field-name lookup plus an explicit
 * `typeof`/blank-string test) rather than copying the store's fixed
 * version verbatim — preserving this file's original intent that a
 * mistake in one layer's *validation logic specifically* not be
 * guaranteed to reappear in the other, even though both layers'
 * *starting* bug happened to coincide.
 */
function expectedTenantFieldValue(scope: CredentialScope, tenant: TenantContext): string | null {
  if (scope === "platform") {
    return null; // "platform" has no tenant-specific field; PlatformScopeResolver handles that scope, never this class.
  }

  const fieldName: keyof TenantContext =
    scope === "user"
      ? "userId"
      : scope === "project"
        ? "projectId"
        : scope === "workspace"
          ? "workspaceId"
          : "organizationId";

  const value = tenant[fieldName];
  // `typeof value !== "string"` rejects `undefined` (the only other type
  // `TenantContext`'s fields can hold per their declared type) and also
  // guards against a caller handing this function a `TenantContext` that
  // violates its own type at runtime (e.g. an externally-sourced `null`).
  if (typeof value !== "string") {
    return null;
  }
  // A blank (empty or all-whitespace) string is, semantically, "no tenant
  // identity provided" — the same non-identity as `undefined` — and must
  // never compare equal to another tenant's equally-blank value.
  if (value.trim().length === 0) {
    return null;
  }
  return value;
}

/**
 * architecture §15.2: one `ScopeResolver` per non-platform scope
 * (`user`/`project`/`workspace`/`organization`), each backed by the same
 * `CredentialStore` (architecture §16.2's BYOK registration target) —
 * hence one generic, parametrized class rather than four near-identical
 * ones (Blueprint §13.6's duplication guidance: four copy-pasted classes
 * differing only in `scope` would be exactly the kind of near-duplicate
 * logic that rule warns against).
 */
export class DbScopeResolver implements ScopeResolver {
  constructor(
    public readonly scope: Exclude<CredentialScope, "platform">,
    private readonly store: CredentialStore,
  ) {}

  async lookup(provider: string, tenant: TenantContext): Promise<CredentialReference | null> {
    const row = await this.store.findByScope(this.scope, provider, tenant);
    if (!row) {
      return null;
    }

    // Defense-in-depth re-verification (architecture §16.3): confirm the
    // row's own recorded tenant tag matches the requesting tenant, using
    // logic independent of the store's internal lookup-key construction.
    const expected = expectedTenantFieldValue(this.scope, tenant);
    const actual = expectedTenantFieldValue(this.scope, row.tenant);
    if (expected === null || actual === null || expected !== actual) {
      return null;
    }

    return makeCredentialReference(DB_SECRET_SOURCE_ID, row.rowId);
  }
}
