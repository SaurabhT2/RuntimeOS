# @ai-gateway/policy-engine

**Status:** implemented (EM-3). Task-to-model scoring, ranking, and
`ExecutionPlan` assembly (architecture §13; Blueprint §7, §8.7). Scoring
uses static weights and a heuristic quality signal — cost/capability-aware
routing sophistication is v1.1 Strategy Layer scope (architecture §30),
not EM-3's.

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

## Testing strategy

- Unit tests per pipeline stage against hand-built fixtures
  (`task-classifier.test.ts`, `candidate-query.test.ts`,
  `model-scorer.test.ts`, `routing-rules.test.ts`).
- Integration tests (`policy-engine.test.ts`) run the full engine against
  `@ai-gateway/model-registry`'s real `SEED_MODELS` fixture and a real
  `DefaultHealthMonitor`, covering: primary + fallback selection, capability
  routing, prioritization, health-driven ranking, a soft
  `preferredProviders` override, the `ALL_PROVIDERS_UNAVAILABLE`
  failure path, and determinism (same input → same plan).

## Dependencies

- `@ai-gateway/core-contracts`
- `@ai-gateway/model-registry`
- `@ai-gateway/reliability`

## Architecture reference

§13
