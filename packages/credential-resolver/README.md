# @ai-gateway/credential-resolver

**Status:** implemented (EM-2). Env-var and DB-backed credential resolution
with audit logging (architecture §15, §16, §20.3, §20.4; Blueprint §8.4).
Vault/cloud secret managers (AWS Secrets Manager, Azure Key Vault, GCP
Secret Manager) are explicitly **out of scope for EM-2** (Blueprint §7) —
see Deferred Work below.

## Public API

- `CredentialResolver.resolve(provider, tenant)` (architecture §11,
  verbatim) — `DefaultCredentialResolver` is the shipped implementation:
  resolves via a `ResolutionChain`, audit-logs the outcome (full detail,
  including any underlying error's message), and throws a redacted,
  generic error on any failure — `GatewayError("CREDENTIAL_NOT_FOUND", ...)`
  whether the chain found nothing or a layer beneath it raised a
  credential-specific error, or `GatewayError("INTERNAL_ERROR", ...)` for
  anything else — never revealing which scope(s) were tried or any
  operational detail (row IDs, env var names) to the caller (architecture
  §19.1).
- `ResolutionChain.resolve(provider, tenant)` (architecture §15.2,
  verbatim) — `DefaultResolutionChain` tries each configured `ScopeResolver`
  in `GatewayConfig.credentialPriority` order, most-specific first, and
  short-circuits on the first hit.
- `ScopeResolver` (architecture §15.2, verbatim) — `PlatformScopeResolver`
  (env-backed, one key per provider, no tenant scoping) and
  `DbScopeResolver` (one instance per `user`/`project`/`workspace`/
  `organization` scope, backed by a `CredentialStore`).
- `SecretSource` (architecture §15.3, verbatim) — `EnvSecretSource` and
  `DbSecretSource`, matching `CredentialReference`'s `"<sourceId>://<pointer>"`
  scheme.
- `registerCredential(...)` — BYOK registration: encrypts a plaintext key
  and stores it, audit-logging a `register` event. See Design notes for
  what this function deliberately does _not_ do.
- `AuditLogger` / `DefaultAuditLogger` — architecture §20.3's four event
  types (`register`, `resolve`, `rotate`, `revoke`), forwarded to
  `@ai-gateway/telemetry`'s `Telemetry.log`.
- `CredentialStore` / `InMemoryCredentialStore` — the BYOK storage seam.
- `AesGcmEncryptor` / `generateEncryptionKey` — the data half of
  architecture §20.1's envelope encryption (AES-256-GCM via `node:crypto`).

## Design notes

- **Isolation is enforced twice** (architecture §16.3): once at the data
  layer (`CredentialStore.findByScope`'s row-level tenant-scoped lookup)
  and once at the resolver layer (`DbScopeResolver`'s own, independently
  written tenant-field comparison). The two checks are deliberately _not_
  unified into one shared helper — see `scope-resolvers.ts`'s
  `expectedTenantFieldValue` docs — because a single shared implementation
  would let one bug defeat both layers at once. `test/isolation.test.ts`
  includes a scenario with a deliberately-buggy store to prove the second
  layer catches what the first layer would have missed.
  **Known-resolved gap (EM-2 review → EM-2 review resolution):** the
  independent EM-2 review found that both layers' _original_
  implementations validated a tenant's scope-relevant field the same way
  (`field ?? null`), which meant an empty or whitespace-only field (e.g.
  `workspaceId: ""`) passed both checks identically and let two different
  tenants that both had that field blank resolve to the same credential —
  a real, reproduced cross-tenant leak. Both layers now independently
  reject blank/whitespace-only/`null`/`undefined` scope fields (see
  `scopeKeyValue` in `store/credential-store.ts` and
  `expectedTenantFieldValue` in `scope-resolvers.ts`, each fixed with a
  differently-structured check so the fix itself doesn't reintroduce a
  single shared point of failure), and `CredentialStore.put` /
  `registerCredential` now reject registering a credential under a blank
  scope field in the first place. `test/isolation.test.ts` has dedicated
  regression coverage for empty string, whitespace-only, `null`, and
  `undefined` tenant fields across every non-platform scope. **The
  guarantee this section describes is accurate as of this fix; it was not
  fully accurate before it.**
- **Error redaction is now consistent across both `resolve()` failure
  paths** (architecture §19.1). Previously, a chain miss (`null` result)
  produced a redacted, generic `CREDENTIAL_NOT_FOUND`, while a thrown
  error from a `ScopeResolver`/`SecretSource` deeper in the chain
  propagated verbatim — leaking operational detail like row IDs or env
  var names to the caller. Both paths now throw the same generic,
  code-appropriate error (`CREDENTIAL_NOT_FOUND` for a credential-specific
  failure, `INTERNAL_ERROR` for anything else); full detail continues to
  reach the audit log either way, unredacted, since that's an
  operator-facing record, not a caller-facing one.
- **`ScopedCredential` and `TenantContext` are defined locally**, not
  imported from `@ai-gateway/provider-sdk`/`@ai-gateway/core-contracts`.
  `credential-resolver`'s frozen dependency edge (Blueprint §4.1) is
  `core-contracts`, `config`, `telemetry` only — see this milestone's
  Engineering Decisions for the full rationale (this continues an
  already-reviewed EM-1 pattern, not new debt).
- **`registerCredential` does not call `ProviderAdapter.healthCheck`.**
  architecture §16.2's full BYOK flow live-validates a new key against the
  provider before accepting it. `credential-resolver` has no dependency
  edge to `providers/provider-sdk` and never will (Blueprint §4.1), so that
  step is necessarily a higher-level caller's job — `orchestrator` (EM-4)
  is the natural place, once it exists. `registerCredential` accepts a key
  its caller has already decided to accept.
- **No real database or KMS exists in this repo.** `InMemoryCredentialStore`
  simulates "the DB" (encrypted-at-rest, per §20.1) and `AesGcmEncryptor`
  is constructed with a key the caller supplies directly — real KMS
  envelope-unwrapping is `apps/gateway-server`'s composition-root job
  (Blueprint §6.4, EM-5 scope), matching `@ai-gateway/config` and
  `@ai-gateway/model-registry`'s own equivalent deferrals.

## Usage example

```ts
import {
  DefaultCredentialResolver,
  DefaultResolutionChain,
  DefaultAuditLogger,
  PlatformScopeResolver,
  DbScopeResolver,
  EnvSecretSource,
  DbSecretSource,
  InMemoryCredentialStore,
  AesGcmEncryptor,
  generateEncryptionKey,
  registerCredential,
} from "@ai-gateway/credential-resolver";
import { createTelemetry } from "@ai-gateway/telemetry";

const store = new InMemoryCredentialStore();
const encryptor = new AesGcmEncryptor(generateEncryptionKey());
const auditLogger = new DefaultAuditLogger(createTelemetry());

const chain = new DefaultResolutionChain({
  resolvers: [
    new DbScopeResolver("user", store),
    new DbScopeResolver("project", store),
    new DbScopeResolver("workspace", store),
    new DbScopeResolver("organization", store),
    new PlatformScopeResolver({ groq: "GROQ_PLATFORM_API_KEY" }),
  ],
  sources: [new EnvSecretSource(), new DbSecretSource(store, encryptor)],
  priority: ["user", "project", "workspace", "organization", "platform"],
});

const resolver = new DefaultCredentialResolver({ chain, auditLogger });

await registerCredential(store, encryptor, auditLogger, {
  scope: "workspace",
  provider: "groq",
  tenant: { organizationId: "org-1", workspaceId: "ws-1" },
  plaintextKey: "sk-my-byok-key",
  actor: "user-123",
});

const credential = await resolver.resolve("groq", {
  organizationId: "org-1",
  workspaceId: "ws-1",
});
// credential.key === "sk-my-byok-key", credential.scope === "workspace"
```

## Dependencies

- `@ai-gateway/core-contracts`
- `@ai-gateway/config`
- `@ai-gateway/telemetry`

## Architecture reference

§15, §16

## Testing strategy

Isolation tests (`test/isolation.test.ts`) are a **hard merge gate**
(Blueprint §7), covering every non-platform scope, same-organization/
different-workspace collisions, same-org/workspace/project/different-user
collisions, cross-provider isolation, a deliberately-buggy-store scenario
proving the resolver-layer defense-in-depth check works independently of
the data layer, and — added in the EM-2 review resolution — every
non-platform scope's tenant field set to an empty string, a
whitespace-only string, `null`, and `undefined`, each asserting both that
registration itself is rejected (`registerCredential`/`CredentialStore.put`)
and that a same-blank-field second tenant cannot resolve the first
tenant's credential even if registration were somehow bypassed. Unit tests
cover encryption round-trips and tamper/wrong-key rejection, store
tenant-scoped lookups, both `SecretSource`s' error paths, both of
`DefaultCredentialResolver.resolve`'s failure paths now redacting to the
same generic error (with the audit log still receiving full detail),
`DefaultResolutionChain`'s priority ordering and short-circuit behavior,
and audit logging's field set (explicitly
never including a secret value).

## Deferred Work

- **Vault / AWS Secrets Manager / Azure Key Vault / GCP Secret Manager**
  `SecretSource` implementations (architecture §15.3 lists these as
  first-class alongside `env`/`db`) — Blueprint §7 scopes EM-2 to env + DB
  only. `SecretSource`'s interface already accommodates them additively;
  no interface change would be needed to add one.
- **Real DB-backed `CredentialStore`** (a real database, not
  `InMemoryCredentialStore`) and **real KMS-backed `Encryptor`** key
  management — both `apps/gateway-server`'s composition-root concern,
  EM-5.
- **`ProviderAdapter.healthCheck` live-validation during BYOK
  registration** (architecture §16.2's full flow) — needs a caller with
  access to both this package and `provider-sdk`; naturally `orchestrator`,
  EM-4.
- **[ADR-0005](../../docs/adr/0005-backoff-strategy-config-mismatch.md)**
  is unrelated to this package directly but was raised during this
  milestone's implementation of `reliability`; listed here only for
  cross-reference completeness in the EM-2 summary.
