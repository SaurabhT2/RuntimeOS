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

> **Documentation note (added during the v1.2 documentation-excellence
> pass, not at original authoring time):** there is no standalone
> `## EM-2` section in this document — the numbering goes directly from
> `EM-1` (above) to `EM-3` (below). `CHANGELOG.md`'s milestone table
> attributes `reliability`, `model-registry`, and `credential-resolver`
> to "EM-2," and EM-3's own scope line below explicitly does **not**
> include `model-registry` or `credential-resolver` — so those two
> packages were almost certainly delivered in a milestone between EM-1
> and EM-3 that was simply never given its own write-up here, rather
> than in EM-3 itself. This has no effect on the implementation (all
> three packages are complete and tested regardless of which milestone
> number they're attributed to) — it is a gap in this historical record
> only. Flagged here rather than silently invented, per this document's
> own convention of recording findings rather than guessing at them; see
> `README.md`'s "Engineering milestones" table (footnote) for the
> parallel, reader-facing version of this same note.

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

## EM-5.5 — Vercel Deployment Architecture & Implementation (Complete)

Scope: a Vercel deployment target for the v1.0 MVP, per
`docs/Hosting-architecture/EM-5.5-vercel-deployment-architecture-review.md`
(the approved architecture document driving this milestone) and
ADR-0011/ADR-0012. Unlike EM-0–EM-5/EM-6, this milestone's unit of work is
a deployment target, not a new platform capability — no `ExecuteRequest`,
`GatewayError`, or platform-package behavior changes.

### What was implemented

- **Architecture review** (`docs/Hosting-architecture/EM-5.5-vercel-deployment-architecture-review.md`):
  established that the incompatibility between the existing composition
  root and Vercel's Functions runtime is a process-lifecycle contract
  mismatch (own `createServer()`/`.listen()`, `SIGTERM`/`SIGINT` handling)
  isolated to three files, not a business-logic gap — every `packages/*`
  module was already transport-agnostic. Recorded as Findings 1–5, with
  Findings 4–5 (in-memory state under multi-instance execution; streaming
  duration limits under FaaS) carried forward as accepted, tracked risks
  rather than blockers.
- **`apps/vercel-adapter`**: a second, additive composition root/deployable
  app targeting Vercel's Node.js Functions runtime (`api/v1/[...path].ts`,
  `runtime.ts` — lazy per-warm-instance bootstrap, `vercel-config.ts`).
  `apps/gateway-server` required zero changes to ship this
  (`docs/Hosting-architecture/...`, §10's own impact analysis: "None").
- **`packages/gateway-runtime`** (`@ai-gateway/gateway-runtime`): the
  shared composition-root/HTTP-plumbing package both apps depend on —
  `bootstrap()`, `GatewayApp`, `Router`, `buildGatewayRouter`/
  `dispatchGatewayRequest`, the request-parsing/validation/response-shaping
  helpers, and the three route handlers (`handleExecute`,
  `handleExecuteStream`, `handleHealth`), plus a shared test harness
  (fakes, `startTestDispatchServer`) both apps' suites use. `.dependency-cruiser.cjs`
  gained the corresponding entries: `gateway-runtime` depends on the same
  platform packages `apps/gateway-server` already did; `apps/gateway-server`
  and `apps/vercel-adapter` both depend on `gateway-runtime` (an ordinary
  `app` → `package` edge) rather than on each other.
- **Two ADRs**, one superseding the other, documenting a mid-milestone
  correction rather than a single decision:
  - `docs/adr/0011-vercel-adapter-app-boundary-duplication.md`
    (Superseded) — the original decision to accept ~450 lines of
    duplicated HTTP-layer code between the two apps, reasoning (incorrectly,
    as ADR-0012 explains) that the codebase's `app` → `app` isolation
    boundary made a shared package unavailable for this.
  - `docs/adr/0012-shared-gateway-runtime-package.md` (Accepted) — the
    correction: relocating already-concrete, already-hosting-agnostic code
    into `packages/gateway-runtime` is an ordinary `app` → `package` edge,
    which the isolation boundary never restricted, and is not the
    "generic hosting-adapter abstraction" (architecture review §6, Option
    C) that was and remains rejected. `docs/Hosting-architecture/EM-5.5-vercel-deployment-architecture-review.md`'s
    own Revision History (Revision 2) records the same correction at the
    architecture-document level.
- Test suites for both new packages (`packages/gateway-runtime/test/`,
  `apps/vercel-adapter/test/`), each including an integration suite
  exercising the same Client → Gateway API → Middleware → Orchestrator →
  ... → Client Response scenarios `apps/gateway-server`'s own EM-5 suite
  established, so a future behavioral divergence between the two hosting
  targets fails a test rather than surfacing only in review.
- `docs/release/DEPLOYMENT-VERCEL.md` (new): deployment instructions for
  the Vercel target, explicitly naming Finding 4's in-memory-state caveat
  rather than presenting it as a fully-equivalent replacement for the
  existing container/VM deployment path.

### Scope discipline

- `apps/gateway-server` is untouched at the business-logic level; its
  `http/server.ts` was narrowed to a thin wrapper over
  `buildGatewayRouter`/`dispatchGatewayRequest` as part of the same
  extraction that created `gateway-runtime` — not a separate, unscoped
  change.
- The architecture review's Option C (a generic hosting-adapter interface
  inside `packages/*`) was considered and rejected, both in the review
  document and again during ADR-0012's correction of ADR-0011; no such
  abstraction exists anywhere in this milestone's implementation.
- Findings 4 and 5 (in-memory state; streaming duration under FaaS) were
  deliberately not resolved here — resolving Finding 4 would mean wiring
  the architecture's own §23 shared-store design, an explicitly
  out-of-scope, larger cross-package change; both are recorded as accepted,
  tracked risks in the architecture review and in `docs/release/DEPLOYMENT-VERCEL.md`,
  not silently absorbed.

### Architecture preserved

- ✅ Architecture Specification, Engineering Blueprint unchanged (this
  milestone's own governing document is the separate Hosting-architecture
  review, not a revision to either).
- ✅ EM-0–EM-5 unchanged: every diff in this milestone lives inside
  `apps/vercel-adapter/`, `packages/gateway-runtime/`,
  `docs/Hosting-architecture/`, `docs/adr/0011-*.md`, `docs/adr/0012-*.md`,
  `docs/release/DEPLOYMENT-VERCEL.md`, `.dependency-cruiser.cjs` (additive
  entries only), and this file.
- ✅ No new interface/abstraction introduced beyond the relocation
  ADR-0012 describes — the same conclusion the architecture review's own
  Revision 2 reaches about its own recommendation.
- ✅ Two composition roots is an accepted, named trade-off (architecture
  review §8), not an oversight.

## EM-6 — Strategy Layer Foundation: Capability Registry, Execution Profile Registry, Runtime Profiles (Complete)

Scope per Blueprint §7: three new, independent Wave 6 packages —
`capability-registry` (architecture §32), `execution-profile-registry`
(architecture §31), `runtime-profiles` (architecture §37) — establishing
the complete foundation for the Strategy Layer while keeping the existing
Orchestrator, Policy Engine, and every EM-0–EM-5.5 package byte-for-byte
unchanged. None of the three is wired into `orchestrator` or
`policy-engine` yet — that wiring is `strategy-layer`'s job (Wave 8, EM-8,
architecture §30.2), matching Blueprint §7's explicit EM-6 scope boundary.

### What was implemented

- **`@ai-gateway/capability-registry`**: `CapabilityRegistry` interface —
  `resolveCapabilities(task, req?)`, `registerMapping(task, capabilities)`
  (architecture §32.2, verbatim) — with `DefaultCapabilityRegistry`, a
  TTL-cached read layer in front of a swappable `CapabilityStore`
  (in-memory implementation shipped). `CapabilitySet` schema whose
  `reasoningDepth` reuses `@ai-gateway/model-registry`'s
  `REASONING_DEPTHS` constant directly, and whose cache reuses that
  package's real `TtlCache` class (both concrete expressions of Blueprint
  §8.14's "read-only, for cross-checking capability vocabulary"
  dependency). `SEED_CAPABILITIES`: one designed mapping per
  `core-contracts`' `KNOWN_TASK_TYPES` entry. Request-level constraint
  folding (`requiredSchema` → forces `structuredOutput`;
  `minContextTokens` → raises, never lowers; `streaming` → overrides in
  either direction). `CapabilityResolutionError` on an unmapped task
  (never-silent-failure, architecture §19.3). 26 tests, 99.32% statement
  coverage.
- **`@ai-gateway/execution-profile-registry`**: `ExecutionProfileRegistry`
  interface — `resolveProfile(task, overrideProfileId?)`,
  `getProfileById(profileId)`, `upsertProfile(profile)`,
  `registerTaskMapping(task, profileId)` — with
  `DefaultExecutionProfileRegistry` and
  `createSeededExecutionProfileRegistry()`. `ExecutionProfile`/
  `ResolvedExecutionProfile`/`executionProfileSchema` (architecture §31.2,
  verbatim); the latter type is exported now for `strategy-layer` (EM-8)
  to consume, but nothing in this package produces one — the Runtime
  Profile merge is explicitly `strategy-layer`'s job per architecture
  §31.4's own sequence diagram. `SEED_EXECUTION_PROFILES`: architecture
  §31.3's eight illustrative profiles, plus `TASK_TO_EXECUTION_PROFILE_ID`
  mapping the two deliberately-distinct vocabularies (`TaskType` vs.
  `ExecutionProfileId`). Local, documented duplicates of
  `@ai-gateway/model-registry`'s `TtlCache` and `@ai-gateway/reliability`'s
  `RetryPolicy`/`DEFAULT_RETRY_POLICY` (this package's frozen dependency
  edge — `config`, `core-contracts` — excludes both packages; duplicating
  rather than adding an edge follows the precedent
  `@ai-gateway/reliability`'s own `ProviderHealthSnapshot` already set).
  `ExecutionProfileResolutionError` on an unmapped task or unknown override
  id. 38 tests, 99.64% statement coverage.
- **`@ai-gateway/runtime-profiles`**: `RuntimeProfileRegistry` interface —
  `getActiveRuntimeProfile(tenant)`, `setTenantRuntimeProfile(tenant,
profileId)` (the admin-API-writable override architecture §37.4
  describes), `upsertProfile(profile)` — with
  `DefaultRuntimeProfileRegistry` resolving, in order: an explicit
  per-tenant assignment, a configured deployment-wide default
  (`deploymentDefaultProfileId`, meant to be sourced from the new
  `GatewayConfig.runtimeProfileId`), then `"production"`.
  `RuntimeProfile`/`RuntimeProfileId`/`runtimeProfileSchema` (architecture
  §37.2, verbatim); `SEED_RUNTIME_PROFILES`: the six named presets
  (architecture §37.3), with designed-not-specified concrete numbers for
  the fields the table only describes qualitatively. Local, documented
  duplicates of `TtlCache` (same rationale as above, a fourth occupant of
  the pattern) and of architecture §35.1's `ModelLifecycleState` (needed
  for `allowedLifecycleStates`; `model-registry`'s `ModelDescriptor`
  doesn't have a `lifecycle` field yet — out of this milestone's scope,
  documented in the package's own source comments). A local `TenantRef`
  type (org + optional workspace), used instead of `core-contracts`'
  `ExecuteRequest.tenant` for the same frozen-dependency-edge reason.
  `RuntimeProfileResolutionError` on an unregistered id. 41 tests, 99.58%
  statement coverage.
- **`ADR-0013`**
  (`docs/adr/0013-gatewayconfig-runtime-profile-id-field.md`): the one
  change to an already-shipped package this milestone makes, per
  architecture §37.4's own explicit instruction — `GatewayConfig`
  (`@ai-gateway/config`, EM-1) gains an optional `runtimeProfileId?:
string` field. Strictly additive (every pre-EM-6 config remains valid
  unchanged) and typed as a plain `string`, not `runtime-profiles`' own
  `RuntimeProfileId` union, to avoid a dependency cycle (`runtime-profiles`
  already depends on `config`). Config's own tests, README, and a
  changeset (`.changeset/em6-gatewayconfig-runtime-profile-id.md`) were
  updated accordingly.
- **`tools/em6-strategy-foundation-demo`**: Blueprint §7's EM-6
  "demonstrable outcome" — "a CLI script resolving `task: 'summarization'`
  to a capability set and an execution profile, printed side by side — no
  live traffic affected yet" — committed as a permanent, CI-run regression
  test (the same choice `tools/orchestrator-integration-tests` and
  `tools/adapter-conformance-tests` already made), rather than a
  throwaway hand-run script. Lives in `tools/`, not inside any one of the
  three packages, because no single package is allowed to depend on all
  three at once (Blueprint §4.1's `DEPENDENCY_TABLE`). Also demonstrates
  architecture §37.1's central claim directly: the same task resolves a
  different Runtime Profile posture for two different tenants, with zero
  application-level change. 3 tests.
- `.dependency-cruiser.cjs`: three additive `DEPENDENCY_TABLE` entries
  matching Blueprint §4.1 exactly (`capability-registry` → `model-registry`,
  `core-contracts`; `execution-profile-registry` → `config`,
  `core-contracts`; `runtime-profiles` → `config`) — every EM-0–EM-5.5
  entry is byte-for-byte unchanged.

### Scope discipline

- No wiring into `orchestrator`, `policy-engine`, or any live request
  path anywhere — Blueprint §7's EM-6 scope, and this milestone's own
  instruction, is explicit that this is foundation-only. The
  `tools/em6-strategy-foundation-demo` suite exists specifically to prove
  this: it constructs and exercises all three registries directly, never
  touching `orchestrator`.
- `ModelDescriptor.lifecycle` (architecture §35) was **not** added to
  `model-registry` — the architecture spec's own roadmap addendum
  (Milestone 9) bundles that field-add with a Policy Engine change, but
  Blueprint §7's EM-6 names only `capability-registry`,
  `execution-profile-registry`, `runtime-profiles`. `runtime-profiles`'
  `allowedLifecycleStates` field exists in the schema today exactly as
  §37.2 specifies; it has a local, documented `ModelLifecycleState` type
  copy and no consumer yet, pending a future milestone's Policy Engine
  change.
- None of architecture §37.4's four Runtime Profile read sites (Execution
  Profile Registry, Cost Optimizer, Policy Engine's Candidate Query, Retry
  Engine/Circuit Breaker) were wired up — shipping the registry itself,
  with no consumer, is this milestone's explicit scope.
- No new abstractions beyond what architecture §31/§32/§37 specify: every
  public type/interface traces directly to one of those three sections;
  every local duplication (`TtlCache`, `RetryPolicy`, `ModelLifecycleState`,
  `TenantRef`) is a copy of an existing, already-specified shape, not a
  new design.

### Architecture preserved

- ✅ Architecture Specification, Engineering Blueprint unchanged.
- ✅ EM-0 through EM-5.5 unchanged: every diff in this milestone lives
  inside `packages/{capability-registry,execution-profile-registry,
runtime-profiles}/`, `packages/config/{src/schema.ts,README.md,
test/schema.test.ts}`, `tools/em6-strategy-foundation-demo/`,
  `tools/README.md`, `docs/adr/0013-*.md`, `docs/adr/README.md`,
  `.dependency-cruiser.cjs` (three additive entries),
  `.changeset/em6-gatewayconfig-runtime-profile-id.md`, `README.md`, and
  this file.
- ✅ Frozen public interfaces preserved: `GatewayConfig`'s change is
  additive-only (ADR-0013) and every other EM-0–EM-5.5 package's public
  interface is untouched.
- ✅ Composition over invention: every genuine cross-package constraint
  this milestone's implementation surfaced (the `RetryPolicy`/`TtlCache`
  duplications, the missing `ModelDescriptor.lifecycle` field, the
  task/profile-id vocabulary mismatch) was resolved by following an
  already-established precedent in this codebase (documented in each
  package's own source/README) rather than by redesigning a frozen
  package or inventing a new cross-package abstraction.
- ✅ Ready for independent EM-6 Architecture & Engineering Review: `pnpm
build lint typecheck test` (82/82 tasks), `pnpm graph:check` (0
  violations across 268 modules/550 dependencies), `pnpm format:check`
  (clean for every file this milestone touched), `capability-registry`
  (99.32%/96.96%/93.33%/99.32%), `execution-profile-registry`
  (99.64%/97.95%/95.65%/99.64%), and `runtime-profiles`
  (99.58%/98%/96%/99.58%) all comfortably exceed the 90/90/90/85
  coverage threshold.

## EM-7 — Optimization Pipeline & Plugin System Foundation: Cost Optimizer, Prompt Optimizer, Learning Extension Points, Plugin System (Complete)

Scope: four independent, non-integrated foundation packages named in
Blueprint §7 EM-7 / §8.17 / §8.18 and architecture §33 (Cost Optimizer),
§34 (Prompt Optimizer), §36 (Intelligent Learning extension points), and
§11 (Gateway Plugin framework). Same shape of milestone as EM-6: these
packages produce decisions/transformations/extension points only — none is
wired into `orchestrator`, `policy-engine`, or either running app
(`apps/gateway-server`, `apps/vercel-adapter`). That integration is EM-8's
job.

### What was implemented

- **`packages/cost-optimizer`** (`@ai-gateway/cost-optimizer`): the
  `CostOptimizer` interface and `DefaultCostOptimizer` implementation
  (architecture §33.2), producing `recommendedModelClassDowngrade`,
  `reasoningRequired`, `disableStreaming`, `cacheHit`,
  `preferFreeTierProviders`, `estimatedCostUsd`, and `estimatedSavingsUsd`
  from an `OptimizationContext`. Downgrade recommendation logic
  (`downgrade.ts`) never overrides a hard `reasoningDepth: "deep"`
  requirement (architecture §33.3's `DECIDE` node guarantee). Cache
  recommendation is a real `CacheClient.lookup` call (`in-memory-cache-client.ts`
  ships a test/demo-grade implementation). Streaming recommendation
  (`streaming.ts`) and free-tier preference (read straight from the active
  Runtime Profile) round out the six architecture §33.2 table rows this
  milestone implements — batching is explicitly out of scope, per that
  same table.
- **`packages/prompt-optimizer`** (`@ai-gateway/prompt-optimizer`): the
  `PromptOptimizer` interface and `DefaultPromptOptimizer` implementation
  (architecture §34.2), orchestrating the six named transformers
  (`normalized`, `system_prompt_deduped`, `duplicates_removed`,
  `context_trimmed`, `long_context_windowed`, `compressed` —
  `transformers/*.ts`, each independently testable and each a pure,
  stateless function of `(messages, budget)`) in the architecture §34.3
  table's order. `compressed` is excluded for the `coding`/`json_generation`
  profiles, exactly as documented, enforced at the orchestration level
  (`EXACT_WORDING_PROFILE_IDS` in `prompt-optimizer.ts`) since
  `PromptTransformer.apply` never receives a profile. `estimateTokens`
  (`token-estimator.ts`) is the provider-agnostic ~4-chars-per-token
  heuristic architecture §34.4 calls for.
- **`packages/learning`** (`@ai-gateway/learning`): `ExecutionOutcome`,
  `LearningSignalCollector`/`NoopLearningSignalCollector`, and
  `AdaptiveRankingStrategy`/`NoopAdaptiveRankingStrategy` (architecture
  §36.2), plus a `LearningRegistry`/`DefaultLearningRegistry` registration
  mechanism (Blueprint §7's named deliverable, not itself specified by
  §36.2's code block). No adaptive learning logic exists anywhere in this
  package — sockets only, exactly as scoped.
- **`packages/plugin-system`** (`@ai-gateway/plugin-system`): the
  `GatewayPlugin` contract (architecture §11, verbatim), `PluginHost`
  (registration with validation, lifecycle tracking, and per-plugin-isolated
  hook execution), `discoverPlugins`/`loadPlugins` (discovery + loading,
  each isolating a single bad source/plugin from the rest), and
  `createPassthroughLoggingPlugin` (the trivial example plugin Blueprint §7
  names as a deliverable). Not integrated into `orchestrator`, per that
  same Blueprint line.
- Package READMEs for all four (`packages/{cost-optimizer,prompt-optimizer,
learning,plugin-system}/README.md`).

### Two documented, flagged deviations from Blueprint §4.1's literal dependency table

Both resolved the same way EM-6 resolved its own architecture-spec-vs-
Blueprint tension (the §31.4/§37.2 field-naming inconsistency): followed
the more specific, directly-binding source (a frozen interface signature)
over the summary table, and flagged the deviation explicitly rather than
silently absorbing it or breaking the interface.

1. **`prompt-optimizer` additionally depends on `execution-profile-registry`.**
   Blueprint §4.1's table lists only `capability-registry`, `core-contracts`
   for this package, but architecture §34.2's frozen `PromptOptimizer.optimize`
   signature takes a `profile: ResolvedExecutionProfile` parameter — that
   package's own exported type. Implementing §34.2 verbatim is impossible
   without the edge. See `packages/prompt-optimizer/README.md` and that
   package's `src/prompt-optimizer.ts` doc comment; `.dependency-cruiser.cjs`
   updated identically, with its own comment explaining the same thing.
2. **`plugin-system`'s `onProviderRegistered` hook takes a narrowed local
   `RegisteredProviderAdapter` type, not `provider-sdk`'s real
   `ProviderAdapter`.** Architecture §11's own code block types that
   parameter as the real `ProviderAdapter`, but Blueprint §4.1's table lists
   only `core-contracts` for this package's dependencies — and this
   milestone's scope never actually calls `onProviderRegistered` with a
   real adapter (no Orchestrator/provider wiring yet). See
   `packages/plugin-system/src/plugin-contract.ts`'s doc comment.

Neither deviation adds a dependency edge to `orchestrator`, `policy-engine`,
or either app, and neither changes the frozen `GatewayPlugin`/
`PromptOptimizer`/`CostOptimizer` interfaces themselves — both are purely
"where does this type/edge come from," resolved in the direction the
frozen interfaces already require.

### Scope discipline

- Zero references to any of the four new packages from
  `packages/orchestrator/src`, `packages/policy-engine/src`, or any
  `apps/*/src` (verified by direct `grep`, not assumed) — the "no
  integration with Orchestrator" constraint holds.
- `learning`'s "zero behavioral impact" guarantee (architecture §36.3) is
  verified, not assumed: `test/zero-behavioural-impact.test.ts` calls
  `policy-engine`'s real, unmodified `scoreCandidates` export directly
  (an already-declared dependency) and asserts byte-for-byte identical
  output whether weights come from `DEFAULT_SCORING_WEIGHTS` directly or
  via `NoopAdaptiveRankingStrategy.adjustWeights`. `policy-engine` itself
  is untouched by this milestone.
- No new abstractions beyond what architecture §11/§33/§34/§36 specify:
  every public type/interface traces directly to one of those four
  sections; every local duplication (`CachedResult`, the `learning`
  package's narrowed `task`/`failureReason` fields,
  `RegisteredProviderAdapter`) is a documented, dependency-edge-driven
  simplification of an already-specified shape, not a new design — the
  same "designed, not specified, given the declared edges" judgment call
  EM-6 made for `TenantRef`/`RetryPolicy`/`ModelLifecycleState`.

### Architecture preserved

- ✅ Architecture Specification, Engineering Blueprint unchanged.
- ✅ EM-0 through EM-6 unchanged: every diff in this milestone lives inside
  `packages/{cost-optimizer,prompt-optimizer,learning,plugin-system}/`,
  `.dependency-cruiser.cjs` (four additive entries, one with an in-line
  comment explaining the `prompt-optimizer` deviation), `README.md`, and
  this file.
- ✅ Frozen public interfaces preserved: `CostOptimizer.optimize`,
  `PromptOptimizer.optimize`, `LearningSignalCollector.record`,
  `AdaptiveRankingStrategy.adjustWeights`, and `GatewayPlugin` are all
  implemented exactly as architecture §33.2/§34.2/§36.2/§11 specify — no
  frozen interface was modified to make an implementation easier.
- ✅ No Orchestrator/Policy Engine integration: confirmed by direct
  `grep`, not assumed (see "Scope discipline" above).
- ✅ Ready for independent EM-7 review: `pnpm build lint typecheck test`
  (98/98 tasks, up from EM-6's 82/82 — the 16 new tasks are
  build/lint/typecheck/test × 4 new packages), `pnpm graph:check` (0
  violations across 331 modules/662 dependencies, up from 268/550),
  `cost-optimizer` (100%/100%/100%/100%), `prompt-optimizer`
  (100%/100%/100%/100%), `learning` (100%/100%/100%/100%), and
  `plugin-system` (100%/100%/100%/100%) all at full coverage, comfortably
  exceeding the 90/90/90/85 threshold. 128 new tests across the four
  packages (32 + 36 + 16 + 44).

### EM-7 Review Closure

The Independent Engineering Review of EM-7 (recorded separately, not in
this file) returned **REQUIRES REWORK** with three Major and several Minor
findings. All are closed as of this section; nothing above this point was
rewritten — this is an addendum, matching the same "append, don't rewrite"
discipline this file has followed since EM-6.

**Major findings closed:**

1. `cost-optimizer`'s `computeModelClassDowngrade` now also checks
   `capabilities.structuredOutput`/`capabilities.toolCalling` before
   recommending a downgrade, matching architecture §33.3's own named
   example exactly (previously only `reasoningDepth` was checked). Six new
   tests added; Blueprint §8.17's "downgrades never violate a hard
   capability requirement" testing-strategy line is now fully, not
   partially, satisfied.
2. `plugin-system`'s `GatewayPlugin.onProviderRegistered` now takes the
   real `ProviderAdapter` (from the newly-added `providers/provider-sdk`
   dependency) instead of a narrowed local `RegisteredProviderAdapter` —
   architecture §11's interface is now implemented exactly. Recorded as
   ADR-0015 (Accepted).
3. Two governance-process gaps closed by filing the Draft/Accepted ADRs
   that should have accompanied the original dependency-table deviations:
   ADR-0014 (Proposed — `prompt-optimizer`/`execution-profile-registry`,
   a genuine Architecture-Spec/Blueprint inconsistency left open for the
   Board) and ADR-0015 (Accepted — `plugin-system`/`provider-sdk`, an
   avoidable defect that is fixed, not merely flagged).

**Minor findings closed:** the unused `learning`/`telemetry` edge is now
explicitly documented (was previously silent); the `plugin-host.ts`
default-error-handling doc comment's overstretched §19.3 citation is
corrected and the true silent-failure trade-off stated plainly;
`prompt-optimizer`'s unconsumed `capabilityTolerantOfCompression` helper
and its dead test file are removed; `learning`'s `DefaultLearningRegistry`
gained `hasCustomSignalCollector()`/`hasCustomRankingStrategy()` so a
future EM-8 consumer can answer architecture §36.3's actual gating
question ("is a non-default strategy configured?") without an `instanceof`
check; `OptimizedPrompt.transformationsApplied`'s "only if it had an
effect" semantics is now documented as a deliberate interpretation;
`cost-optimizer`'s cache-key derivation doc comment now carries an
explicit ⚠️ warning that it must not be used verbatim once EM-8 wires this
package in. `PluginHost.unregister()`'s unbounded-growth trade-off and the
two plugin-system error classes' "our own invented surface" status are
both now acknowledged in comments (Suggestion-level; not restructured).

**A fourth issue, found independently while closing the above, not in the
original review:** fixing `plugin-system`'s `onProviderRegistered` type
surfaced that this package's `tsconfig.json` (like every package's)
excludes `**/*.test.ts` from the `typecheck` script, so two test call
sites that had silently stopped matching the real `ProviderAdapter` type
went uncaught by `pnpm typecheck`. Fixed (using `provider-sdk`'s own
`MockAdapter` instead of a hand-rolled stub) and re-verified with a
one-off `tsc` invocation that does include test files, run against all
four EM-7 packages — `learning`'s test suite had the same class of
latent issue (`NoopLearningSignalCollector`'s zero-arg `record()` method,
verbatim from architecture §36.2, made two test files' direct calls with
an argument a type error once checked properly; fixed by typing those
local variables against the `LearningSignalCollector` interface, which is
also the more correct thing for a test to assert against). `cost-optimizer`
and `prompt-optimizer` had no such issue.

Re-verified after all fixes: fresh, forced (`--force`, uncached)
`build lint typecheck test` across all four packages — **26/26 tasks
pass** (26, not 16, because `plugin-system` now also builds/lints/
typechecks/tests its new `provider-sdk` dependency's own tasks as part of
the same run) — `pnpm graph:check` (0 violations, 329 modules/661
dependencies), `pnpm format:check` clean, and all four packages still at
100%/100%/100%/100% coverage. Zero references to any of the four packages
from `orchestrator`, `policy-engine`, or any app, reconfirmed by direct
`grep` after every fix.

## EM-8 — Strategy Layer Integration (Complete)

Scope: architecture §30's `AIStrategyLayer`, wiring every EM-6/EM-7
foundation package (`capability-registry`, `execution-profile-registry`,
`runtime-profiles`, `cost-optimizer`, `prompt-optimizer`, `learning` — not
`plugin-system`, which remains unintegrated) into a single, immutable
`StrategyDecision`, and integrating that into `orchestrator` ahead of
`policy-engine`, entirely behind a feature flag defaulting to `false`.
Unlike EM-6/EM-7, this milestone _does_ touch `orchestrator`/`policy-engine`/
`config`/`gateway-runtime`/`apps/gateway-server` — that integration is the
whole point of this milestone, done additively and flag-gated so EM-7's
behavior is preserved exactly when the flag is off.

### What was implemented

- **`packages/strategy-layer`** (`@ai-gateway/strategy-layer`): the
  `AIStrategyLayer`/`StrategyDecision`/`StrategyPipeline`/`StrategyContext`
  public interface (architecture §30.3), a six-stage pipeline
  (`stages/*.ts` — Capability, Execution Profile, Runtime Profile, Prompt
  Optimization, Cost Optimization, Learning Hooks), and
  `DefaultAIStrategyLayer`/`buildDefaultStages` wiring them together.
  `StrategyDecision` is genuinely immutable (`Object.freeze`d, including
  the nested `optimizations` object) before being returned.
- **`orchestrator` integration**: `ExecutionOrchestratorOptions.strategyLayer`
  (optional — absence is the entire feature-flag mechanism at this layer).
  `execute()`/`executeStream()` call `buildStrategy` first when present,
  short-circuit entirely on a `cacheHit` (new `cache-hit-response.ts`
  helper, architecture §30.3/§33.4), and otherwise thread the resulting
  `StrategyDecision` into `PolicyContext.strategyDecision` before calling
  the same, unchanged `policyEngine.selectExecutionPlan`.
- **`policy-engine`**: `PolicyContext` gains an optional
  `strategyDecision?: StrategyDecisionLike` field (ADR-0018) — a local,
  structurally-compatible duplicate type, not an import of
  `strategy-layer`'s real `StrategyDecision`, specifically to avoid a
  `policy-engine → strategy-layer` dependency cycle. `DefaultPolicyEngine`'s
  own scoring/candidate-query/routing-rules logic (§13.1–§13.4) is
  byte-for-byte unchanged — the field is accepted, not yet read.
- **`config`**: `GatewayConfig.enableStrategyLayer?: boolean` (ADR-0017),
  additive, defaults to `false`. `apps/gateway-server`'s own env-var loader
  additionally honors a literal `ENABLE_STRATEGY_LAYER` process
  environment variable as an override.
- **`gateway-runtime`**: `bootstrap()` resolves the flag
  (`runtimeConfig.enableStrategyLayer ?? gatewayConfig.enableStrategyLayer ?? false`)
  and conditionally constructs a fully-wired `DefaultAIStrategyLayer`
  (seeded capability/execution-profile/runtime-profile registries, real
  cost/prompt optimizers, a `DefaultLearningRegistry`, and an
  `InMemoryCacheClient`), passing it to the orchestrator only when enabled.
  `GatewayApp.strategyLayer` exposes the constructed instance (or
  `undefined`) for observability/testing.
- **Documentation**: `packages/strategy-layer/README.md` (including a full
  accounting of every way the EM-8 work order's own `StrategyDecision`
  field-list paraphrase differs from architecture §30.3's actual frozen
  shape — the work order names `resolvedCapabilities`, `runtimeProfile`,
  `optimizedPrompt`, `optimizationMetadata`, `routingHints`,
  `executionHints`; none of these are §30.3's real field names, and this
  package implements §30.3 verbatim, not the work order's paraphrase);
  `docs/architecture/em-8-runtime-flow.md` (sequence diagrams, pipeline
  diagram, corrected dependency graph, execution-lifecycle table — a new,
  dedicated document, not an edit to the frozen `architecture-spec.md`/
  `engineering-blueprint.md`, matching this project's established practice
  of recording corrections via ADR rather than rewriting either frozen
  document's body text).

### Two real problems found and fixed during this milestone (not silently absorbed)

1. **A literal dependency cycle in Blueprint §4.1's own table.** The
   table's row for `strategy-layer` lists `orchestrator` as one of its
   dependencies — but `orchestrator` must depend on `strategy-layer` (to
   call it), and Blueprint §6.1's own interface-freeze table already says
   so unambiguously (`AIStrategyLayer`: "Consumed by: `orchestrator`,
   Implemented by: `strategy-layer` integration"). Had the table's literal
   direction been implemented, the dependency graph would contain
   `orchestrator → strategy-layer → orchestrator`. The same row also omits
   four load-bearing edges (`core-contracts`, `capability-registry`,
   `execution-profile-registry`, `runtime-profiles`) the pipeline actually
   needs. Corrected in `.dependency-cruiser.cjs` and recorded as ADR-0016
   (Accepted — unlike ADR-0014's genuine judgment call, a literal cycle
   has only one non-contradictory fix, so no Board deliberation is needed
   to know which direction is correct).
2. **§13.5's literal instruction ("Policy Engine no longer receives a raw
   `ExecuteRequest` directly... it operates on the richer, pre-resolved
   `StrategyDecision` instead") would have required changing
   `PolicyEngine.selectExecutionPlan`'s frozen signature** — risking
   exactly the kind of routing-behavior change the milestone's own most-
   emphasized test (Pass-through Regression) exists to catch, for a
   milestone whose Out-of-Scope list explicitly excludes "Learning
   Intelligence"/"Adaptive Ranking." Resolved via ADR-0018: `PolicyContext`
   (already an existing, additive-friendly parameter) gains the
   `strategyDecision` field instead, `policy-engine`'s own logic is
   untouched, and "Policy Engine consumes `StrategyDecision`" (the actual
   Exit Criterion wording) is satisfied literally — the value is present
   and readable — without the risk a signature change would have carried.

### Scope discipline

- `plugin-system` remains completely unintegrated — zero references to it
  from `strategy-layer`, `orchestrator`, or anywhere else added this
  milestone (verified by direct `grep`), consistent with EM-8's own scope
  (only the six named foundation packages are integrated).
- No Budget Governance, Pipeline Orchestrator, Learning Intelligence,
  Adaptive Ranking, Workflow Execution, Runtime Learning, or AI Feedback
  Loop exists anywhere in this milestone's diff — `LearningHookStage`
  explicitly does not call `.record()` (see its own doc comment for why),
  and `policy-engine`'s scoring is untouched.
- `strategy-layer` has no dependency on any provider-specific package
  (`providers/groq`, `providers/nvidia-nim`, `provider-sdk`) and no
  dependency on any business-domain package — confirmed both by the
  corrected dependency list itself (ADR-0016) and by a dedicated
  strategy-pipeline test asserting no provider name appears anywhere in a
  real `StrategyDecision`'s serialized output.
- `ExecuteRequest`/`ExecuteResponse` (architecture §10, frozen since EM-0)
  are byte-for-byte unchanged — every new field this milestone added lives
  on `GatewayConfig`, `GatewayRuntimeConfig`, `ExecutionOrchestratorOptions`,
  or `PolicyContext`, none of which are the public wire contract.

### Architecture preserved

- ✅ Architecture Specification, Engineering Blueprint prose unchanged —
  every correction this milestone needed is recorded as an ADR
  (0016–0018), not a rewrite of either frozen document.
- ✅ `strategy-layer` is a first-class package (`packages/strategy-layer`),
  not embedded in `orchestrator` — confirmed by `orchestrator` depending
  on it (the correct direction, ADR-0016), never the reverse.
- ✅ Package dependency rules remain acyclic — `pnpm graph:check`: 0
  violations across 354 modules / 711 dependencies (up from EM-7's 331/662),
  fresh and forced.
- ✅ `orchestrator` remains an orchestration component, not a decision
  engine — the only new logic in `orchestrator.ts` is "call strategy layer
  if injected, short-circuit on cacheHit, otherwise thread the decision
  into an existing parameter." No routing/scoring/optimization logic moved
  into `orchestrator`.
- ✅ `strategy-layer` is provider-agnostic and domain-agnostic — verified
  by both its corrected dependency list and a dedicated test.
- ✅ Feature-flag rollback is immediate, no code change required —
  verified end-to-end: `@ai-gateway/gateway-runtime`'s
  `test/integration/end-to-end.test.ts` "EM-8 Pass-through Regression"
  suite runs an identical request through the full HTTP stack with the
  flag off and on and asserts an identical `execution.providerId`/
  `retries`/`failedOver`/`finishReason`; `@ai-gateway/orchestrator`'s own
  `test/strategy-layer-integration.test.ts` does the same one layer down,
  plus asserts `policyEngine.selectExecutionPlan` receives a byte-for-byte
  identical `ExecuteRequest` in both configurations; `@ai-gateway/policy-engine`'s
  own test suite separately proves `ctx.strategyDecision`'s presence never
  changes `selectExecutionPlan`'s output, across several different
  (structurally valid) payloads.
- ✅ Ready for independent EM-8 review: fresh, forced (`--force`, uncached)
  `pnpm build lint typecheck test` — **102/102 tasks pass** (up from EM-7's
  98/98 — `strategy-layer` alone contributes 4 new tasks; the remaining
  net change reflects `orchestrator`/`policy-engine`/`config`/
  `gateway-runtime`/`apps/gateway-server` each gaining new test files
  rather than new packages). `pnpm graph:check`: 0 violations, 354
  modules/711 dependencies. `strategy-layer` itself: 100%/100%/100%/100%
  coverage. Every pre-existing test in every touched package still passes
  unchanged with the flag at its default (`false`) — the literal
  definition of "zero breaking changes" this milestone required.

## EM-10 — Pipeline Orchestrator & Budget Governance (Complete)

Scope: architecture §41 (Multi-Step Execution Pipelines) and §43 (Budget &
Cost Governance) — two new packages (`pipeline-orchestrator`,
`budget-governance`), wired additively into `strategy-layer` (Budget
Enforcement) and `gateway-runtime` (a new `/v1/execute/pipeline` route,
alongside `budget-governance`'s composition). Neither `orchestrator` nor
`policy-engine`'s own source changed at all this milestone — every new
capability reuses their existing public interfaces exactly, per this
milestone's own "reuse the existing execution engine, do not duplicate
execution logic" instruction.

### What was implemented

- **`packages/pipeline-orchestrator`** (`@ai-gateway/pipeline-orchestrator`):
  `PipelineStep`/`ExecutionPipeline`/`PipelineContext`/`PipelineResult`
  (architecture §41.2) and `DefaultPipelineOrchestrator.executePipeline`,
  which sequences ordinary `ExecuteRequest`s through the *unmodified*
  `ExecutionOrchestrator.execute()` — no provider, `PolicyEngine`, or
  `AIStrategyLayer` calls of its own. Sequential only (§41.5's explicitly
  deferred DAG/parallel scope). `maxSteps` (ADR-0023, ratifying
  architecture §46's ADR-014) is a mandatory, platform-configured cap
  (default 20) enforced before any step executes.
- **`packages/budget-governance`** (`@ai-gateway/budget-governance`):
  `BudgetPolicy`/`BudgetThresholdAction`/`BudgetLedger`/`BudgetEnforcer`/
  `BudgetDecision` (architecture §43.2), `DefaultBudgetEnforcer` (ships in
  **shadow mode by default** — Blueprint §7 EM-10's own explicit risk
  mitigation: computes real decisions, enforces nothing until a deployment
  passes `mode: "enforcing"`), `InMemoryBudgetLedger` (a reference,
  non-durable implementation — see that package's README for why a
  production deployment needs its own, per ADR-0022/architecture §46's
  ADR-013), and `budgetProviderExclusionRule` (a real, tested
  `policy-engine` `RoutingRule` — currently unregistered by necessity, not
  oversight; see ADR-0025).
- **`strategy-layer`**: gains a dependency on `budget-governance` (Blueprint
  §4.1/§6.1's own interface table names `strategy-layer` as
  `BudgetEnforcer`/`BudgetLedger`'s consumer) and a new, optional
  `BudgetEnforcementStage`, added to the pipeline (between
  `CostOptimizationStage` and `LearningHookStage`) only when
  `StrategyLayerOptions.budgetEnforcer` is supplied — a `strategy-layer`
  instance with no Budget Governance configured is byte-for-byte
  unaffected. A block throws `GatewayError("BUDGET_EXCEEDED", ...)`,
  reusing the exact "uncaught Strategy Pipeline exception propagates to
  the caller as a typed error" mechanism the EM-8 Review Closure (Finding
  5) already confirmed is architecture-compliant — no `orchestrator` code
  change needed for this. A forced downgrade overrides the *already-existing*
  `ctx.costOptimization.recommendedModelClassDowngrade` field — the same
  "later stage overrides an earlier one's field" mechanism EM-9 used for
  Runtime Profile adjustments.
- **`core-contracts`**: `"BUDGET_EXCEEDED"` added to `GATEWAY_ERROR_CODES`
  (additive open union, per that file's own doc comment).
- **`gateway-runtime`**: a new `POST /v1/execute/pipeline` route
  (architecture §41.3) with its own request-validation/translation layer
  (`validate-pipeline-request.ts` — the wire-JSON-to-`buildInput`-closure
  translation architecture §41.3's terse endpoint sketch doesn't itself
  specify); `STATUS_BY_CODE` gains `BUDGET_EXCEEDED: 402`; `bootstrap()`
  constructs `budget-governance`'s pieces (gated on both
  `enableStrategyLayer` and a non-empty `budgetPolicies` config list) and
  a `DefaultPipelineOrchestrator` (constructed unconditionally — Multi-Step
  Pipelines have no feature flag of their own, since a caller who never
  sends a pipeline request is unaffected by the type existing).
- **`orchestrator`**: `NON_FAILOVER_CODES` gains `"BUDGET_EXCEEDED"`
  (defensive — currently unreachable via this milestone's specific wiring,
  since Budget Enforcement throws before any candidate/`ExecutionPlan`
  exists, but documented for robustness against a future milestone moving
  the check).
- **Documentation**: `packages/pipeline-orchestrator/README.md`,
  `packages/budget-governance/README.md` (new); `packages/strategy-layer/README.md`
  (new "EM-10: Budget Enforcement" section, plus a correction to an
  EM-8-era claim about `policy-engine` that EM-9 had already made stale);
  `docs/architecture/em-8-runtime-flow.md` (a brief EM-10 addendum note,
  no diagram rewrite — the existing diagrams remain accurate for the
  no-`budgetEnforcer` default); five new ADRs — 0021 (ratifying
  architecture §46's embedded ADR-013/014/015 into this repository's own
  numbering, resolving a numbering collision with this repository's
  unrelated, pre-existing `0013`/`0014` files), 0022-0024 (the three
  ratified decisions themselves), and 0025 (Draft — the two genuine gaps
  this milestone's implementation surfaced: `BudgetEnforcer.evaluate`'s
  `providerId` parameter having no natural value before Policy Engine
  selects a candidate, and `forcedProviderExclusion` having no carrier
  across `StrategyDecision`'s frozen boundary to reach Policy Engine).

### Architecture preserved

- ✅ Architecture Specification, Engineering Blueprint prose unchanged —
  every correction or open question this milestone needed is recorded as
  an ADR (0021-0025), not a rewrite of either frozen document.
- ✅ `orchestrator`'s own source is byte-for-byte unchanged this milestone
  — confirmed by direct diff review; `pipeline-orchestrator` calls its
  public `execute()` the same way any other external caller would
  (Blueprint §8.11's own "Future evolution" note, written at EM-8,
  anticipating exactly this).
- ✅ `policy-engine`'s own source is byte-for-byte unchanged this milestone
  too — `budgetProviderExclusionRule` lives in `budget-governance`, not
  `policy-engine`, and is not registered by any composition root yet (ADR-0025).
- ✅ Package dependency rules remain acyclic — `pnpm graph:check:ci`: 0
  violations across 380 modules / 760 dependencies (up from EM-9's
  356/716), fresh and forced.
- ✅ Budget Governance never overrides a hard capability requirement —
  structurally, not just by convention: `BudgetEnforcementStage` runs
  after `CapabilityResolutionStage`'s hard filter has already been
  resolved into `ctx.requiredCapabilities`, and a forced downgrade only
  ever overrides `ctx.costOptimization.recommendedModelClassDowngrade` (a
  soft scoring signal, per EM-9's own activation), never
  `ctx.requiredCapabilities` itself.
- ✅ Budget Enforcement precedence matches ADR-0022 (ratifying architecture
  §46's ADR-013) exactly: a block throws before Policy Engine — and
  therefore before Routing Rules — ever runs for that request; this is a
  property of the call graph, not a runtime check that could drift.
- ✅ Feature-flag / opt-in behavior verified end-to-end:
  `gateway-runtime`'s `bootstrap.test.ts` proves `app.budgetEnforcer` is
  `undefined` whenever `enableStrategyLayer` is off, `budgetPolicies` is
  empty, or both — and that shadow mode (the default) lets an
  over-budget request still succeed, while `mode: "enforcing"` actually
  blocks one. `pipeline-orchestrator` has no feature flag (Multi-Step
  Pipelines are additive by nature — a new endpoint, not a change to
  `/v1/execute`), verified by a dedicated test that `/v1/execute` itself
  is unaffected.
- ✅ Ready for independent EM-10 review: fresh, forced (`--force`,
  uncached) `pnpm build`: 26/26; `lint`: 51/51; `typecheck`: 51/51;
  `test`: 51/51 (all four figures include re-run build prerequisites,
  per turbo's own `--force` accounting). `pnpm graph:check:ci`: 0
  violations, 380 modules/760 dependencies. Every pre-existing test in
  every touched package still passes unchanged.

## EM-10 Engineering Rework — Independent Review Finding Closure

The EM-10 Independent Architecture & Engineering Review returned
**REQUIRES REWORK**, on the strength of one Critical and one Major
finding against Budget Governance's actual, end-to-end behavior (not its
interface shape, which the Review found compliant). This section records
what changed to close them — the EM-10 entry above is left exactly as
written; nothing in it was inaccurate, it was simply written before these
gaps were found.

- ✅ **Finding 1 (Critical) closed** — `BudgetLedger.recordSpend` was
  implemented and unit-tested but never invoked by any production code
  path, so cumulative daily/monthly spend never reflected real traffic.
  Fixed via a new, generic, optional `onExecutionCompleted` hook on
  `@ai-gateway/orchestrator`'s `ExecutionOrchestratorOptions` (fired once
  per successful, non-cache-hit `execute()` call; never for a cache hit or
  a failure; a hook failure is caught and logged, never propagated to the
  caller) — the same "optional, orthogonal, absent means not there"
  pattern EM-8's `strategyLayer` field already established for this exact
  options bag. `gateway-runtime`'s composition root (`bootstrap()`) is the
  only place that wires this hook to `BudgetLedger.recordSpend`, using the
  real, post-execution `response.execution.providerId`/
  `response.usage.estimatedCostUsd` — no new package-boundary edge:
  `orchestrator` still has zero dependency on `budget-governance`.
  `pipeline-orchestrator` required **no changes at all** — it already
  shares the same `orchestrator` instance and therefore the same hook, so
  pipeline steps get identical cumulative accounting for free (this is
  now proven by a dedicated integration test, not just asserted).
  Streaming (`executeStream()`) is deliberately left unwired — see
  `docs/adr/0026-budget-spend-recording-scope.md` for why, rather than
  guessing at a definition of "successful completion" for a
  possibly-cancelled stream.
- ✅ **Finding 2 (Major) closed** — `gateway_budget_alert_total` always
  emitted `window: "day"`, even for a monthly-threshold-driven alert.
  `DefaultBudgetEnforcer.computeRealDecision` now determines and returns
  which window actually drove `percentReached`, and every
  `emitAlertMetric` call site uses that real value. No change to
  `BudgetDecision`'s public shape.
- ✅ **Finding 3 (Major) closed** — `gateway-runtime`'s `bootstrap.test.ts`
  gained three new end-to-end tests, all exercising the *real* execution
  flow (real `bootstrap()`, real `orchestrator`, a `fakeAdapter` extended
  with a controllable, non-zero `costUsd` — the previous hardcoded `$0`
  made cumulative accrual untestable) rather than mocked ledger state:
  a two-request enforcing-mode sequence where the second request is
  blocked purely by the first's real recorded spend; the same accrual
  proven in shadow mode via the newly-exposed `app.budgetLedger`; and a
  two-step pipeline where step 2 is denied by step 1's real recorded
  spend, proving pipelines follow identical accounting with zero
  pipeline-orchestrator-specific code. `packages/budget-governance/test/`
  also gained one new unit test for Finding 2 (a monthly-driven alert
  correctly tagged `window: "month"`).
- ✅ **Regression-checked**: `/v1/execute`, `executeStream()`,
  `pipeline-orchestrator`, Strategy Layer, Policy Engine, provider
  selection, retry/failover, and rollback behavior are all unchanged —
  confirmed by every pre-existing test in every touched package (and
  every package that depends on them) still passing unmodified, plus a
  direct diff review of `orchestrator.ts`'s `execute()`/`executeStream()`
  control flow showing the only new code is the isolated,
  failure-contained hook call on the success path.
- ✅ **Fresh validation, forced**: `pnpm build`: 26/26; `pnpm typecheck`:
  51/51; `pnpm lint`: 51/51; `pnpm test`: 51/51 task-runs, 1,237 individual
  tests passed across the monorepo (9 pre-existing, unrelated skips in
  `provider-sdk`/`nvidia-nim`/`groq`, unchanged by this rework), including
  the new ones above; `pnpm graph:check`: 0 violations, 380 modules/760
  dependencies cruised — identical to the pre-rework figure, confirming no
  new package-boundary edge was introduced by this rework.
- ✅ **Documentation updated only where the fixes changed behavior**:
  `packages/budget-governance/README.md` (two new "Fixed" sections,
  replacing nothing — the two pre-existing "Known gap" sections, both
  already correctly disclosed via ADR-0025, are untouched);
  `packages/orchestrator/src/orchestrator.ts`'s own doc comments (the new
  `onExecutionCompleted` field and helper method); one new ADR
  (`0026-budget-spend-recording-scope.md`, documenting the deliberate
  `execute()`-only scope decision); this addendum. No historical section
  of this document, and neither frozen architecture document, was
  rewritten.

## EM-11 — Platform Hardening & v1.2 Production Readiness (Complete)

Scope: validation, hardening, and documentation completion only, per this
milestone's own Engineering Work Order — no new architectural concept,
package, public interface, or execution path. Nothing above this section
was rewritten; EM-11 is additive validation and documentation evidence
on top of an unchanged implementation.

### What was validated

- **Full regression, fresh and forced** (bypassing any cached prior
  results): `pnpm build` 26/26, `pnpm lint` 51/51, `pnpm typecheck`
  51/51, `pnpm graph:check` 0 violations (380 modules/760 dependencies,
  unchanged), `pnpm test` 51/51 task-runs, **1,239/1,239 individual
  tests** (9 pre-existing, unrelated skips in `provider-sdk`/
  `nvidia-nim`/`groq`, unchanged), up from EM-10 rework's 1,237 — the two
  new tests are part of this milestone's Budget Governance production-
  promotion validation, below.
- **Provider conformance** re-run explicitly for both shipped adapters:
  Groq (66/66 passed, 3 correctly-skipped `configureBehavior`-gated
  scenarios covered instead by that adapter's own dedicated
  error/timeout/malformed-stream tests) and NVIDIA NIM (52/52 passed,
  same 3-skip pattern for the same reason). `provider-sdk`'s own shared
  conformance harness: 36/36 passed (the harness's own skip-mechanism
  self-test accounts for its 3 skips).
- **Chaos-scenario coverage mapped against every scenario this
  milestone's Work Order lists** (provider failure, network failure,
  retry exhaustion, circuit-breaker activation, provider failover,
  timeout handling, pipeline step failure, streaming interruption,
  recovery behavior): found already strongly covered by existing
  `reliability`/`orchestrator`/`pipeline-orchestrator`/`streaming`
  suites (including a test literally named "the chaos-test scenario" in
  `orchestrator/test/orchestrator.test.ts`). One genuine gap found and
  closed: no test proved what happens when Budget Governance itself has
  a genuine infrastructure failure (as opposed to a deliberate
  `BUDGET_EXCEEDED` business decision) — e.g., the kind of failure a
  future durable ledger's network error would produce. Added one test
  in `packages/strategy-layer/test/strategy-layer.test.ts` proving this
  fails closed cleanly (the error propagates out of `buildStrategy()`
  rather than being swallowed into a false "allowed" decision, hanging,
  or corrupting pipeline state).
- **Budget Governance production promotion** — the milestone's most
  consequential finding. All four `BudgetThresholdAction` values were
  independently verified against the real, wired system (not just
  isolated `budget-enforcer` unit tests, which already covered all four
  in isolation):
  - `block` — already proven end-to-end by the EM-10 rework's tests.
  - `alert` — newly proven end-to-end (`bootstrap.test.ts`): a request
    that blows well past an alert-only threshold still succeeds,
    confirming alert-only configurations never silently degrade into
    blocking behavior once enforcement is live tenant-wide.
  - `downgrade_model` — traced end-to-end through
    `budget-enforcement-stage.ts` → `strategy-signals.ts` →
    `model-scorer.ts`'s cost-term scoring bonus; each link already
    independently unit-tested; confirmed as a deliberate soft bias, not
    a hard override, by design.
  - `switch_provider` — **found non-functional in production**, and
    empirically reconfirmed against the real system (`bootstrap.test.ts`):
    a provider that breaches its `perProviderSpendCapUsd` by 12x with a
    `switch_provider` threshold configured is still selected on the very
    next request. Root cause is two-fold and was already disclosed on
    paper via ADR-0025 before this milestone: (1) the only production
    `BudgetEnforcer.evaluate()` call site always runs pre-provider-
    selection, passing `NO_PROVIDER_SELECTED_YET`, which skips
    per-provider-cap checks entirely; (2) even if triggered, the frozen
    `StrategyDecision` interface has no carrier field for a provider
    exclusion. Because closing this requires either a frozen-interface
    change or a Board-approved alternative, and this milestone's
    Architecture Constraints explicitly forbid introducing new public
    interfaces or changing Strategy Layer behavior, **this was not
    code-fixed in EM-11** — it was elevated from a paper disclosure to a
    prominent, operator-facing release-documentation callout instead
    (`docs/release/KNOWN_LIMITATIONS.md` §9.2, `CHANGELOG.md`'s v1.2.0
    entry, `docs/release/RELEASE_NOTES.md`'s v1.2 section), since v1.2 is
    the first release where this gap has live-traffic consequences
    rather than shadow-mode-only ones.
- **Performance** — an in-process framework-overhead smoke test only
  (fake, zero-simulated-latency adapters, isolating Strategy Layer /
  Budget Governance / Pipeline framework cost from real provider network
  latency): overhead for each layer measured in the sub-millisecond
  range per request, several orders of magnitude below typical real
  provider response latency, with no throughput collapse observed as
  concurrency increased from 1 to 50 in-process concurrent requests
  against shared in-memory state (ledger, circuit breaker). This is
  explicitly **not** a substitute for genuine production-scale,
  concurrent, real-network load testing — no staging environment, load
  corpus, or latency-measurement harness exists in this repository, the
  same structural gap already disclosed for v1.1 in
  `KNOWN_LIMITATIONS.md` §10.1 (formerly §9.1), extended here rather than
  worked around.
- **Repository governance sweep**: no `TODO`/`FIXME`/`XXX`/`HACK`
  markers, no stray `console.log`/`debugger` statements, and no
  accidental placeholder/stub implementations found anywhere in
  production `src/` across every package and app — every "not
  implemented" comment found (`model-registry`'s Redis pub/sub transport,
  `policy-engine`'s soft-vs-hard routing preference) is a pre-existing,
  deliberate, already-documented design decision, not debug residue.
- **Documentation finalization**: `docs/release/KNOWN_LIMITATIONS.md`
  updated with a new Budget Governance section (§9) — this document had
  not been updated since roughly EM-8 and had zero mentions of Budget
  Governance, Pipeline Orchestration, or Runtime Profiles before this
  pass. `CHANGELOG.md` gained a `[1.2.0]` entry.
  `docs/release/RELEASE_NOTES.md` gained a "Version 1.2.0" section ahead
  of the existing v1.0 baseline content, which is left unchanged. This
  addendum. One documentation-completeness observation, not fixed here
  (fabricating retroactive historical content risks inaccuracy in a
  document meant to be authoritative history): this document has no
  standalone `## EM-9` section, even though other documents (this file's
  own EM-10/EM-10-rework sections, the EM-10 Independent Architecture
  Review) reference "EM-9's activation" of Runtime Profile scoring
  adjustments as settled history — EM-9's work appears to have been
  folded into EM-8's section at original authoring time rather than
  omitted; a future documentation pass should confirm and either add a
  standalone EM-9 section or a note explaining the merge.

### Regression confirmed unchanged

Every capability delivered EM-0 through EM-10 (including the EM-10
rework) remains operational: `/v1/execute`, `/v1/execute/stream`,
`/v1/execute/pipeline`, Strategy Layer pass-through regression, Policy
Engine scoring, retry/failover/circuit-breaker behavior, credential
resolution, multi-tenant isolation, rate limiting, response caching, and
Budget Governance shadow-mode behavior (still available and unchanged for
any tenant that has not opted into `budgetEnforcementMode: "enforcing"`)
— confirmed by every pre-existing test across every package still
passing unmodified, plus the two new gaps closed above.

### What was deliberately not done

Per this milestone's Architecture Constraints: no new package, no new
public interface, no change to Strategy Layer/Policy Engine/Pipeline
Orchestrator/Budget Governance architecture, no change to any Runtime
Profile or Provider Adapter contract. The `switch_provider` gap found
above was documented, not code-fixed, for exactly this reason — closing
it needs an Architecture Review Board decision on ADR-0025, which is
explicitly outside a hardening milestone's authority.

