# @ai-gateway/policy-engine

**Status:** implemented (EM-3), **activated for the Strategy Layer as of
EM-9** (Independent Architecture & Engineering Review of EM-9). Task-to-model
scoring, ranking, and `ExecutionPlan` assembly (architecture §13; Blueprint
§7, §8.7). Every pipeline *stage* is still exactly EM-3's five steps; EM-9
made several of those stages' *inputs* come from a well-formed
`ctx.strategyDecision` when present, superseding EM-3's `ExecuteRequest`-only
inputs — see "EM-9 Architecture Compliance Notes" below for the complete,
field-by-field account.

## Public API

- `PolicyEngine.selectExecutionPlan(req, ctx)` (architecture §11, verbatim)
  — `DefaultPolicyEngine` runs the full decision pipeline (§13.2):
  1. **Task Classifier** (`classifyTask`) — maps `ExecuteRequest` to a
     `CapabilityRequirement`.
  2. **Candidate Query** (`queryCandidates`) — filters the injected
     `ModelRegistry` by that requirement.
  3. **Scoring** (`scoreCandidates`) — architecture §13.3's weighted sum:
     quality + latency + cost + health − rate-limit penalty.
  4. **Ranking** (`rankCandidates`) — applies `preferences.prioritize` as a
     weight boost, then any registered `RoutingRule`s, then sorts.
  5. **Plan Assembly** — top candidate becomes the primary `ExecutionPlan`;
     the next `maxFallbacks` (default 2) become its pre-computed,
     single-level `fallbackPlans` (ADR-005).
- `ExecutionPlan` (architecture §13.1, verbatim).
- `classifyTask`, `queryCandidates`, `scoreCandidate(s)`, `rankCandidates`,
  `applyPrioritization`, `preferredProvidersRule` — every pipeline stage is
  exported individually and independently unit-tested (architecture §24).
- `PolicyEngineConfig` — constructor options: `weights` (architecture
  §13.3's four named weights, `DEFAULT_SCORING_WEIGHTS` if omitted),
  `rules` (`RoutingRule[]`, defaults to `[preferredProvidersRule]`),
  `maxFallbacks`, `defaultMaxOutputTokens`, `defaultTimeoutMs`.

## Design notes / Engineering Decisions

1. **No dependency on `@ai-gateway/config`.** Section 4.1's
   `DEPENDENCY_TABLE` (enforced by `.dependency-cruiser.cjs`) allows
   `policy-engine` to depend only on `model-registry`, `reliability`,
   `core-contracts` — not `config`. Architecture §13.3 states scoring
   weights "are part of `GatewayConfig.routing`"; §13.4 says routing rules
   are "registered via config." Since that dependency edge doesn't exist,
   both are instead constructor options (`PolicyEngineConfig.weights` /
   `.rules`) with documented defaults — the same pattern `reliability` and
   `provider-sdk` already use for shapes they cannot import (`BackoffStrategy`,
   `CredentialScope`). A future composition root (`apps/gateway-server`'s
   bootstrap, or the orchestrator, EM-4/EM-5) is expected to read
   `GatewayConfig.routing` and translate it into these same constructor
   options. **ADR candidate filed:** see `docs/adr/0006-policy-engine-config-dependency-gap.md`.
2. **`qualityScoreForTask` is a documented heuristic, not a curated score.**
   `ModelDescriptor` (§14.1) has no per-task quality field; the heuristic
   blends `reasoningDepth` and `creativityScore` by the task-classifier's
   affinity signals. This is explicitly EM-3 scope per Blueprint §7
   ("no cost/capability sophistication yet — static weights").
3. **`healthScore`/`rateLimitPenalty` are derived, not verbatim architecture
   fields.** Neither `ProviderHealthSnapshot` nor `ModelDescriptor` has a
   literal `.score`/penalty field; both functions are small, deterministic,
   and unit-tested in isolation (`model-scorer.test.ts`) so their exact
   shape can be revisited without touching the scoring pipeline's structure.
4. **`fallbackPlans` are single-level.** Architecture §13.2 step 5 describes
   "the next 1-2 candidates become the pre-computed fallback chain," not a
   recursively nested tree — each fallback plan's own `fallbackPlans` is `[]`.
5. **`ExecutionPlan.temperature`/`maxOutputTokens` have no `ExecuteRequest`
   equivalent.** `temperature` is derived from `preferences.creativity`
   (`low`→0.2, `medium`→0.5, `high`→0.9); `maxOutputTokens` uses a
   documented constructor-configurable default (1024) until a future
   Execution Profile (architecture §31, v1.1) supplies one per task.

## Relationship to orchestrator/streaming (EM-4)

`PolicyEngine` never imports `providers/provider-sdk` — an `ExecutionPlan`
carries only primitive routing decisions (`providerId`, `modelId`, etc.),
never a `ProviderAdapter` instance or a `NormalizedInvocation`. Translating
an `ExecutionPlan` + `ExecuteRequest` into the `NormalizedInvocation` a
`ProviderAdapter`/`StreamManager` consumes is the orchestrator's job
(EM-4, architecture §17) — the one package with a legitimate dependency
edge onto both `policy-engine` and `providers/provider-sdk` (via
`streaming`).

## EM-9 Architecture Compliance Notes

Field-by-field account of what `ctx.strategyDecision` (when present and
well-formed — every field is individually validated, `strategy-signals.ts`)
changes, versus what stays exactly as EM-3 built it:

| Pipeline stage | EM-3 input | EM-9 input when `strategyDecision` is present | Architecture reference |
|---|---|---|---|
| Task Classifier / Candidate Query | `classifyTask(req)`'s ad-hoc `CapabilityRequirement` | `requiredCapabilities` (`CapabilitySet`) supersedes `requiresJsonMode`/`requiresToolCalling`/`requiresStreaming`/`minContextTokens`/`reasoningAffinity`; `creativityAffinity` always from `classifyTask` | §32.2 |
| Scoring | Four weighted terms only | `preferredModelClasses` nudges `quality`; `recommendedModelClassDowngrade`/`preferFreeTierProviders` nudge `cost` — soft signals only, never a new term, never a hard override | §31.2, §33.2 |
| Plan Assembly | `resolveTemperature(req)`, hardcoded `maxOutputTokens`/`timeoutMs`/`DEFAULT_RETRY_POLICY`, `req.constraints?.streaming ?? false` | `executionProfile.inference`/`.timeoutMs`/`.retryPolicy`/`.streaming.defaultEnabled` supersede those defaults; `optimizations.cost.disableStreaming`, when `true`, forces `streaming: false` regardless | §31.1, §33.2 |
| (orchestrator, not this package) | `resolveMessages(req)` | `optimizations.prompt.messages` supersedes it entirely | §34.5 |

Every override above is field-level and independently validated
(`deriveCapabilityRequirement`/`deriveStrategySignals`/`deriveExecutionPlanOverrides`,
`strategy-signals.ts`) — a present-but-malformed `strategyDecision`, or one
missing a given field, falls back to the exact EM-3 value for that field
alone, never throws, and never partially trusts an object. `req.constraints.maxLatencyMs`
(a caller-supplied hard constraint) still always wins over
`executionProfile.timeoutMs`.

**What this milestone deliberately did not wire, and why** (architecture
§37.4 lists four Runtime Profile read sites; this milestone activates two
of them — the Execution Profile Registry's `caching`/`retryPolicy` merge,
inside `strategy-layer`, and the Cost Optimizer's `preferFreeTierProviders`,
already wired at EM-8):

- **Policy Engine's Candidate Query filtering by `ModelDescriptor.lifecycle`/`allowedLifecycleStates`.**
  `ModelDescriptor` has no `lifecycle` field yet (`runtime-profiles`' own
  source comment, `runtime-profile.ts`: "architecture §35 is the
  specification for it, but adding it is scoped to a different milestone
  than this one"). Adding one would modify a frozen architecture §14.1
  interface, which this milestone's instructions forbid. Deferred,
  already documented at its source.
- **`RuntimeProfile.reliability.failoverAggressiveness` adjusting Circuit
  Breaker thresholds.** Circuit breaker thresholds are construction-time
  configuration (`InMemoryCircuitBreaker`), not a per-request/per-plan
  value `PolicyContext`/`StrategyDecision` carries — wiring this would need
  a materially larger change than "configuration and feature-flag rollout"
  (Blueprint §7's own EM-9 scope). Not implemented; flagged as a future
  milestone's work, not silently done partially.
- **Architecture §37.4's claim that Runtime Profiles adjust "`streaming`
  ... and `timeoutMs` defaults."** `RuntimeProfile` (§37.2's schema) has no
  field literally named `streaming` or `timeoutMs` — only `caching.aggressiveness`
  and `reliability.retryAggressiveness` map onto a concrete
  `ResolvedExecutionProfile` field unambiguously. This milestone implements
  those two mappings only (`ExecutionProfileResolutionStage`,
  `strategy-layer`) and does not invent an unstated streaming/timeoutMs
  mapping — see this milestone's Architecture Compliance Report / ADR
  candidate for the Architecture Board to resolve.
- **`RuntimeProfile.provider.maxProvidersInFailoverChain` adjusting
  `DefaultPolicyEngineOptions.maxFallbacks`.** `RuntimeProfile` itself is
  never exposed on `StrategyDecision` (only `executionProfile.adjustedBy`'s
  `runtimeProfileId` — a string, not the profile's own values) — `policy-engine`
  has no way to read this field this milestone without a new
  `StrategyDecision`/`PolicyContext` field, which this milestone's
  instructions forbid adding without Architecture Board sign-off. Not
  implemented.

## Testing strategy

- Unit tests per pipeline stage against hand-built fixtures
  (`task-classifier.test.ts`, `candidate-query.test.ts`,
  `model-scorer.test.ts`, `routing-rules.test.ts`).
- Integration tests (`policy-engine.test.ts`) run the full engine against
  `@ai-gateway/model-registry`'s real `SEED_MODELS` fixture and a real
  `DefaultHealthMonitor`, covering: primary + fallback selection, capability
  routing, prioritization, health-driven ranking, a soft
  `preferredProviders` override, the `ALL_PROVIDERS_UNAVAILABLE`
  failure path, and determinism (same input → same plan); and (EM-9) two
  describe blocks — "absent or malformed" (the exact EM-3/EM-8 behavior is
  unaffected) and "present and well-formed" (every activated field, plus
  hard-constraint precedence and malformed-field fallback).
- `strategy-signals.test.ts` (EM-9): each derivation/validation function in
  isolation — absent input, malformed input, individually-malformed
  sub-fields, and well-formed input, for every one of the four functions.
- `model-scorer.test.ts` (EM-9 additions): `preferredModelClasses`'s
  position-weighted bonus, the `Math.min(1, ...)` cap, and both
  `costSignalBonus` paths (`recommendedModelClassDowngrade`,
  `preferFreeTierProviders`) in isolation, plus a no-`strategySignals`-argument
  regression check against the pre-EM-9 scores.

## Dependencies

- `@ai-gateway/core-contracts`
- `@ai-gateway/model-registry`
- `@ai-gateway/reliability`

## Architecture reference

§13
