# `@ai-gateway/strategy-layer`

The AI Strategy Layer (architecture §30): resolves capabilities, execution profile, and
runtime profile, runs the Prompt/Cost Optimization Pipeline, wires the Learning extension
points, and produces an immutable `StrategyDecision` for the Policy Engine.

**STATUS:** implemented and integrated (Engineering Milestone EM-8); **activated**
as of EM-9 (Independent Architecture & Engineering Review of EM-9) — see
"EM-9: Runtime Profile → Execution Profile merge" below for what changed;
**Budget Enforcement added** as of EM-10 — see "EM-10: Budget Enforcement" below.
`orchestrator` calls this package first, behind the `enableStrategyLayer`
feature flag (ADR-0017); when disabled, `orchestrator` calls
`policy-engine` exactly as it did in EM-7.

## The pipeline

```
Request
   │
   ▼
CapabilityResolutionStage        (capability-registry)
   │
   ▼
RuntimeProfileResolutionStage    (runtime-profiles)
   │
   ▼
ExecutionProfileResolutionStage  (execution-profile-registry; EM-9: merges the
   │                              resolved RuntimeProfile's caching/retryPolicy
   │                              adjustments — needs RuntimeProfileResolutionStage
   │                              to have already run, hence this order swap)
   ▼
PromptOptimizationStage          (prompt-optimizer)
   │
   ▼
CostOptimizationStage            (cost-optimizer, reads back Prompt's estimatedTokens)
   │
   ▼
LearningHookStage                (learning — socket wiring only, no signal collected)
   │
   ▼
StrategyDecision  (frozen, immutable, architecture §30.3)
```

Each stage is a small, independently-exported, independently-tested class implementing
one method (`StrategyPipelineStage.run`), so "every stage must remain independently
replaceable" (EM-8's own constraint) is structural, not aspirational — `buildDefaultStages`
just returns an array; any caller can swap, reorder, or drop entries.

**EM-9: Runtime Profile → Execution Profile merge.** `RuntimeProfileResolutionStage`
now runs *before* `ExecutionProfileResolutionStage` (the only stage-order change this
milestone made) so the latter can read `ctx.runtimeProfile` and apply architecture
§37.4's first read site: `caching.aggressiveness` → `ResolvedExecutionProfile.caching`,
`reliability.retryAggressiveness` → `.retryPolicy` (which, once threaded through
`StrategyDecision.executionProfile` to `policy-engine`'s Plan Assembly and from there to
`orchestrator`'s Retry Engine, also satisfies §37.4's *fourth* read site — "Retry Engine
... to adjust `RetryPolicy`"). `adjustedBy` is populated only when at least one field
actually changed — the default `"standard"`/`"standard"` runtime profile (`production`,
`runtime-profiles/src/seed-data.ts`) is a no-op by construction, so this reordering does
not change any existing EM-8 test's expected output. See
`stages/execution-profile-resolution-stage.ts`'s doc comment for the full reasoning,
including why `RuntimeProfile`'s own schema has no field this milestone maps onto
`streaming`/`timeoutMs` (architecture §37.4 claims both are Runtime-Profile-adjustable;
this milestone does not invent an unstated mapping — flagged as an Architecture
Compliance finding, not silently resolved).

## A note on the work order's `StrategyDecision` field list

The EM-8 work order describes `StrategyDecision` as containing `resolvedCapabilities`,
`executionProfile`, `runtimeProfile`, `optimizedPrompt`, `optimizationMetadata`,
`routingHints`, `executionHints`. **None of these are this type's actual field names**,
and several don't exist on it at all. Architecture §30.3's frozen interface — the
authoritative source, per this whole project's established governance — is:

```typescript
interface StrategyDecision {
  requiredCapabilities: CapabilitySet;
  executionProfile: ResolvedExecutionProfile;
  optimizations: { cost: CostOptimizationResult; prompt: OptimizedPrompt };
  cacheHit?: CachedResult;
}
```

This package implements §30.3 exactly, not the work order's paraphrase. Every EM-8
concept the work order names is still real, just not a `StrategyDecision` field:

| Work order concept                | Where it actually lives                                                                                                                                                                                                                                                                                                 |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resolvedCapabilities`            | `StrategyDecision.requiredCapabilities` (same data, different name)                                                                                                                                                                                                                                                     |
| `runtimeProfile`                  | Resolved internally by `RuntimeProfileResolutionStage`, consumed by both `ExecutionProfileResolutionStage` (EM-9: `caching`/`retryPolicy` adjustments) and `CostOptimizationStage` — never surfaced on the frozen decision type itself, since every downstream consumer that needs it reads it *inside* this package's own pipeline, before `StrategyDecision` is assembled                                                 |
| `optimizedPrompt`                 | `StrategyDecision.optimizations.prompt`                                                                                                                                                                                                                                                                                 |
| `optimizationMetadata`            | `StrategyDecision.optimizations` (cost + prompt) is the metadata                                                                                                                                                                                                                                                        |
| `routingHints` / `executionHints` | Not part of this milestone's frozen decision shape at all — the closest real concept is `optimizations.cost.recommendedModelClassDowngrade`/`disableStreaming`/`preferFreeTierProviders`, which are soft signals `policy-engine` can read from `PolicyContext.strategyDecision` (ADR-0018), not a separate hints object |

## Engineering decisions worth knowing

- **Prompt Optimization runs before Cost Optimization**, not after as the work order's own
  listed pipeline order suggests. Architecture §33.2/§33.3 are explicit that Cost
  Optimization reads back Prompt Optimization's `estimatedTokens`. See
  `stages/prompt-optimization-stage.ts`'s doc comment.
- **The dependency list is corrected from Blueprint §4.1's defective table** — see
  ADR-0016. In short: this package depends on `core-contracts`, `capability-registry`,
  `execution-profile-registry`, `runtime-profiles`, `cost-optimizer`, `prompt-optimizer`,
  `learning`. It does **not** depend on `orchestrator` (that edge runs the other way) or
  `policy-engine` (no real consumer of it in this package).
- **`LearningHookStage` never calls `.record()`.** `ExecutionOutcome` is inherently a
  post-execution artifact (`latencyMs`, `success`, `costUsd`); this stage runs before any
  provider call. It confirms the registry resolves and stops there — see
  `stages/learning-hook-stage.ts`'s doc comment.
- **`StrategyDecision` is genuinely, deeply immutable** — every plain object and array
  reachable from it (`requiredCapabilities`, `executionProfile` and its own nested
  `inference`/`retryPolicy`/`streaming`/`structuredOutput`/`caching`/`adjustedBy` objects and
  `preferredModelClasses`/`retryableErrorCodes` arrays, `optimizations` and its `cost`/
  `prompt` objects and `prompt.messages`/`prompt.transformationsApplied` arrays, `cacheHit`)
  is walked and `Object.freeze`d depth-first by `deepFreeze` before the decision is returned
  from `DefaultStrategyPipeline.run` — not just the top one or two levels. (An earlier
  revision of this package only froze `decision` and `decision.optimizations`, leaving every
  other nested object mutable despite this note's claim otherwise — flagged by the EM-8
  Independent Architecture & Engineering Review, Finding 1, and corrected in
  `strategy-pipeline.ts`'s `deepFreeze`.)
- **Provider-agnostic and domain-agnostic**, structurally: no dependency in this package's
  corrected list touches a concrete provider (`providers/groq`, `providers/nvidia-nim`,
  `provider-sdk`) or any business-domain package, and `buildStrategy` never branches on a
  `providerId`/`modelId` or business concept.

## Testing

Unit tests for all six stages independently, an integration test for the full pipeline
(including immutability, determinism, and a provider-name-absence check), and a wrapper
test for `DefaultAIStrategyLayer`. The most important test for this milestone — the
Pass-through Regression (`enableStrategyLayer` OFF vs. ON producing an identical
`ExecutionPlan`) — lives in `@ai-gateway/orchestrator`'s test suite
(`test/strategy-layer-integration.test.ts`) and `@ai-gateway/gateway-runtime`'s end-to-end
suite, since it's inherently a statement about the _integration_, not about this package
in isolation.

## Relationship to `orchestrator`/`policy-engine`

`orchestrator` depends on this package (ADR-0016) and calls `buildStrategy` once per
request when `strategyLayer` is injected (which `gateway-runtime`'s `bootstrap()` does
conditionally, based on `GatewayConfig.enableStrategyLayer`, ADR-0017). A `cacheHit` on the
resulting decision short-circuits the Policy Engine and provider call entirely (architecture
§30.3/§33.4); otherwise the decision is threaded into `PolicyContext.strategyDecision`
(ADR-0018) before `orchestrator` calls the same, unchanged `policyEngine.selectExecutionPlan`.
**Corrected from this section's original EM-8-era text:** `policy-engine`'s scoring *did*
start reading `ctx.strategyDecision` as of EM-9 (Independent Architecture & Engineering
Review of EM-9) — `selectExecutionPlan`'s own signature is still unchanged, but several of
its pipeline stages' inputs now come from a well-formed `strategyDecision` when present. See
`@ai-gateway/policy-engine`'s README, "EM-9 Architecture Compliance Notes," for the complete
field-by-field account.

## EM-10: Budget Enforcement

`StrategyLayerOptions` gains an optional `budgetEnforcer` field
(`@ai-gateway/budget-governance`'s `BudgetEnforcer`) — omitted entirely (the default) means
`buildDefaultStages` does not add a `BudgetEnforcementStage` to the pipeline at all, not even
a no-op one, matching every other v1.1/v1.2 addition's "optional and orthogonal to the simple
path" contract (architecture §45.5). When supplied, `BudgetEnforcementStage` runs after
`CostOptimizationStage` and before `LearningHookStage` (architecture §43.3: "the last step of
the Optimization Pipeline ... immediately before the `StrategyDecision` is handed to the
Policy Engine") and either throws a `GatewayError("BUDGET_EXCEEDED", ...)` (blocking the
request before Policy Engine, Credential Resolver, or any Provider Adapter is ever reached)
or folds a forced model-class downgrade into the already-existing
`ctx.costOptimization.recommendedModelClassDowngrade` field. See that stage's own doc comment,
`@ai-gateway/budget-governance`'s README, and ADR-0025 for what this milestone does *not* wire
up (`forcedProviderExclusion` has no carrier to Policy Engine yet) and why.

## Dependencies

`@ai-gateway/core-contracts`, `@ai-gateway/capability-registry`,
`@ai-gateway/execution-profile-registry`, `@ai-gateway/runtime-profiles`,
`@ai-gateway/cost-optimizer`, `@ai-gateway/prompt-optimizer`,
`@ai-gateway/learning`, and `@ai-gateway/budget-governance` (all
`workspace:*`) — this package is the integration point for every EM-6/
EM-7 foundation package (`plugin-system` is the one EM-7 package this
package does **not** depend on or wire in; see that package's README).
`orchestrator` depends on this package, not the reverse (ADR-0016) — see
"Relationship to `orchestrator`/`policy-engine`," above.

## Architecture reference

Architecture §30 (Strategy Layer) — §30.3 (the frozen `StrategyDecision`
shape and cache-hit short-circuit); §37.4 (Runtime Profile read sites,
partially implemented — see
[ADR-0020](../../docs/adr/0020-runtime-profile-read-sites-gap.md));
§43.3 (Budget Enforcement's pipeline position); §45.5 (the
"optional and orthogonal" contract every v1.1/v1.2 addition follows).
Engineering Blueprint §4.1 (dependency table, with two corrections
tracked in [ADR-0016](../../docs/adr/0016-strategy-layer-dependency-table-correction.md)).
