# AI Gateway

A universal AI execution platform: callers describe _what they want done_
(`task`, content, constraints) and the gateway routes, executes, retries,
and fails over across providers — without the caller ever naming a provider
or model directly. See [`docs/architecture/architecture-spec.md`](docs/architecture/architecture-spec.md)
(frozen) for the full architecture and
[`docs/architecture/engineering-blueprint.md`](docs/architecture/engineering-blueprint.md)
(frozen) for the milestone-by-milestone implementation plan. Every "architecture §N" /
"Blueprint §N" reference anywhere in this repository (package READMEs, ADRs, this file) points
into one of those two documents; section numbering is unchanged from the original.

**Status: v1.0 baseline complete (EM-0 – EM-5); EM-6/EM-7 Strategy Layer
foundation packages complete; EM-8 Strategy Layer integration complete.**
A deployable HTTP/SSE gateway server (`apps/gateway-server`) wires every
platform package together into a running MVP exposing `POST /v1/execute`,
`POST /v1/execute/stream`, and `GET /v1/health`. EM-6/EM-7 built seven
independent Strategy Layer foundation packages (`capability-registry`,
`execution-profile-registry`, `runtime-profiles`, `cost-optimizer`,
`prompt-optimizer`, `learning`, `plugin-system`) without wiring any of them
into the running gateway. EM-8 adds `strategy-layer` (architecture §30) —
the orchestration package that resolves all of the above into an immutable
`StrategyDecision` — and wires it into `orchestrator`, behind the
`enableStrategyLayer` feature flag (default `false`; see ADR-0017 and
[`docs/architecture/em-8-runtime-flow.md`](docs/architecture/em-8-runtime-flow.md)
for diagrams). `plugin-system` remains unintegrated — that is a later
milestone. See
[`docs/history/IMPLEMENTATION_PROGRESS.md`](docs/history/IMPLEMENTATION_PROGRESS.md)
for the full per-milestone build history.

## Repository layout

```
apps/            deployable applications
  gateway-server/          the v1.0 composition root — HTTP/SSE server wiring
                            every platform package into a running gateway
packages/        library packages — the bulk of the platform
  core-contracts/          public request/response/error contracts, frozen at 1.0.0
  config/                  Zod/JSON-schema validated configuration loader
  telemetry/               OpenTelemetry tracer/metrics/logger wrapper
  providers/provider-sdk/  ProviderAdapter interface, Mock Adapter, conformance harness
  reliability/             retry engine, circuit breaker, timeout manager, health monitor
  model-registry/          queryable, config-driven model registry
  credential-resolver/     BYOK-aware credential resolution with per-tenant isolation
  policy-engine/           task-to-model scoring, ranking, and ExecutionPlan assembly
  providers/groq/          Groq ProviderAdapter implementation
  providers/nvidia-nim/    NVIDIA NIM ProviderAdapter implementation
  streaming/               StreamManager and SSE/WebSocket transports
  orchestrator/            ExecutionOrchestrator — the full request lifecycle
  middleware/              auth, rate limiting, and response caching pipeline
  capability-registry/     (EM-6) task -> abstract CapabilitySet mapping
  execution-profile-registry/  (EM-6) task -> ExecutionProfile (inference params, retry, streaming/caching defaults)
  runtime-profiles/        (EM-6) deployment/tenant-wide behavior overlay (provider pref, cost, telemetry, caching)
  cost-optimizer/          (EM-7) model-downgrade/cache/streaming/free-tier optimization decisions
  prompt-optimizer/        (EM-7) provider-independent prompt transformation pipeline
  learning/                (EM-7) Intelligent Learning extension points (no-op-by-default sockets)
  plugin-system/           (EM-7) Gateway Plugin framework — contract, registration, lifecycle, discovery, loading
  strategy-layer/          (EM-8) integrates capability/execution-profile/runtime-profile resolution + cost/prompt optimization + learning hooks into an immutable StrategyDecision; wired into orchestrator
examples/        example clients calling a running gateway over its public REST API
tools/           shared cross-package tooling, e.g. adapter-conformance-tests,
                  orchestrator-integration-tests, em6-strategy-foundation-demo
docs/adr/        architecture decision records — see docs/adr/README.md for the index
docs/architecture/  the Architecture Specification and Engineering Blueprint (see below)
docs/history/    historical build records, e.g. IMPLEMENTATION_PROGRESS.md
.github/workflows/ci.yml   CI: format, dependency graph, lint, typecheck, test, build
```

This mirrors the architecture spec's repository structure (§9), with `docs/architecture/`
and `docs/history/` added during PG-2 documentation stabilization so the source documents
and historical build record are part of the repository itself rather than external artifacts.

## Engineering milestones

All milestones below are complete; see
[`docs/history/IMPLEMENTATION_PROGRESS.md`](docs/history/IMPLEMENTATION_PROGRESS.md) for
full acceptance-criteria detail on each. That document is a chronological build record, not
living reference documentation — for current package responsibilities, see the inventory
above; for the authoritative milestone sequence, see the Engineering Blueprint's §7
(`docs/architecture/engineering-blueprint.md`).

| Milestone | Delivered                                                                                                                                                                                                                                                                                                                                |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EM-0      | Monorepo scaffold, shared tooling, `core-contracts` implemented and frozen at `1.0.0`                                                                                                                                                                                                                                                    |
| EM-1      | `config`, `telemetry`, `provider-sdk` (incl. Mock Adapter and conformance harness)                                                                                                                                                                                                                                                       |
| EM-2      | `reliability` (retry engine, circuit breaker, timeout manager, health monitor)                                                                                                                                                                                                                                                           |
| EM-3      | `model-registry`, `credential-resolver`, `policy-engine`, `streaming`                                                                                                                                                                                                                                                                    |
| EM-4      | `orchestrator`, the Groq and NVIDIA NIM provider adapters, end-to-end integration/chaos tests (`tools/orchestrator-integration-tests`)                                                                                                                                                                                                   |
| EM-5      | `middleware`, `apps/gateway-server` (the composition root), `examples/*`                                                                                                                                                                                                                                                                 |
| EM-6      | `capability-registry`, `execution-profile-registry`, `runtime-profiles` — the Strategy Layer foundation (architecture §30–§37); no orchestrator/policy-engine wiring yet                                                                                                                                                                 |
| EM-7      | `cost-optimizer`, `prompt-optimizer`, `learning`, `plugin-system` — Optimization Pipeline & Plugin System foundation (architecture §33/§34/§36/§11); no orchestrator/policy-engine wiring yet                                                                                                                                            |
| EM-8      | `strategy-layer` (architecture §30) — integrates every EM-6/EM-7 foundation package (except `plugin-system`) into an immutable `StrategyDecision`; wired into `orchestrator` behind the `enableStrategyLayer` feature flag (ADR-0017); `policy-engine` receives the decision via `PolicyContext` but does not yet score on it (ADR-0018) |

## Getting started

```bash
corepack enable
pnpm install
pnpm build          # turbo run build — builds every package, dependency-order aware
pnpm test           # turbo run test
pnpm test:coverage  # turbo run test:coverage
pnpm lint           # turbo run lint (ESLint, incl. package-boundary rule)
pnpm typecheck      # turbo run typecheck
pnpm graph:check    # dependency-cruiser: zero cycles, Section 4.1 boundaries enforced
pnpm format         # prettier --write .
pnpm format:check   # prettier --check .
```

All of the above run in CI on every push/PR — see `.github/workflows/ci.yml`.

To run the gateway server itself, see `apps/gateway-server/README.md` for
configuration and the full public API. To see it called from the outside,
see `examples/minimal-node-client` and `examples/streaming-client`.

## Tooling choices (Section 3 of [the Blueprint](docs/architecture/engineering-blueprint.md))

| Concern                      | Choice                                              | Why                                                                                                                                                                                                  |
| ---------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package manager / workspaces | pnpm workspaces                                     | Strict, non-hoisted `node_modules` catches undeclared cross-package imports at resolution time — see `docs/adr/0003-boundary-enforcement-layers.md` for a worked example of this actually happening. |
| Build orchestration          | Turborepo                                           | Dependency-graph-aware task scheduling and caching (`turbo.json` mirrors the package dependency graph).                                                                                              |
| Language                     | TypeScript, strict mode                             | `tsconfig.base.json` — `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, etc.                                                                                                              |
| Runtime validation           | Zod                                                 | Every `core-contracts` type has a companion schema for trust-boundary validation.                                                                                                                    |
| Linting                      | ESLint 9 (flat config) + `eslint-plugin-boundaries` | Category-level package-boundary enforcement, defense-in-depth alongside dependency-cruiser.                                                                                                          |
| Dependency graph enforcement | dependency-cruiser                                  | The canonical, CI-gated check: zero cycles, and every package's allowed dependencies generated directly from the Section 4.1 table (`.dependency-cruiser.cjs`).                                      |
| Testing                      | Vitest                                              | Per-package `vitest.config.ts`; coverage via `@vitest/coverage-v8`.                                                                                                                                  |
| Versioning                   | Changesets                                          | Independent per-package semver (`.changeset/config.json`); `core-contracts` is the first package at `1.0.0`.                                                                                         |

## Architecture decision records

Thirteen ADRs are on record in `docs/adr/`, spanning EM-0 through EM-6. See
[`docs/adr/README.md`](docs/adr/README.md) for the full index, including
which are accepted and which are still open for decision.

## Release governance

AI Gateway v1.0.0 is the first tagged release. See
[`CHANGELOG.md`](CHANGELOG.md) for what's in it,
[`docs/release/RELEASE_NOTES.md`](docs/release/RELEASE_NOTES.md) for a
user-facing description, and
[`docs/release/KNOWN_LIMITATIONS.md`](docs/release/KNOWN_LIMITATIONS.md)
for the single, consolidated list of documented v1.0 limitations.
[`docs/release/README.md`](docs/release/README.md) indexes the full set
of release-governance documents, including deployment
(`docs/release/DEPLOYMENT.md`), versioning
(`docs/release/VERSIONING.md`), and the release checklist
(`docs/release/RELEASE_CHECKLIST.md`). Contributing and security policies
live at [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`SECURITY.md`](SECURITY.md).
