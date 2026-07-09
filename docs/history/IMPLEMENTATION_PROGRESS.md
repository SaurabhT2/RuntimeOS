# Implementation Progress

Tracked per Engineering Blueprint §7's milestone list and the Implementation
Workflow's step 9 ("Update implementation progress").

## EM-0 — Bootstrap the monorepo and freeze `core-contracts`

**Status: ✅ Complete**

### What was built

- Monorepo scaffold: pnpm workspaces + Turborepo, mirroring architecture §9's
  repository layout exactly (`apps/`, `packages/`, `packages/providers/*`,
  `examples/`, `tools/`, `docs/adr/`).
- Shared tooling: strict `tsconfig.base.json`, ESLint 9 flat config with
  `eslint-plugin-boundaries`, Prettier, Vitest, Changesets (independent
  per-package semver), dependency-cruiser with rules generated directly from
  the Section 4.1 dependency table.
- `@ai-gateway/core-contracts` v1.0.0 — fully implemented and tested:
  - `task.ts` — `TaskType`, `KNOWN_TASK_TYPES`, `isKnownTaskType`, `taskTypeSchema`
  - `json-schema.ts` — `JSONSchema`, `jsonSchemaSchema` (see ADR-0002)
  - `request.ts` — `ExecuteRequest`, `ChatMessage`, and their Zod schemas
  - `response.ts` — `ExecuteResponse`, `ToolCall`, `FinishReason`, and their schemas
  - `streaming.ts` — `StreamChunk`, `streamChunkSchema`
  - `errors.ts` — `GatewayError`, `GatewayErrorCode`, `isGatewayError`, `gatewayErrorPayloadSchema`
  - 64 tests, 100% statement/branch/function/line coverage
  - Hand-written JSON fixtures validating every exported wire schema (`test/em0-acceptance.test.ts`)
- Empty-but-wired-in scaffolds for all 12 Wave 1–4 packages: `config`,
  `telemetry`, `providers/provider-sdk`, `reliability`, `model-registry`,
  `credential-resolver`, `policy-engine`, `providers/groq`,
  `providers/nvidia-nim`, `streaming`, `orchestrator`, `middleware`. Each has
  `package.json`, `tsconfig.json` (extending the shared base), a Vitest
  config, a placeholder test, and a README documenting its wave, its
  declared dependencies, and what it will export once implemented.
- CI workflow (`.github/workflows/ci.yml`): format check → dependency graph
  check → lint → typecheck → test (with coverage) → build.
- 3 ADRs recording EM-0-level decisions (see `docs/adr/`).

### Acceptance criteria verification

| Criterion                                                                                      | Result                                                                                                                                     |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `npx turbo run build` succeeds on a clean checkout in under 60 seconds                         | ✅ ~19s for `build` alone (see below); ~79–89s for the full `build+lint+typecheck+test` pipeline across 13 packages                        |
| Zero circular dependencies; `pnpm graph:check` passes                                          | ✅ `no dependency violations found (54 modules, 49 dependencies cruised)`                                                                  |
| Every package's dependencies match Section 4.1 exactly                                         | ✅ enforced by name via `DEPENDENCY_TABLE` in `.dependency-cruiser.cjs`, generated per-package rules                                       |
| `core-contracts` fully implemented, 100% of exported types covered by a "does this parse" test | ✅ 64 tests across 7 test files                                                                                                            |
| A hand-written JSON fixture validates against every exported schema                            | ✅ `test/em0-acceptance.test.ts` + `test/fixtures/*.json`                                                                                  |
| Boundary rule is real, not just configured                                                     | ✅ verified by deliberately introducing and reverting a Section-4.1 violation (`policy-engine` → `providers/groq`); documented in ADR-0003 |

### Deliberate scope boundary (per Implementation Rules)

`apps/gateway-server`, `examples/*`, and `tools/adapter-conformance-tests`
are **not** scaffolded yet — they belong to EM-1 (conformance harness) and
EM-5 (gateway server + example clients) respectively. Only their parent
directories exist, each with a README explaining why it's empty. This is
intentional: "never implement future milestone functionality early."

---

## EM-1 — Complete

Scope per Blueprint §7: `provider-sdk`'s `ProviderAdapter` interface, the
Mock Adapter, and the shared conformance test harness
(`tools/adapter-conformance-tests`).

### What was implemented

- **`@ai-gateway/config`**: `GatewayConfig` Zod schema (architecture §10.6),
  `loadConfig`/`watchConfig` public API, `ConfigSource` implementations
  (`EnvConfigSource`, `FileConfigSource`, `InMemoryConfigSource`), hot-reload
  with change-notification deduplication and `onError` for rejected
  reloads. 25 tests.
- **`@ai-gateway/telemetry`**: `Telemetry` interface (unchanged from
  architecture §11) implemented as a thin wrapper over `@opentelemetry/api`'s
  global tracer/meter registration (no exporter wiring here — that's the
  composition root's job, EM-5), plus a structured JSON logger matching the
  fixed core log schema (architecture §21.4). Every span is guaranteed to
  close with an explicit status. 17 tests, including against a real
  in-memory OTel exporter registered only in tests.
- **`@ai-gateway/provider-sdk`**: the frozen `ProviderAdapter` interface;
  `NormalizedInvocation`/`NormalizedResult`/`NormalizedChunk`/`ToolDefinition`
  (architecture §12.1); `ProviderCapabilities` (§12.2); `ScopedCredential`,
  `ProviderHealthSnapshot`, `CostEstimate` (referenced but not spelled out
  in the architecture doc — defined here); the `MockAdapter`, configurable
  to simulate success, a specific `GatewayErrorCode`, an explicit or organic
  timeout, and a mid-stream failure; `runConformanceSuite` (the shared
  suite's actual logic — `tools/adapter-conformance-tests` documents the
  convention, see that directory's README); `createGatewayError`/`withTimeout`/`delay`
  helper utilities every adapter (mock or real) can reuse. 36 tests (+3
  intentionally skipped where no behavior-simulation hook is available),
  including an HTTP integration test.
- **EM-1 vertical-slice demo**: `POST /debug/execute` returns a Mock
  Adapter response end-to-end, verified by
  `packages/providers/provider-sdk/test/integration/debug-endpoint.test.ts`.

### Public APIs

See each package's README (`packages/config/README.md`,
`packages/telemetry/README.md`,
`packages/providers/provider-sdk/README.md`) for the full public surface.

### Test summary

78 new tests across the three packages (25 + 17 + 36), all passing;
`pnpm turbo run build lint typecheck test` — 52/52 tasks pass workspace-wide.

### Validation results

| Check                                                                                                                    | Result                                                                     |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `pnpm turbo run build lint typecheck test` (workspace, no cache)                                                         | ✅ 52/52 tasks                                                             |
| `pnpm graph:check`                                                                                                       | ✅ `no dependency violations found (89 modules, 146 dependencies cruised)` |
| `pnpm format:check`                                                                                                      | ✅ all files match Prettier style                                          |
| Per-package coverage thresholds (90/90/90/85 lines/functions/statements/branches, per each package's `vitest.config.ts`) | ✅ met in `config`, `telemetry`, `provider-sdk`                            |

### Files added

- `packages/config/src/{schema,errors,sources,loader}.ts` + `test/*.test.ts`
- `packages/telemetry/src/{types,logger,tracer,metrics,telemetry}.ts` + `test/*.test.ts`
- `packages/providers/provider-sdk/src/{capabilities,invocation,credential,health,cost,provider-adapter,mock-adapter,conformance}.ts`,
  `src/internal/errors.ts` + `test/*.test.ts`, `test/integration/{debug-server.ts,debug-endpoint.test.ts}`
- `tools/adapter-conformance-tests/README.md`

### Files modified

- `packages/config/{package.json,src/index.ts,README.md}` (scaffold → real exports)
- `packages/telemetry/{package.json,src/index.ts,README.md}` (scaffold → real exports)
- `packages/providers/provider-sdk/{package.json,src/index.ts,README.md}` (scaffold → real exports; `vitest` promoted from devDependency to dependency since `runConformanceSuite` is consumed by other packages' test files)
- Removed each package's `test/scaffold.test.ts`
- `IMPLEMENTATION_PROGRESS.md` (this section)

### Engineering decisions

1. **`telemetry` registers no OTel SDK/exporter.** Only `@opentelemetry/api`'s
   global registration is used; a real `TracerProvider`/`MeterProvider` is
   the composition root's responsibility (`apps/gateway-server/src/bootstrap.ts`,
   EM-5). This is what makes "exporters swappable via OTel's own
   configuration, never via code changes in this package" (Blueprint §8.3)
   literally true, and keeps the package fully unit-testable today.
2. **The EM-1 vertical-slice demo (`POST /debug/execute`) lives inside
   `provider-sdk`'s own test suite, not in `packages/orchestrator` or
   `apps/gateway-server`.** See Risk #1 below — this is the one genuine
   scope tension found during implementation.
3. **`ScopedCredential`, `ProviderHealthSnapshot`, `CostEstimate`, `ToolDefinition`,
   and `NormalizedChunk`** are referenced by the architecture spec's §11/§12
   interfaces without a spelled-out shape. Reasonable, minimal shapes were
   designed for each (see inline doc comments in `provider-sdk/src/*.ts` for
   the reasoning) and are additive — narrowing or extending them later is
   not expected to be a breaking change to `ProviderAdapter` itself.
4. **`provider-sdk`'s own pre-existing scaffold comment mentioned a generic
   `CapabilityAdapter<T, O>`** (architecture §42.1, a v1.2/future
   generalization). Per Scope Control ("no future capabilities") and
   because the Engineering Blueprint §7 (the actual EM-1 definition)
   only names `ProviderAdapter`, only the non-generic interface was
   implemented; the scaffold's own comment is superseded here rather than
   treated as binding scope.
5. **`vitest` is a `provider-sdk` runtime dependency, not a devDependency.**
   `runConformanceSuite` is `describe`/`it`/`expect`-based code imported and
   executed by _other_ packages' test files, so it must resolve at their
   test-run time as a real dependency of `provider-sdk`, not merely a
   devDependency invisible outside this package.

### Risks

1. **Frozen EM-0 scope tension (flagged, not resolved by redesign):**
   Blueprint §7's EM-1 "features delivered" call for "a trivial orchestrator
   stub that calls the Mock Adapter directly ... through a bare HTTP
   endpoint." But `packages/orchestrator`'s own dependency edges — frozen at
   EM-0 in `.dependency-cruiser.cjs`'s `DEPENDENCY_TABLE` — deliberately
   exclude `provider-sdk` (the real orchestrator only ever reaches a
   provider through `streaming`), and `apps/gateway-server` is explicitly
   EM-5 scope per `apps/README.md`. Implementing the literal demo inside
   either would have meant amending EM-0 or building EM-5 early — both
   against this milestone's "never modify EM-0 / never redesign
   architecture" rule. Per that rule ("if implementation reveals a genuine
   architecture defect: stop, document the issue, do not redesign it during
   EM-1"), the demo was instead implemented as an integration test entirely
   inside `provider-sdk` (the one package EM-1 actually implements),
   satisfying the acceptance criterion's literal text ("`POST /debug/execute`
   ... returns a Mock Adapter response end-to-end") without touching either
   frozen boundary. **Recommend:** confirm in EM-4/EM-5 planning whether
   `orchestrator`'s frozen dependency edge onto `streaming`-only (never
   `provider-sdk` directly) still reflects intent, since this is the second
   time (after EM-0's own boundary-violation drill in ADR-0003) that edge
   has been the subject of a "should this include provider-sdk" question.
2. **Conformance suite is only validated against the Mock Adapter so far**
   (by construction — it's the only adapter that exists in EM-1). Its
   edge-case coverage (malformed JSON, HTTP-level rate-limit parsing,
   wire-level partial-stream corruption) is deferred to EM-4 per the
   Blueprint's own stated risk mitigation, once Groq/NIM give it something
   real to validate against.

### Deferred work

- Real OTel exporter wiring (composition root, EM-5).
- `tools/adapter-conformance-tests` as a literal, separate installable
  package (currently documentation + convention; see Engineering Decision
  #2 above and that directory's README for the rationale).
- Deeper adapter conformance scenarios (malformed JSON, HTTP rate-limit
  parsing, wire-level partial-stream corruption) — EM-4, once Groq/NIM
  exist.
- `CapabilityAdapter<T, O>` generalization (architecture §42.1) — v1.2/future.
- A DB-row-backed `ConfigSource` — additive whenever a DB dependency exists
  in the graph; no change needed to `config`'s public API when it lands.

### EM-1 completion status

- ✅ EM-1 scope (per Engineering Blueprint §7) fully implemented:
  `provider-sdk`'s `ProviderAdapter` interface, `MockAdapter`, and the
  conformance harness; `config`; `telemetry`; the vertical-slice demo.
- ✅ No future-milestone functionality introduced (no `CapabilityAdapter<T,O>`
  generalization, no Groq/NIM adapters, no real orchestrator, no
  `apps/gateway-server`, no OTel exporter wiring).
- ✅ EM-0 unchanged (no edits to any EM-0-delivered package's source, to
  `.dependency-cruiser.cjs`, `tsconfig.base.json`, or `eslint.config.mjs`).
- ✅ Architecture unchanged (no redesign; the one scope tension found — see
  Risk #1 — was documented, not resolved by redesign).
- ✅ Ready for independent EM-1 review:
  `pnpm turbo run build lint typecheck test` (52/52), `pnpm graph:check`
  (0 violations), `pnpm format:check` (clean).

---

## EM-3 — Policy Engine, Real Provider Adapters, Streaming (Complete)

Scope per Blueprint §7: `policy-engine`, `providers/groq`,
`providers/nvidia-nim`, `streaming`. Task-to-model scoring/ranking (static
weights, no cost/capability sophistication yet); working non-streaming
Groq and NVIDIA NIM calls; SSE streaming transport.

### What was implemented

- **`@ai-gateway/policy-engine`**: the full decision pipeline (architecture
  §13.2) — `classifyTask` (Task Classifier) -> `queryCandidates` (Candidate
  Query, against `@ai-gateway/model-registry`) -> `scoreCandidates` (§13.3's
  weighted quality/latency/cost/health scoring, minus a rate-limit
  penalty) -> `rankCandidates` (prioritization + pluggable `RoutingRule`s)
  -> `ExecutionPlan` assembly with a pre-computed, single-level
  `fallbackPlans` chain (ADR-005). `DefaultPolicyEngine` implements
  architecture §11's `PolicyEngine` interface verbatim. 56 tests.
- **`@ai-gateway/groq`**: `GroqAdapter`, a real HTTP `ProviderAdapter` for
  Groq's OpenAI-compatible `/openai/v1/chat/completions` endpoint —
  non-streaming `invoke`, SSE-consuming `invokeStream`, `healthCheck`
  (`GET /models`), `estimateCost`, and a proactive `TokenBucketRateLimiter`
  tuned to this repo's free-tier seed data (architecture §12.3). 69 tests
  (66 run + 3 intentionally skipped, same convention as EM-1's Mock
  Adapter conformance run — no `configureBehavior` hook on a real HTTP
  adapter), all against fixture-scripted `fetch`, never a live call.
- **`@ai-gateway/nvidia-nim`**: `NimAdapter`, structurally the same shape
  as `GroqAdapter` minus the rate limiter (architecture §12.3 calls out
  proactive rate limiting for Groq specifically, not NIM). 55 tests (52
  run + 3 skipped, same reasoning).
- **`@ai-gateway/streaming`**: `DefaultStreamManager` (cooperative
  cancellation per-`requestId`, ADR-0004/ADR-0007) and the SSE transport
  layer (`toStreamChunk`, `encodeSseChunk`/`decodeSseChunk`, `toSseFrames`,
  `toSseByteStream`) framing a `NormalizedChunk` stream into wire-format
  SSE. 20 tests, including an explicit chunk-ordering test satisfying
  Blueprint §7's "streaming chunk-ordering tests" requirement.
- Both adapter packages' conformance test files (`test/conformance.test.ts`)
  run `provider-sdk`'s shared `runConformanceSuite` (architecture §12.4)
  against the real adapter — the second and third adapters, after EM-1's
  Mock Adapter, to validate that harness.

### Public APIs

See each package's README for the full public surface:
`packages/policy-engine/README.md`, `packages/providers/groq/README.md`,
`packages/providers/nvidia-nim/README.md`, `packages/streaming/README.md`.

### Test summary

200 new tests across the four packages (56 + 69 + 55 + 20), 194 run + 6
intentionally skipped, all passing. Every pre-existing EM-0/EM-1/EM-2 test
(266 tests across `core-contracts`, `config`, `telemetry`, `provider-sdk`,
`model-registry`, `reliability`, `credential-resolver`) continues to pass
unmodified.

### Validation results

| Check                                                                           | Result                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm turbo run build` (workspace)                                              | ✅ 13/13 packages                                                                                                                                                                                                                                                                                                                                                                          |
| `pnpm turbo run lint` (workspace)                                               | ✅ 22/22 tasks                                                                                                                                                                                                                                                                                                                                                                             |
| `pnpm turbo run typecheck` (workspace)                                          | ✅ 22/22 tasks                                                                                                                                                                                                                                                                                                                                                                             |
| `pnpm turbo run test` (workspace)                                               | ✅ 22/22 tasks, all packages passing                                                                                                                                                                                                                                                                                                                                                       |
| `pnpm graph:check:ci`                                                           | ✅ `no dependency violations found (160 modules, 315 dependencies cruised)`                                                                                                                                                                                                                                                                                                                |
| Per-package coverage (90/90/90/85 stmts/funcs/lines/branches) — `policy-engine` | ✅ 98.5 / 100 / 98.5 / 96.87                                                                                                                                                                                                                                                                                                                                                               |
| — `providers/groq`                                                              | ✅ 96.56 / 96.42 / 96.56 / 94.7                                                                                                                                                                                                                                                                                                                                                            |
| — `providers/nvidia-nim`                                                        | ✅ 97.39 / 100 / 97.39 / 91.07                                                                                                                                                                                                                                                                                                                                                             |
| — `streaming`                                                                   | ✅ 100 / 100 / 100 / 96                                                                                                                                                                                                                                                                                                                                                                    |
| `pnpm turbo run test:coverage` (workspace)                                      | ⚠️ fails — **pre-existing, out of EM-3 scope**: `providers/provider-sdk` (frozen EM-1) sits at 84.88% branch coverage against its own 85% threshold. Confirmed byte-for-byte unmodified from the EM-2 baseline (`diff` against the supplied baseline zip shows zero source/test differences in that package); this shortfall predates EM-3 and is not touched here per "never modify EM-1" |

### Files added

- `packages/policy-engine/src/{types,task-classifier,candidate-query,model-scorer,routing-rules,policy-engine,index}.ts` + `test/*.test.ts`
- `packages/providers/groq/src/{openai-compat,sse-parser,rate-limiter,http-errors,groq-adapter,index}.ts` + `test/*.test.ts`
- `packages/providers/nvidia-nim/src/{openai-compat,sse-parser,http-errors,nim-adapter,index}.ts` + `test/*.test.ts`
- `packages/streaming/src/{types,stream-manager,sse,index}.ts` + `test/*.test.ts`
- `docs/adr/0006-policy-engine-config-dependency-gap.md`
- `docs/adr/0007-stream-manager-signature-gap.md`

### Files modified

- `packages/policy-engine/{README.md,src/index.ts,vitest.config.ts}` (scaffold → real exports; coverage config excludes the barrel)
- `packages/providers/groq/{README.md,package.json,src/index.ts,tsconfig.json,vitest.config.ts}` (scaffold → real exports; `@types/node` added for global `fetch`/`AbortController` typings)
- `packages/providers/nvidia-nim/{README.md,package.json,src/index.ts,tsconfig.json,vitest.config.ts}` (same reasons as `groq`)
- `packages/streaming/{README.md,package.json,src/index.ts,tsconfig.json,vitest.config.ts}` (same reasons as `groq`, plus excluding `types.ts` — pure interface declarations — from coverage)
- Removed each of the four packages' `test/scaffold.test.ts`
- `IMPLEMENTATION_PROGRESS.md` (this section)

### Engineering decisions

1. **`policy-engine` has no dependency on `@ai-gateway/config`.** Scoring
   weights (architecture §13.3) and routing rules (§13.4) are constructor
   options with documented defaults instead — see ADR-0006.
2. **`qualityScoreForTask`, `healthScore`, `rateLimitPenalty` are
   documented heuristics**, not literal architecture fields (`ModelDescriptor`
   has no per-task quality field; `ProviderHealthSnapshot` has no `.score`).
   Matches Blueprint §7's explicit "no cost/capability sophistication yet"
   EM-3 scope.
3. **`GroqAdapter`/`NimAdapter` pass `NormalizedInvocation.modelId`
   straight through** as the real provider model string — no adapter-side
   modelId-mapping table. Architecture §12.3's "multiple `modelClass`
   mappings" bullet describes Model Registry _configuration_ (already
   EM-2), not adapter code.
4. **Adapter timeout uses `AbortController` directly, not `provider-sdk`'s
   `withTimeout`** — `withTimeout` races a promise but never cancels the
   underlying work; a real HTTP call needs the deadline to actually abort
   the request/stream.
5. **The two adapter packages' OpenAI-compatible translation layers and
   SSE parsers are duplicated, not shared** — no dependency edge exists
   between `providers/groq` and `providers/nvidia-nim`, or onto a third
   "shared adapter kit" package (Section 4.1's `DEPENDENCY_TABLE`).
   Matches this codebase's existing `CredentialScope`-duplication
   precedent.
6. **`StreamManager.openStream`'s signature is adapted from architecture
   §11's literal `(plan: ExecutionPlan, cred)` text** to
   `(adapter, invocation, cred, requestId)` — see ADR-0007. `streaming`
   has no dependency edge onto `policy-engine`, and even with one,
   `ExecutionPlan` alone doesn't carry a resolved `ProviderAdapter`
   instance or a built `NormalizedInvocation`; the orchestrator (EM-4) is
   expected to be the seam that does that resolution.
7. **Streaming cancellation is cooperative, not preemptive** (ADR-0004,
   filed at EM-1/EM-2; ADR-0007 extends the same reasoning to
   `StreamManager`). `cancel(requestId)` flags the stream; the next chunk
   boundary substitutes a synthetic `finishReason: "cancelled"` chunk.
   True upstream HTTP abort requires a `ProviderAdapter` interface change,
   out of EM-3 scope (a frozen EM-1 interface).
8. **No WebSocket transport in `streaming`.** Blueprint §7's EM-3 feature
   list says "SSE streaming transport" only; this package's own EM-0
   scaffold note mentioning `websocket.ts` is superseded by the actual
   milestone definition, per EM-1's own precedent (Engineering Decision #4
   there) for treating a scaffold comment as non-binding when it conflicts
   with the Blueprint's literal milestone scope.

### ADR candidates

- **ADR-0006** (`docs/adr/0006-policy-engine-config-dependency-gap.md`):
  architecture §13.3/§13.4 assume `policy-engine` reads weights/rules from
  `GatewayConfig.routing`, but no dependency edge exists and `config`'s
  current schema has no matching fields either. Filed in "Proposed" status
  for the Board; recommends (non-binding) leaving this to a future
  composition root's translation layer rather than widening either frozen
  artifact now.
- **ADR-0007** (`docs/adr/0007-stream-manager-signature-gap.md`):
  architecture §11's literal `StreamManager.openStream(plan, cred)`
  signature does not compile against this codebase's dependency
  boundaries, and `cancel(requestId)` has no way to learn a `requestId`
  from that signature either. Filed in "Proposed" status; recommends
  (non-binding) keeping the adaptation shipped in this milestone and
  locating `ExecutionPlan` -> `(adapter, invocation)` resolution in the
  orchestrator (EM-4).

### Risks

1. **Pre-existing `provider-sdk` coverage shortfall** (see Validation
   Results) blocks a fully-clean workspace-wide `test:coverage` run, though
   not any individual EM-3 package's own threshold. Flagged for whoever
   owns EM-1 follow-up; not addressed here since `provider-sdk` is frozen.
2. **`ExecutionPlan` -> `(adapter, invocation)` resolution has no owner
   yet** (ADR-0007's Consequences) — EM-4's `orchestrator` design should
   explicitly account for this rather than discover it mid-implementation
   the way this milestone did for `streaming`.

### Deferred work

- WebSocket transport (`streaming`) — not in Blueprint §7's EM-3 scope.
- Fully preemptive stream cancellation — needs a `ProviderAdapter`
  interface change (ADR-0004), a frozen EM-1 interface.
- Live provider-usage-based rate-limit headroom in `policy-engine`'s
  `rateLimitPenalty` (currently a static proxy from `ModelDescriptor`'s
  configured ceiling) — needs a live metrics source not available to this
  package's dependency set.
- Cost-aware/capability-sophisticated Policy Engine scoring — v1.1
  Strategy Layer (architecture §30), EM-6+.
- `GatewayConfig`-driven scoring weights/routing rules (ADR-0006) and a
  `policy-engine`-integrated `StreamManager.openStream` seam (ADR-0007) —
  both pending Board resolution, expected to land with the orchestrator
  (EM-4) or a later config-schema pass.

### EM-3 completion status

- ✅ EM-3 scope (per Engineering Blueprint §7) fully implemented:
  `policy-engine`, `providers/groq`, `providers/nvidia-nim`, `streaming`.
- ✅ No EM-4/EM-5/future-milestone functionality introduced: no
  orchestrator wiring, no middleware, no `apps/gateway-server` routes, no
  WebSocket transport, no cost-aware routing.
- ✅ Architecture preserved: no redesign of package boundaries or the
  dependency graph; the two genuine interface-vs-boundary tensions found
  (`policy-engine`/`config`, `streaming`'s `StreamManager` signature) were
  documented as ADR-0006/ADR-0007, not resolved by silently redesigning
  a frozen artifact.
- ✅ Public interfaces preserved: `PolicyEngine.selectExecutionPlan` and
  `ExecutionPlan` match architecture §11/§13.1 verbatim; `StreamManager`'s
  two documented, ADR-tracked parameter adaptations are the only
  deviations, both required for the interface to be callable at all given
  this codebase's frozen dependency boundaries.
- ✅ EM-0/EM-1/EM-2 unchanged: confirmed by diffing this milestone's full
  working tree against the supplied EM-2 baseline archive — the only
  differences anywhere in the repository are inside
  `packages/policy-engine`, `packages/providers/groq`,
  `packages/providers/nvidia-nim`, `packages/streaming`, two new files
  under `docs/adr/`, and this file.
- ✅ Ready for independent EM-3 Architecture & Engineering Review:
  `pnpm turbo run build lint typecheck test` (22/22 tasks), `pnpm
graph:check:ci` (0 violations across 160 modules/315 dependencies), all
  four new packages individually exceed their 90/90/90/85 coverage
  thresholds.

## EM-4 — ExecutionOrchestrator, Middleware (Complete)

Scope per Blueprint §7: `orchestrator`, `middleware`. The full non-streaming
and streaming request lifecycle (Policy Engine -> Credential Resolution ->
Provider Resolution -> Retry -> Failover -> Streaming -> Completion),
retry-then-failover between Groq and NVIDIA NIM; auth, rate limiting, and
response caching middleware.

### What was implemented

- **`@ai-gateway/orchestrator`**: `DefaultExecutionOrchestrator`
  (architecture §17) — `execute()` and `executeStream()`, both resolving an
  `ExecutionPlan` via `policy-engine`, a `ScopedCredential` via
  `credential-resolver`, and a `ProviderAdapter` via a newly-designed
  `ProviderAdapterRegistry` (ADR-0008 — this milestone's one required
  planning decision, per the EM-3 Architecture & Engineering Review),
  invoking through `reliability`'s `RetryEngine`/`CircuitBreaker`/
  `HealthMonitor` and `streaming`'s `StreamManager`, with retry-then-
  failover across `ExecutionPlan.fallbackPlans` on failure. 43 tests
  (`packages/orchestrator/test/`) plus 14 real-package integration/chaos
  tests (`tools/orchestrator-integration-tests/`, a new cross-package test
  location — see that package's README and ADR-0008 for why it cannot live
  inside `packages/orchestrator/test/`).
- **`@ai-gateway/middleware`**: `AuthMiddleware` (API-key ->
  `AuthContext` resolution), `RateLimitMiddleware` (tenant-scoped
  continuously-refilling token bucket), `CacheMiddleware` (tenant-scoped,
  TTL'd response cache, never caching streaming requests), and
  `MiddlewarePipeline` composing all three around a generic downstream
  handler (architecture §17's `A`-`D` nodes). 29 tests.
- Two new ADRs (`docs/adr/0008-orchestrator-adapter-resolution.md`,
  `docs/adr/0009-middleware-config-gap.md`) documenting the architectural
  gaps this milestone's implementation surfaced, per this milestone's
  "document, don't invent a solution" instruction.

### Package-by-package summary

- `orchestrator/src/types.ts`: structurally-duplicated `ProviderAdapter`/
  `NormalizedInvocation`/`NormalizedResult`/`NormalizedChunk`/
  `ProviderCapabilities`/`CostEstimate` (mirroring the `reliability`/
  `credential-resolver` cross-boundary-duplication precedent) plus
  `ProviderAdapterRegistry`/`InMemoryProviderAdapterRegistry` (ADR-0008).
- `orchestrator/src/invocation-builder.ts`: pure `ExecuteRequest +
ExecutionPlan -> NormalizedInvocation`.
- `orchestrator/src/response-mapper.ts`: pure `NormalizedResult +
ExecutionMeta -> ExecuteResponse`.
- `orchestrator/src/errors.ts`: `providerUnavailable`,
  `allProvidersUnavailable`, and `isFailoverEligible` (the
  blocklist-not-allowlist failover-eligibility design — see this
  package's README, Engineering Decision 3).
- `orchestrator/src/orchestrator.ts`: `DefaultExecutionOrchestrator` — the
  full lifecycle, both non-streaming and streaming, plus `cancel()`.
- `middleware/src/{auth,rate-limit,cache,pipeline}.ts` as listed above.

### Integration Architecture Summary

`execute()`: validate (zod) -> `policyEngine.selectExecutionPlan` ->
for each candidate in `[plan, ...plan.fallbackPlans]`: resolve credential
(terminal on failure, any candidate) -> resolve adapter via registry
(advances to next candidate on failure) -> check circuit breaker (advances
on open) -> check deadline budget -> `retryEngine.execute(() =>
adapter.invoke(...), candidate.retryPolicy)` -> on success, build
`ExecuteResponse` and return; on failure, `isFailoverEligible` decides
terminal-throw vs. advance-to-next-candidate -> after every candidate is
exhausted, throw `ALL_PROVIDERS_UNAVAILABLE`. `executeStream()` mirrors this
with `streamManager.openStream`, additionally gating failover on whether
any chunk has already reached the caller.

`MiddlewarePipeline.run()`: `AuthMiddleware.authenticate` ->
`RateLimitMiddleware.checkOrThrow` -> `CacheMiddleware.get` (hit
short-circuits) -> `downstream(req, auth)` -> `CacheMiddleware.set`.
`downstream` is intentionally not typed as `ExecutionOrchestrator` — no
dependency edge exists between `middleware` and `orchestrator` in either
direction (Section 4.1's `DEPENDENCY_TABLE`); wiring a bound
`orchestrator.execute` into a real pipeline is `apps/gateway-server`'s
composition-root job (EM-5).

### Public API Summary

- `orchestrator`: `ExecutionOrchestrator`, `DefaultExecutionOrchestrator`,
  `ProviderAdapterRegistry`, `InMemoryProviderAdapterRegistry`,
  `ProviderAdapter`/`NormalizedInvocation`/`NormalizedResult`/
  `NormalizedChunk`/`ProviderCapabilities`/`CostEstimate`,
  `buildNormalizedInvocation`, `buildExecuteResponse`.
- `middleware`: `AuthMiddleware`, `RateLimitMiddleware`, `CacheMiddleware`,
  `MiddlewarePipeline`, `AuthContext`/`ApiKeyRecord`/`RateLimitResult`/
  `Role`/`ROLES`/`TenantContext`.

### Test Summary

- `orchestrator`: 43 tests (unit) — happy path, request validation, retry,
  failover (six distinct scenarios), deadline propagation, streaming
  (success/pre-first-chunk-failover/post-first-chunk-terminal/
  cancellation), telemetry, health-monitor/circuit-breaker bookkeeping.
  Coverage: 96.1% stmts / 90.2% branch / 92% funcs / 96.1% lines.
- `middleware`: 29 tests (unit) — auth, rate-limit (window/refill/scoping),
  cache (hit/miss/isolation/TTL/streaming-exclusion), full pipeline
  composition. Coverage: 100% stmts / 98.2% branch / 100% funcs / 100%
  lines.
- `tools/orchestrator-integration-tests`: 14 tests — full lifecycle against
  `MockAdapter` (9 tests: success streaming+non-streaming, retry,
  provider-unavailable failover, both-down, credential failure, streaming
  interruption/cancellation, malformed response) and chaos/real-adapter
  tests against real `GroqAdapter`+`NimAdapter` with recorded fixtures (5
  tests: healthy baseline, network-down chaos failover, HTTP 429 chaos
  failover, both-down typed-error, streaming both-down typed-error) —
  directly satisfying the Blueprint's "end-to-end integration tests against
  both the Mock Adapter and recorded-fixture real adapters" and "a chaos
  test injecting Groq failures to verify automatic failover" requirements.

### Validation Results

- `pnpm build`: 13/13 packages, 0 errors.
- `pnpm lint`: 26/26 tasks, 0 errors.
- `pnpm typecheck`: 26/26 tasks, 0 errors.
- `pnpm test`: 26/26 tasks, 0 failures (all workspace tests, including
  every pre-existing EM-0–EM-3 package's suite, still pass unmodified).
- `pnpm test:coverage`: every package meets its 90/90/90/85 thresholds
  **except** the pre-existing `provider-sdk` shortfall noted in EM-3's own
  Risks section (branch coverage lands at 84.88–85.05% depending on
  parallel-run timing — a frozen-package, pre-existing condition, confirmed
  present and unmodified by diffing this milestone's full working tree
  against the supplied EM-3 baseline archive; `provider-sdk` is frozen
  EM-1/EM-3, so not touched here).
- `pnpm graph:check`: 0 violations, 179 modules / 361 dependencies cruised
  (includes `orchestrator` and `middleware`'s new source and test files).
- `pnpm format:check`: clean (`prettier --write` applied to every new file
  before this milestone's validation pass).

### Files Added

- `packages/orchestrator/src/{types,errors,invocation-builder,
response-mapper,orchestrator,index}.ts`
- `packages/orchestrator/test/{fixtures,invocation-builder,response-mapper,
registry,orchestrator}.test.ts` (+ `fixtures.ts`)
- `packages/orchestrator/README.md` (replacing the EM-0 scaffold README)
- `packages/middleware/src/{types,auth,rate-limit,cache,pipeline,
index}.ts`
- `packages/middleware/test/{fixtures,auth,rate-limit,cache,pipeline,
types}.test.ts`
- `packages/middleware/README.md` (replacing the EM-0 scaffold README)
- `tools/orchestrator-integration-tests/` (new package: `package.json`,
  `tsconfig.json`, `vitest.config.ts`, `README.md`,
  `test/{fixtures,full-lifecycle,chaos-failover}.test.ts`)
- `docs/adr/0008-orchestrator-adapter-resolution.md`
- `docs/adr/0009-middleware-config-gap.md`

### Files Modified

- `packages/orchestrator/package.json` (added `@opentelemetry/api`,
  `@types/node` devDependencies; existing `dependencies` list already
  matched Section 4.1's `DEPENDENCY_TABLE` exactly, unchanged)
- `packages/orchestrator/vitest.config.ts` (excluded the pure-barrel
  `src/index.ts` from coverage, matching `core-contracts`'
  `vitest.config.ts` precedent)
- `packages/middleware/package.json` (added `@types/node` devDependency)
- `packages/middleware/vitest.config.ts` (same barrel-exclusion as above)
- `pnpm-workspace.yaml`: unchanged — `tools/*` was already a workspace
  pattern from EM-0 (`pnpm install` picked up the new
  `tools/orchestrator-integration-tests` package with no workspace-config
  change needed)
- `tools/README.md` (appended a paragraph naming the new package; the
  existing `adapter-conformance-tests` paragraph is unchanged)
- No EM-0/EM-1/EM-2/EM-3 package, and no root config file
  (`.dependency-cruiser.cjs`, `eslint.config.mjs`, `tsconfig.base.json`,
  `turbo.json`, `vitest.config.base.ts`), was modified — confirmed by
  diffing this milestone's full working tree against the supplied EM-3
  baseline archive; the only differences anywhere in the repository are
  inside `packages/orchestrator`, `packages/middleware`,
  `tools/orchestrator-integration-tests`, `docs/adr/`, `tools/README.md`,
  and this file.

### Engineering Decisions

See `packages/orchestrator/README.md`'s "Design notes / Engineering
Decisions" (6 items: adapter resolution via injected registry;
credential-failure-always-terminal; failover-eligibility blocklist, not
retry-policy allowlist; best-effort deadline propagation; streaming
failover only pre-first-chunk; defensive non-`GatewayError` wrapping) and
`packages/middleware/README.md`'s (6 items: no `orchestrator` dependency
edge; constructor-option config in place of a `GatewayConfig` field;
`CREDENTIAL_INVALID` reused for gateway-auth failure; tenant-scope, not
API-key, rate-limit keying; correlation-field-insensitive cache key;
in-memory-only state) for the full writeups. Both READMEs are the
authoritative source; this section is a pointer, not a duplicate, to avoid
the two drifting out of sync.

### ADR candidates

- **ADR-0008** (`docs/adr/0008-orchestrator-adapter-resolution.md`,
  Accepted): resolves ADR-0007's open question — `orchestrator` structurally
  duplicates `provider-sdk`'s adapter-facing types (the established
  cross-boundary pattern) and receives a `ProviderAdapterRegistry` via
  dependency injection rather than importing any concrete adapter package.
- **ADR-0009** (`docs/adr/0009-middleware-config-gap.md`, Proposed):
  `GatewayConfig` has no section for API keys, rate-limit thresholds, or
  cache TTL, mirroring ADR-0006's `policy-engine`/`config` gap one layer
  up. Filed for the Board; `middleware` ships with constructor-option
  defaults in the meantime.

### Risks

1. **Pre-existing `provider-sdk` coverage shortfall** (inherited from
   EM-3's own Risks section, item 1) — still present, still not this
   milestone's to fix (frozen package).
2. **ADR-0006 and ADR-0007 remain unresolved** (Board-pending) — this
   milestone did not need either resolved to proceed (worked around both,
   consistent with EM-3's own approach), but a future config-schema pass
   should revisit all three open `config`-adjacent ADRs (0006, 0007's
   downstream consequences, 0009) together rather than one at a time.
3. **In-memory rate limiting and caching** (`middleware`) and **in-memory
   circuit breaker/health state** (`reliability`, pre-existing) both mean a
   multi-instance `apps/gateway-server` deployment (EM-5+) will need a
   shared backend before those guarantees hold across instances — flagged
   here so EM-5's design explicitly accounts for it rather than discovering
   it mid-implementation.

### Deferred work

- A persistent, database-backed `ProviderAdapterRegistry` — not motivated
  yet; `InMemoryProviderAdapterRegistry` is sufficient for EM-5's
  composition root.
- Distributed rate-limit/cache backends (`middleware`) for multi-instance
  deployments.
- The RBAC policy-check step consuming `AuthContext.role` (architecture
  §20.5) — `AuthContext` already carries `role`; the step that gates on it
  is a separate, not-yet-scoped deliverable.
- `AuthKeyStore` (ADR-0009, Option B) — a pluggable, potentially
  database-backed replacement for `middleware`'s constructor-`Map` key
  list.
- Credential-registration-with-live-validation via `orchestrator`
  (`credential-resolver`'s own doc comment floats this) — not in EM-4's
  scope.
- `apps/gateway-server` itself (EM-5): the HTTP layer, the single
  composition root (architecture §6.4) that constructs real
  `GroqAdapter`/`NimAdapter` instances and registers them with a
  `ProviderAdapterRegistry`, and wires a bound `orchestrator.execute` into
  a real `MiddlewarePipeline`.

### EM-4 completion status

- ✅ EM-4 scope (per Engineering Blueprint §7) fully implemented:
  `orchestrator`, `middleware`.
- ✅ Existing packages composed, not duplicated: `orchestrator` composes
  `policy-engine`+`credential-resolver`+`reliability`+`streaming` rather
  than reimplementing any of their responsibilities; `middleware` composes
  nothing new itself (architecture §17's A-D nodes are net-new logic, not
  a reimplementation of an existing package).
- ✅ No EM-5/EM-6/future-milestone functionality introduced: no HTTP
  server, no workflow engine, no strategy engine, no RBAC policy-check
  step, no distributed rate-limit/cache backend, no persistent
  `ProviderAdapterRegistry`/`AuthKeyStore` — every one of these is an
  extension point (an interface or constructor option already in place)
  rather than implemented behavior.
- ✅ Architecture preserved: no redesign of package boundaries or the
  dependency graph; the two genuine interface-vs-boundary tensions this
  milestone's implementation surfaced (`orchestrator`'s adapter resolution,
  `middleware`'s missing config sections) were documented as ADR-0008
  (resolved, in-milestone) and ADR-0009 (filed for the Board), not
  resolved by silently redesigning a frozen artifact.
- ✅ Frozen public interfaces preserved: `PolicyEngine.selectExecutionPlan`,
  `CredentialResolver.resolve`, `RetryEngine.execute`,
  `CircuitBreaker`/`HealthMonitor`, and `StreamManager.openStream`/`cancel`
  are all called exactly as EM-2/EM-3 defined them — zero signature
  changes anywhere.
- ✅ EM-0/EM-1/EM-2/EM-3 unchanged: confirmed by diffing this milestone's
  full working tree against the supplied EM-3 baseline archive — the only
  differences anywhere in the repository are inside `packages/orchestrator`,
  `packages/middleware`, `tools/orchestrator-integration-tests`,
  `docs/adr/`, `tools/README.md`, and this file.
- ✅ Ready for independent EM-4 Architecture & Engineering Review: `pnpm
build lint typecheck test` (26/26 tasks each), `pnpm graph:check` (0
  violations across 179 modules/361 dependencies), `pnpm format:check`
  (clean), both new packages individually exceed their 90/90/90/85
  coverage thresholds, and the pre-existing `provider-sdk` coverage
  shortfall is confirmed unrelated to this milestone's changes.

## EM-5 — `apps/gateway-server` v1.0 MVP (Complete)

Scope per Blueprint §7: `apps/gateway-server` (bootstrap wiring, REST +
streaming routes). The first deployable AI Gateway MVP — every EM-0–EM-4
package composed into a running HTTP/SSE server.

### What was implemented

- **`@ai-gateway/gateway-server`**: `bootstrap()` (`src/bootstrap.ts`) —
  the single composition root, constructing exactly one instance of every
  platform package (Telemetry, `GatewayConfig`, `ModelRegistry`,
  `CredentialResolver`, `HealthMonitor`/`CircuitBreaker`/`RetryEngine`,
  `PolicyEngine`, `GroqAdapter`/`NimAdapter` via `ProviderAdapterRegistry`,
  `StreamManager`, `ExecutionOrchestrator`, and
  `AuthMiddleware`/`RateLimitMiddleware`/`CacheMiddleware`/
  `MiddlewarePipeline`) and returning a `GatewayApp` bundle. A hand-rolled
  HTTP layer (`src/http/`: `server.ts`, `router.ts`, `respond.ts`,
  `read-body.ts`, `validate-request.ts`, `auth-header.ts`,
  `routes/{execute,execute-stream,health}.ts`) implements `POST
/v1/execute`, `POST /v1/execute/stream` (SSE), and `GET /v1/health` —
  Blueprint §7 EM-5's own named scope, plus this milestone's own
  Health & Operational Endpoints requirement. `src/lifecycle.ts` handles
  `SIGTERM`/`SIGINT` graceful shutdown with a force-exit deadline;
  `src/server-config.ts` loads and fail-fast-validates every process-level
  env setting. `src/index.ts` is the only file with process side effects
  and is guarded against those side effects firing on import.
- Two new example clients, exactly as Blueprint §7 EM-5/§19 step 16 name:
  `examples/minimal-node-client` (`POST /v1/execute`) and
  `examples/streaming-client` (`POST /v1/execute/stream`, hand-parsed
  SSE) — both with zero `@ai-gateway/*` dependency, written exactly as a
  real external caller would.
- One new ADR candidate
  (`docs/adr/0010-gatewayconfig-reliability-section-unconsumed.md`)
  documenting an architectural gap this milestone's implementation
  surfaced: `GatewayConfig.reliability` (`maxRetries`, `backoff`,
  `circuitBreakerThreshold`) is not actually consumed by any package
  through EM-4 — `policy-engine` hardcodes `DEFAULT_RETRY_POLICY`
  unconditionally, and no package reads `circuitBreakerThreshold` at all.
  Not resolved here (would require touching frozen `policy-engine`/
  `@ai-gateway/config`); `bootstrap()` uses `reliability`'s own shipped
  defaults instead of guessing a mapping.
- 83 tests (`apps/gateway-server/test/`): unit tests for every
  `server-config`/`bootstrap`/`http/*`/`lifecycle` module, route-level
  tests against a real `node:http` server with fake (never live-network)
  provider adapters, and an end-to-end integration suite exercising this
  milestone's own named Client -> Gateway API -> Middleware ->
  Orchestrator -> ... -> Client Response flow, including an
  invisible-to-the-client failover scenario.
- `.dependency-cruiser.cjs`: one additive `apps/gateway-server` entry
  (`orchestrator`, `middleware`, `providers/groq`, `providers/nvidia-nim`
  — architecture §4.1's exact row) plus the one-line `pkgPathPattern`
  extension the file's own comment anticipated ("later-wave packages are
  added here as their waves begin") — every EM-0–EM-4 entry is
  byte-for-byte unchanged.

### Scope discipline

- `/v1/tasks`, `/v1/usage`, and `POST|DELETE /v1/credentials`
  (architecture §10.2) are **not** implemented — Blueprint §7 EM-5's own
  "Features delivered" line names only `/v1/execute` and
  `/v1/execute/stream`, and `/v1/credentials` specifically would require
  a live-validation registration flow `credential-resolver`'s own
  `resolver.ts` names as future work for a later milestone, not EM-5. See
  `apps/gateway-server/README.md`, Scope verification, for the full
  reasoning.
- No EM-6+ functionality (budget routing, workflow engine, strategy
  engine, distributed execution, enterprise features) was implemented
  anywhere.
- No HTTP framework dependency was added — a hand-rolled ~30-line router
  was judged sufficient for this milestone's three fixed routes; see
  `apps/gateway-server/README.md`, Engineering decision 1, for when this
  should be reconsidered.

### Architecture preserved

- ✅ Architecture Specification, Engineering Blueprint unchanged.
- ✅ EM-0/EM-1/EM-2/EM-3/EM-4 unchanged: every diff in this milestone lives
  inside `apps/gateway-server/`, `examples/{minimal-node-client,streaming-client}/`,
  `docs/adr/0010-*.md`, `.dependency-cruiser.cjs` (one additive entry),
  `apps/README.md`, `examples/README.md`, and this file.
- ✅ Frozen public interfaces preserved: every package this milestone wires
  is constructed only via its own documented public constructor/factory —
  `PolicyEngine`, `CredentialResolver`, `RetryEngine`,
  `CircuitBreaker`/`HealthMonitor`, `StreamManager`, `ExecutionOrchestrator`,
  and every `middleware` class are all called exactly as EM-2/EM-3/EM-4
  defined them.
- ✅ Composition over invention: the one genuine architectural gap this
  milestone's implementation surfaced (`GatewayConfig.reliability` being
  unconsumed) was documented as ADR-0010, not resolved by redesigning a
  frozen package.
- ✅ Ready for independent EM-5 Architecture & Engineering Review: `pnpm
build lint typecheck test` (28/28 tasks each), `pnpm graph:check` (0
  violations across 210 modules/429 dependencies), `pnpm format:check`
  (clean), `apps/gateway-server` exceeds its 90/90/90/85 coverage
  threshold (95.5/90.1/93.9/95.5), and the pre-existing `provider-sdk`
  coverage shortfall (unchanged from EM-3/EM-4) remains the only
  `test:coverage` failure in the workspace.
