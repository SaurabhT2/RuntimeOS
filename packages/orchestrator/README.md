# @ai-gateway/orchestrator

**Status:** implemented (EM-4). `ExecutionOrchestrator` — the full request
lifecycle (architecture §17): Policy Engine → Credential Resolution →
Provider Resolution → Retry → Failover → Streaming → Completion.

## Public API

- `ExecutionOrchestrator` / `DefaultExecutionOrchestrator` —
  `execute(req)` (non-streaming) and `executeStream(req)` (streaming,
  yields `core-contracts` `StreamChunk`s), plus `cancel(requestId)`
  (delegates to `StreamManager.cancel`). Never rejects/throws anything but
  a `GatewayError`.
- `ProviderAdapterRegistry` / `InMemoryProviderAdapterRegistry` — maps a
  `providerId` string to a live adapter instance. See ADR-0008.
- `ProviderAdapter`, `NormalizedInvocation`, `NormalizedResult`,
  `NormalizedChunk`, `ProviderCapabilities`, `CostEstimate` — structural
  duplicates of their `provider-sdk` counterparts. See ADR-0008 and
  `types.ts`'s doc comment for why.
- `buildNormalizedInvocation` — pure `ExecuteRequest + ExecutionPlan (+
  optional StrategyDecision, EM-9) -> NormalizedInvocation` translation
  (`invocation-builder.ts`).
- `buildExecuteResponse` — pure `NormalizedResult + ExecutionMeta ->
ExecuteResponse` translation (`response-mapper.ts`).

## Scope Verification

Per the Engineering Blueprint's EM-4 section, this package implements
**only**: `ExecutionOrchestrator` (the full non-streaming + streaming
request lifecycle, retry-then-failover between candidate plans) and the
adapter-resolution mechanism the EM-3 Architecture & Engineering Review
named as EM-4's one required planning decision. It does **not** implement:
a workflow engine, a strategy engine, RBAC's policy-check step (architecture
§20.5 names this as a separate concern from `AuthMiddleware` itself — see
`middleware`'s README), a persistent credential-registration/BYOK flow
(`credential-resolver`'s `resolver.ts` doc comment floats `orchestrator` as
a plausible _future_ owner of that — explicitly out of this milestone), or
any HTTP server layer (`apps/gateway-server` is EM-5).

## Design notes / Engineering Decisions

1. **Adapter resolution never imports a concrete provider package — ADR-0008.**
   `orchestrator`'s frozen dependency edge (architecture §4.1) excludes
   `provider-sdk` entirely. `types.ts` structurally duplicates the types a
   `ProviderAdapter` needs (the same pattern `reliability` and
   `credential-resolver` already use across their own frozen-boundary
   gaps), and `ProviderAdapterRegistry` is injected by the caller —
   `orchestrator` only ever calls `.resolve()` on it. Concrete adapters
   (`GroqAdapter`, `NimAdapter`) are registered by `apps/gateway-server`'s
   composition root (EM-5, architecture §6.4), not by this package.

2. **Credential-resolution failure is always terminal, never triggers
   failover — even for a fallback plan, even though §18.3 describes
   credential re-resolution happening per candidate.** architecture §17's
   lifecycle diagram draws `H{Credential found?} -- no --> Z4` as a
   standalone terminal node, distinct from the retry/fallback loop's own
   `J -- no, non-retryable --> Z6` edge. The diagram does not show what
   happens if a _fallback_ candidate's credential also fails, so this is a
   judgment call: `resolveCandidate` (`orchestrator.ts`) treats a
   credential failure the same way regardless of which candidate index
   it occurs on — terminal, no further candidates attempted. Rationale: a
   missing/invalid credential is a caller/operator configuration problem,
   not a transient provider fault; continuing to burn through the fallback
   chain after hitting one doesn't make the request more likely to
   succeed, and risks masking a configuration error as a generic
   `ALL_PROVIDERS_UNAVAILABLE`.

3. **Failover eligibility is a small blocklist, not the retry policy's
   allowlist — see `errors.ts`'s `NON_FAILOVER_CODES` doc comment for the
   full writeup.** A maximally literal reading of architecture §17's
   diagram (fallback gated behind `candidate.retryPolicy.retryableErrorCodes`
   membership) fails the Engineering Blueprint's own EM-4 acceptance
   criterion — a real provider whose network is simply unreachable maps to
   `INTERNAL_ERROR` at the adapter boundary (`GroqAdapter`'s/`NimAdapter`'s
   own test suites confirm this), which is not in the default retryable
   set, so the literal reading would never fail over on a fully-down
   provider. `isFailoverEligible` instead blocks only `CONTENT_FILTERED`,
   `INVALID_SCHEMA`, `INVALID_TASK`, and `CANCELLED` — codes where a
   _different_ provider plausibly cannot help — and treats every other
   code (`INTERNAL_ERROR` included) as failover-eligible once the
   candidate's own retry budget is exhausted.
   `tools/orchestrator-integration-tests/test/chaos-failover.test.ts`
   exercises exactly this scenario against real `GroqAdapter`/`NimAdapter`
   instances.

4. **Deadline propagation is best-effort, at the orchestrator layer only.**
   None of `policyEngine.selectExecutionPlan`, `credentialResolver.resolve`,
   or `retryEngine.execute`'s frozen signatures accept a deadline or
   `AbortSignal`, so true end-to-end propagation (architecture §18.4)
   cannot be retrofitted into those packages from here. What `orchestrator`
   _can_ control — `NormalizedInvocation.timeoutMs`, which each adapter
   uses for its own `AbortController` — is shrunk to the remaining request
   budget (`req.constraints.maxLatencyMs`) before each candidate attempt,
   and a candidate whose deadline has already elapsed is skipped without
   ever calling the adapter.

5. **Streaming failover only happens before the first chunk is yielded.**
   Once any chunk has reached the caller, switching providers would
   silently splice two providers' output together — instead, a mid-stream
   failure is surfaced as a `GatewayError` to the caller, matching
   `streaming`'s own documented precedent of surfacing already-yielded
   chunks before raising.

6. **`toGatewayError`'s defensive wrap.** Architecture §19.2 requires every
   `ProviderAdapter` to translate raw exceptions to `GatewayError` before
   they escape, but `orchestrator` does not take that on faith from an
   adapter it did not itself construct — anything that is not already a
   `GatewayError` is wrapped as a non-retryable `INTERNAL_ERROR` rather
   than propagated raw.

7. **The Strategy Layer, once enabled, fails the whole request (a typed
   `INTERNAL_ERROR`, never a silent hang) rather than falling back to
   pass-through routing — this is deliberate, not an open gap.**
   `buildStrategyDecision` (`orchestrator.ts`) calls
   `strategyLayer.buildStrategy(req, req.tenant)` with no local try/catch;
   any exception it throws propagates to `execute`/`executeStream`'s outer
   `try/catch`, where the same `toGatewayError` wrap described in note 6
   above converts it into a non-retryable `INTERNAL_ERROR` — the Policy
   Engine and every Provider Adapter are never reached for that request.
   The EM-8 Independent Architecture & Engineering Review (Finding 5) asked
   whether this "hard dependency once enabled" behavior needed to change to
   a graceful degradation (silently falling back to the EM-7 pass-through
   path) instead. It does not: architecture §3's P6 ("Fail predictably,
   degrade gracefully") lists a **typed error** as one of exactly four
   equally-valid failure behaviors, alongside retry/failover/circuit-break —
   it does not require every optional layer to have a silent-bypass fallback,
   and no other section of the Architecture Specification or Engineering
   Blueprint imposes one specifically on the Strategy Layer (contrast with
   `runtime-profiles`' registry, architecture §35's ADR, which *is*
   specified to fall back to a last-known-good cache on store
   unavailability — a different package, a different, explicitly-stated
   requirement). A typed, non-retryable `INTERNAL_ERROR` is exactly the
   "never a silent hang or an unhandled exception leaking upstream" outcome
   P6 and architecture §19.3 require. No code change was made for this
   finding; this note is that review conclusion, recorded per the EM-8
   Review Closure's "document, don't silently resolve" instruction.

8. **`buildNormalizedInvocation`'s `strategyDecision` parameter is
   additive and optional (EM-9, Independent Architecture & Engineering
   Review of EM-9).** Architecture §34.5: "The `OptimizedPrompt` becomes
   part of the `StrategyDecision` ... that ... the Provider Adapter's
   `NormalizedInvocation.messages` ... are built from." Both call sites
   (`execute`'s `attemptCandidate`, `executeStream`) already had
   `strategyDecision` in scope (it's computed once per request, before
   `policyContext(strategyDecision)` is built) — passing it through to
   `buildNormalizedInvocation` needed no new state, only threading an
   existing value one level deeper. `NormalizedInvocation`'s own shape
   (architecture §12.1) is unchanged; only which value populates
   `.messages` can differ, and only when `optimizations.prompt.messages`
   is present and well-formed (`deriveOptimizedMessages`,
   `@ai-gateway/policy-engine`) — malformed or absent falls back to
   `resolveMessages(req)` exactly as before this milestone.

## Testing Strategy

- **Unit tests** (`packages/orchestrator/test/`): `invocation-builder.test.ts`,
  `response-mapper.test.ts`, `registry.test.ts` (pure functions / the
  registry in isolation), and `orchestrator.test.ts` — the full lifecycle,
  against **real** `reliability` (`DefaultRetryEngine`,
  `InMemoryCircuitBreaker`, `DefaultHealthMonitor`) and **real**
  `streaming` (`DefaultStreamManager`), with a fake `PolicyEngine` (scripted
  `ExecutionPlan`), a fake `CredentialResolver`, and hand-built fake
  `ProviderAdapter`s (`test/fixtures.ts`'s `fakeAdapter`/`failingAdapter` —
  the same "hand-built fake, no real network" convention `streaming`'s own
  test suite established, required here because this package has no
  dependency edge onto `provider-sdk` to import its real `MockAdapter`
  from — see ADR-0008). Covers: happy path, request validation, retry,
  failover (retryable-exhausted, non-retryable-terminal,
  credential-failure-terminal, missing-adapter-advances,
  circuit-breaker-open-advances, all-exhausted), deadline propagation,
  streaming (success, pre-first-chunk failover, post-first-chunk terminal,
  cancellation), telemetry, and health-monitor/circuit-breaker bookkeeping.
- **Integration + chaos tests** (`tools/orchestrator-integration-tests/`,
  outside this package — see ADR-0008 and that package's README for why):
  the real `DefaultExecutionOrchestrator` wired against real
  `policy-engine`/`credential-resolver`/`reliability`/`streaming`, and
  either `provider-sdk`'s real `MockAdapter` or the real
  `GroqAdapter`/`NimAdapter` (recorded-fixture, no live network) — directly
  satisfying the Engineering Blueprint's "end-to-end integration tests
  against both the Mock Adapter and recorded-fixture real adapters" and "a
  chaos test injecting Groq failures to verify automatic failover"
  requirements.
- **Coverage** (`vitest run --coverage`, this package): statements 96.1%,
  branches 90.2%, functions 92%, lines 96.1% — all above the 90/90/90/85
  project thresholds.

## Deferred Work

- A persistent, database-backed `ProviderAdapterRegistry` implementation —
  `InMemoryProviderAdapterRegistry` is sufficient for `apps/gateway-server`
  (EM-5) to populate at process start (architecture §6.4's single
  composition root), so nothing currently motivates a persistent one.
- Distributed rate limiting / cross-instance circuit-breaker state — not
  this package's concern (that's `reliability`'s / `middleware`'s), noted
  here only because it directly affects how many gateway instances can
  safely share one `apps/gateway-server` deployment.
- Fully preemptive streaming cancellation — inherited limitation from
  `streaming`'s own cooperative-cancellation design (ADR-0004); see
  `streaming`'s README.
- Credential-registration-with-live-validation (`credential-resolver`'s
  `resolver.ts` doc comment names `orchestrator` as a plausible future
  owner, given its existing dependency edges) — not in this milestone's
  scope.

## Dependencies

- `@ai-gateway/core-contracts`
- `@ai-gateway/policy-engine`
- `@ai-gateway/credential-resolver`
- `@ai-gateway/reliability`
- `@ai-gateway/streaming`
- `@ai-gateway/telemetry`

## Architecture reference

§11 (interfaces), §12.1 (streaming variant), §12.4 (adding a provider),
§17 (request lifecycle), §18 (retry/failover/timeout semantics)
