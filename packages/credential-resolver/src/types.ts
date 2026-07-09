import type { CredentialScope } from "@ai-gateway/config";

/**
 * architecture §10.3's `ExecuteRequest.tenant` shape, structurally
 * duplicated here as its own named type. architecture §15.2 references
 * `TenantContext` in `ResolutionChain.resolve`/`ScopeResolver.lookup`
 * without defining it in `core-contracts` (where `ExecuteRequest` itself
 * lives) — designed, not specified, matching this codebase's established
 * precedent for interface details architecture references but doesn't
 * spell out in the same section (e.g. EM-1's `ScopedCredential`,
 * `NormalizedChunk`).
 *
 * Deliberately structurally identical to `ExecuteRequest["tenant"]` (same
 * field names, same optionality) so that `orchestrator` (EM-4) can pass
 * `req.tenant` directly to `CredentialResolver.resolve()` with no mapping
 * step required — TypeScript's structural typing makes this work without
 * `credential-resolver` needing a dependency edge on `core-contracts` for
 * this type specifically (it already depends on `core-contracts` for other
 * reasons, but this type doesn't need to be re-exported from there).
 */
export interface TenantContext {
  organizationId: string;
  workspaceId?: string;
  projectId?: string;
  userId?: string;
}

/**
 * architecture §11 (`ProviderAdapter.invoke()`/`invokeStream()`/
 * `healthCheck()` and `CredentialResolver.resolve()` — shape not spelled
 * out there beyond the type name). Field-for-field identical to
 * `@ai-gateway/provider-sdk`'s `ScopedCredential`, duplicated here rather
 * than imported for the same reason `provider-sdk` itself duplicates
 * `CredentialScope` rather than importing it from `@ai-gateway/config`:
 * `credential-resolver`'s frozen dependency edge (Blueprint §4.1) is
 * `core-contracts`, `config`, `telemetry` only — it must never depend on
 * `providers/provider-sdk`. See this milestone's Engineering Decisions for
 * the full rationale (this is a continuation of an already-reviewed
 * pattern, not new debt introduced here).
 *
 * Note `scope` reuses `@ai-gateway/config`'s `CredentialScope` directly
 * (an allowed import, unlike `provider-sdk`'s own copy of the same union) —
 * `credential-resolver` already depends on `config` for `credentialPriority`
 * ordering, so no duplication is needed for this one field.
 */
export interface ScopedCredential {
  /** The decrypted secret (e.g. an API key). Handle-with-care: see below. */
  key: string;
  scope: CredentialScope;
  /** Seconds until this credential should be considered stale and re-resolved, if applicable. */
  ttl?: number;
}

/**
 * architecture §15.2, verbatim wording: "Each `CredentialReference` is a
 * *pointer* (`vault://...`, `aws-sm://...`, a DB row ID) — never the raw
 * secret." Modeled directly as that illustrated string form: a URI-shaped
 * pointer whose scheme names the `SecretSource` that can dereference it
 * (`SecretSource.id`, architecture §15.3), e.g. `"env://GROQ_PLATFORM_KEY"`
 * or `"db://cred_8f3a2b1c"`. `parseCredentialReference`/
 * `makeCredentialReference` are the one shared place that convention is
 * encoded, so `ResolutionChain`/`SecretSource` implementations never
 * hand-parse the scheme themselves.
 */
export type CredentialReference = string;

const REFERENCE_PATTERN = /^([a-z0-9-]+):\/\/(.+)$/;

/** Builds a `CredentialReference` for `sourceId` pointing at `pointer`. */
export function makeCredentialReference(sourceId: string, pointer: string): CredentialReference {
  return `${sourceId}://${pointer}`;
}

/**
 * Splits a `CredentialReference` back into its `sourceId` and `pointer`.
 * Returns `null` for a malformed reference (missing/invalid scheme) rather
 * than throwing, so callers (`resolver.ts`) can turn it into a proper
 * `GatewayError("CREDENTIAL_INVALID", ...)` with context, instead of an
 * uncaught exception.
 */
export function parseCredentialReference(
  reference: CredentialReference,
): { sourceId: string; pointer: string } | null {
  const match = REFERENCE_PATTERN.exec(reference);
  if (!match) {
    return null;
  }
  const [, sourceId, pointer] = match;
  return { sourceId: sourceId!, pointer: pointer! };
}

/** architecture §15.3, verbatim. */
export interface SecretSource {
  /** e.g. "env" | "db" | "vault" | "aws-sm" | "azure-kv" | "gcp-sm" */
  readonly id: string;
  fetch(reference: CredentialReference): Promise<string>;
}

/** architecture §15.2, verbatim. */
export interface ScopeResolver {
  scope: CredentialScope;
  lookup(provider: string, tenant: TenantContext): Promise<CredentialReference | null>;
}

/** architecture §15.2, verbatim. */
export interface ResolutionChain {
  resolve(provider: string, tenant: TenantContext): Promise<ScopedCredential | null>;
}

/** architecture §11, verbatim. */
export interface CredentialResolver {
  resolve(provider: string, tenant: TenantContext): Promise<ScopedCredential>;
}
