/**
 * The five credential scopes, most-specific first (architecture §15.1).
 * Duplicated here (rather than imported from `@ai-gateway/config`) because
 * `provider-sdk` has zero internal dependencies beyond `core-contracts`
 * (Section 4.1's dependency table) — `provider-sdk` is one of the seams
 * every concrete provider adapter depends on, and must not pull in
 * deployment-configuration concerns.
 */
export const CREDENTIAL_SCOPES = [
  "user",
  "project",
  "workspace",
  "organization",
  "platform",
] as const;

export type CredentialScope = (typeof CREDENTIAL_SCOPES)[number];

/**
 * architecture §15/§16 (referenced by `CredentialResolver.resolve()` and
 * `ProviderAdapter.invoke()`/`invokeStream()`/`healthCheck()`, shape not
 * spelled out there). Holds already-resolved, ready-to-use secret material
 * for exactly one provider/tenant pair — an adapter never sees anything
 * more than this (no scope-resolution logic belongs in an adapter).
 *
 * `key` is decrypted, in-memory-only secret material: never logged, never
 * serialized into telemetry, never included in a `GatewayError.details`
 * payload.
 */
export interface ScopedCredential {
  /** The decrypted secret (e.g. an API key). Handle-with-care: see above. */
  key: string;
  /** Which scope in the resolution chain this credential was resolved from. */
  scope: CredentialScope;
  /** Seconds until this credential should be considered stale and re-resolved, if applicable. */
  ttl?: number;
}
