/**
 * @ai-gateway/credential-resolver
 *
 * Env-var and DB-backed credential resolution with audit logging
 * (architecture §15, §16, §20.3, §20.4).
 *
 * STATUS: implemented (Engineering Milestone EM-2, Blueprint §7, §8.4).
 * Vault/cloud secret managers are explicitly out of scope for EM-2
 * (Blueprint §7) — see this package's README for the deferred-work list.
 *
 * Architecture reference: §15, §16
 */

export {
  type TenantContext,
  type ScopedCredential,
  type CredentialReference,
  makeCredentialReference,
  parseCredentialReference,
  type SecretSource,
  type ScopeResolver,
  type ResolutionChain,
  type CredentialResolver,
} from "./types.js";

export { AesGcmEncryptor, generateEncryptionKey, type Encryptor } from "./encryption.js";

export {
  type CredentialRow,
  type CredentialStore,
  InMemoryCredentialStore,
} from "./store/credential-store.js";

export { EnvSecretSource, ENV_SECRET_SOURCE_ID } from "./sources/env-secret-source.js";
export { DbSecretSource, DB_SECRET_SOURCE_ID } from "./sources/db-secret-source.js";

export { PlatformScopeResolver, DbScopeResolver } from "./scope-resolvers.js";

export { DefaultResolutionChain, type DefaultResolutionChainOptions } from "./resolution-chain.js";

export {
  DefaultCredentialResolver,
  type DefaultCredentialResolverOptions,
  registerCredential,
  type RegisterCredentialInput,
  type RegisterCredentialResult,
} from "./resolver.js";

export {
  AUDIT_EVENT_TYPES,
  type AuditEventType,
  type AuditEvent,
  type AuditLogger,
  DefaultAuditLogger,
} from "./audit.js";
