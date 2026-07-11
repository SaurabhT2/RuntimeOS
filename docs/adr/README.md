# Architecture Decision Records — Index

Twelve ADRs are on record, spanning EM-0 through EM-5.5. `0000-template.md`
is the template used to write all of them, not a decision itself.

Status legend: **Accepted** decisions are settled and reflected in the
codebase as implemented. **Proposed / draft** ADRs document a real,
verified inconsistency between the frozen Architecture Specification and
the implementation as it exists today; each was raised because a later
milestone's package correctly implemented its own spec section but, in
doing so, exposed a gap or contradiction one layer up. They are recorded
rather than silently resolved, per the project's "document, don't invent a
solution" rule for cross-milestone architectural findings. None of the
open items has been decided by the Architecture Review Board yet.

## Accepted

| ADR | Title | Description |
|---|---|---|
| [0001](0001-em0-core-contracts-freeze.md) | Freeze `core-contracts` and promote it to `1.0.0` at EM-0 | Decision to freeze and version-lock `core-contracts` at EM-0, since every other package and every external consumer depends on it. |
| [0002](0002-json-schema-and-tool-call-shapes.md) | Concrete shapes for `JSONSchema` and `ToolCall` | Defines concrete shapes for two types the architecture spec references but never fully specifies. |
| [0003](0003-boundary-enforcement-layers.md) | Boundary enforcement has three layers, not one | Documents that pnpm, dependency-cruiser, and ESLint each catch different kinds of package-boundary violation, confirmed by deliberately introducing and reverting a forbidden import. |
| [0008](0008-orchestrator-adapter-resolution.md) | `orchestrator`'s provider-adapter resolution | Resolves ADR-0007's open question: how `orchestrator` turns an `ExecutionPlan` into a concrete `(adapter, invocation)` pair. Implemented as of EM-4. |
| [0012](0012-shared-gateway-runtime-package.md) | Extract `bootstrap()` and the HTTP composition layer into `@ai-gateway/gateway-runtime`, a shared package | Corrects ADR-0011: the app-isolation boundary that forbade `apps/vercel-adapter` from importing `apps/gateway-server` directly never forbade either from depending on a shared `packages/*` module. Moves `bootstrap()`, the router, request handlers, parsing, validation, and response-shaping into `@ai-gateway/gateway-runtime`, eliminating the duplication ADR-0011 had accepted. |

## Superseded

| ADR | Title | Description |
|---|---|---|
| [0011](0011-vercel-adapter-app-boundary-duplication.md) | `apps/vercel-adapter` duplicates a small amount of app-layer HTTP glue instead of importing it from `apps/gateway-server` | Superseded by [0012](0012-shared-gateway-runtime-package.md). Retained for the historical record of the (mistaken) reasoning that led to accepting the duplication in the first place — not an accurate description of the current codebase. |

## Proposed / Draft — open for decision

| ADR | Title | Description |
|---|---|---|
| [0004](0004-provider-adapter-cancellation-draft.md) | `ProviderAdapter` has no cancellation primitive | Flags that the frozen `ProviderAdapter` interface (architecture §11) has no `abort()`/`AbortSignal`-style cancellation, despite §18.4/§24 assuming one exists. Raised by independent EM-1 review. |
| [0005](0005-backoff-strategy-config-mismatch.md) | `BackoffStrategy` has three values in architecture §18.1 but two in `@ai-gateway/config` | Flags a mismatch between the architecture's three-value backoff strategy union and the two-value version already frozen in `@ai-gateway/config` at EM-1. Raised during EM-2. |
| [0006](0006-policy-engine-config-dependency-gap.md) | `policy-engine` has no dependency edge onto `@ai-gateway/config` | Flags that `policy-engine` has no declared dependency on `@ai-gateway/config`, so it uses constructor-supplied defaults instead of the config-sourced values architecture §13.3/§13.4 describe. Raised during EM-3. |
| [0007](0007-stream-manager-signature-gap.md) | `StreamManager.openStream`'s literal signature doesn't compile against this codebase's dependency boundaries | Flags that architecture §11's literal `StreamManager` signature can't compile within the frozen dependency boundaries, and that `cancel(requestId)` has no addressable implementation path. Raised during EM-3; partially resolved by ADR-0008. |
| [0009](0009-middleware-config-gap.md) | `middleware` has no `@ai-gateway/config` field for API keys, rate-limit thresholds, or cache TTL | Same category of finding as ADR-0006: `middleware` uses constructor-supplied options because `@ai-gateway/config` has no corresponding schema section. Raised during EM-4. |
| [0010](0010-gatewayconfig-reliability-section-unconsumed.md) | `GatewayConfig.reliability` is unconsumed by any package | Flags that `GatewayConfig.reliability`, a fully-defined and validated config section, is read by no package anywhere in the codebase. Discovered at EM-5, the first point where every package is wired together at once. |

## Template

| ADR | Title | Description |
|---|---|---|
| [0000](0000-template.md) | ADR template | The Context / Decision / Consequences / Alternatives template used to write every ADR above. Not a decision record itself. |
