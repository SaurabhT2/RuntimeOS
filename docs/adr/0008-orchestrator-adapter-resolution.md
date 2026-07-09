# ADR-0008: `orchestrator`'s provider-adapter resolution — resolving ADR-0007's open question

**Status:** Accepted (implemented as of EM-4)
**Date:** 2026-07-08
**Format:** Context / Decision / Consequences / Alternatives

## Context

ADR-0007 (`stream-manager-signature-gap.md`, filed during EM-3) documented
that `StreamManager.openStream(adapter, invocation, credential, requestId)`
takes a `ProviderAdapter` instance as a parameter, and observed that "the
orchestrator (EM-4), the one package with a legitimate dependency edge onto
both `policy-engine` and `streaming`, is expected to be the seam that
resolves an `ExecutionPlan` into `(adapter, invocation)`" — but left the
actual mechanism unspecified, since that was this milestone's job.

The EM-3 Architecture & Engineering Review's Section 7/15 named this
explicitly as EM-4's one required planning decision: "EM-4 must own the
translation of `ExecutionPlan → ProviderAdapter instance → NormalizedInvocation`
and the mechanism that resolves a provider identifier into a concrete
adapter implementation."

Two frozen facts constrain the design:

1. **`orchestrator`'s dependency edge** (Section 4.1's `DEPENDENCY_TABLE`,
   `.dependency-cruiser.cjs`, frozen at EM-0) is exactly `policy-engine`,
   `credential-resolver`, `reliability`, `streaming`, `telemetry`,
   `core-contracts`. It does **not** include `providers/provider-sdk`, nor
   (transitively) `providers/groq` / `providers/nvidia-nim`. This is
   enforced at two layers (ADR-0003): `.dependency-cruiser.cjs`'s boundary
   rule, and — more fundamentally — `orchestrator`'s own `package.json` has
   no dependency entry for `provider-sdk`, so pnpm's non-hoisted
   `node_modules` would not even resolve `@ai-gateway/provider-sdk` from
   inside `packages/orchestrator`.
2. **Architecture §6.4**'s composition-root pattern: "The only file in the
   entire codebase permitted to import concrete implementations of every
   interface simultaneously is `apps/gateway-server/src/bootstrap.ts`...
   which performs dependency injection exactly once, at process start."
   §12.4's "Adding a New Provider" walkthrough ends at "register the
   adapter instance in `bootstrap.ts`... no change to `orchestrator`... is
   required" — a guarantee that only holds if `orchestrator` never has a
   static import of any concrete adapter package.

Given both, `orchestrator` cannot itself construct a `GroqAdapter` or
`NimAdapter`, and cannot even import the `ProviderAdapter` _type_ from
`provider-sdk` to type a local variable against.

## Decision

`packages/orchestrator/src/types.ts` defines a full set of **structurally
identical, locally-duplicated types** — `ProviderAdapter`,
`NormalizedInvocation`, `NormalizedResult`, `NormalizedChunk`,
`ProviderCapabilities`, `CostEstimate` — mirroring their `provider-sdk`
counterparts field-for-field. This is the same pattern already used at
every other frozen-boundary crossing in this codebase:
`reliability`'s `ProviderHealthSnapshot`, `credential-resolver`'s
`ScopedCredential`/`TenantContext`, `provider-sdk`'s own `CredentialScope`
duplicate of `@ai-gateway/config`'s type, `policy-engine`'s
`RoutingOverrideLike`. TypeScript's structural (not nominal) typing means a
value passed as `orchestrator`'s local `ProviderAdapter` type is
transparently assignable to `streaming`'s `StreamManager.openStream`
parameter (typed against the real `provider-sdk` `ProviderAdapter`) with
zero runtime mapping — confirmed by `dependency-cruiser` reporting zero
violations for `packages/orchestrator` even after this file was added
(`packages/orchestrator/src/types.ts`'s own doc comment has the full
reasoning; `ScopedCredential` is the one type _not_ re-duplicated — it is
imported directly from `credential-resolver`, since that edge already
exists and `credential-resolver`'s own copy is already documented as
field-for-field identical to `provider-sdk`'s).

`types.ts` also defines `ProviderAdapterRegistry` (`resolve(providerId):
ProviderAdapter`) and ships one implementation,
`InMemoryProviderAdapterRegistry`. `orchestrator` never imports a concrete
adapter package — it only ever calls `.resolve()` on whatever registry
instance its caller constructs and injects
(`ExecutionOrchestratorOptions.adapterRegistry`). Per §6.4, populating that
registry with real `GroqAdapter`/`NimAdapter` instances is
`apps/gateway-server/src/bootstrap.ts`'s job (EM-5) — not yet built, so
every test in this codebase that needs a populated registry (this
package's own unit tests, and `tools/orchestrator-integration-tests`)
constructs one itself.

## Consequences

- `dependency-cruiser` (`pnpm graph:check`) reports **zero violations** for
  `orchestrator`, including its `test/` directory — confirmed as part of
  this milestone's validation.
- `packages/orchestrator/test/` can never construct a real `MockAdapter`,
  `GroqAdapter`, or `NimAdapter` (no dependency edge to `provider-sdk`
  exists there either — the boundary rule applies to test files, not just
  `src/`). This package's own tests use hand-built fake `ProviderAdapter`
  objects (mirroring `streaming`'s own precedent: its README documents
  testing "all against a hand-built fake `ProviderAdapter`, no real
  network involved"). The Engineering Blueprint's EM-4 requirement for
  "end-to-end integration tests against both the Mock Adapter and
  recorded-fixture real adapters" is satisfied instead by
  `tools/orchestrator-integration-tests` — a new cross-package test
  package, exempt from the per-package `DEPENDENCY_TABLE` the same way
  `tools/adapter-conformance-tests` already is (`package.json`'s
  `graph:check` script only cruises `packages apps`). See that package's
  README.
- Any future EM-5 (`apps/gateway-server`) or later milestone adding a new
  provider package need not touch `orchestrator` at all — exactly
  architecture §12.4's stated goal — only construct the new adapter and
  register it with whatever `ProviderAdapterRegistry` the composition root
  builds.
- `InMemoryProviderAdapterRegistry` is a real, shippable implementation
  (not a test-only stub) — nothing about it requires a database, so
  `bootstrap.ts` can use it as-is, populated with real adapter instances,
  rather than needing its own registry implementation.

## Alternatives considered

### A — Widen `orchestrator`'s dependency edge to include `provider-sdk`

Would let `orchestrator` import the real `ProviderAdapter` type directly,
removing the duplication in `types.ts`. Rejected: modifying
`.dependency-cruiser.cjs`'s `DEPENDENCY_TABLE` is a change to a frozen
EM-0 artifact, which this milestone's Engineering Rules explicitly
prohibit ("Never redesign: package boundaries, dependency graph, frozen
public interfaces... If implementation reveals an architectural
inconsistency, stop and document it as an ADR candidate. Do not redesign
the architecture."). It would also still leave `orchestrator` unable to
import concrete `GroqAdapter`/`NimAdapter` without _also_ widening the
edge onto every current and future provider package — the opposite of
architecture §12.4's "no change to orchestrator" goal for adding a
provider.

### B — Have `policy-engine`'s `ExecutionPlan` carry the resolved adapter instance directly

Would remove the need for a registry inside `orchestrator` entirely.
Rejected: `policy-engine`'s own dependency edge (`model-registry`,
`reliability`, `core-contracts`) is just as far from `provider-sdk` as
`orchestrator`'s is, so this would only relocate the same unresolved
problem one package over, not solve it — and would make `policy-engine`
(a pure scoring/decision component, architecture §13) respons­ible for
provider-instance lifecycle, which is a layering inversion the
architecture's package diagram does not support.
