# `@ai-gateway/cost-optimizer`

A stage of the AI Strategy Layer's Optimization Pipeline (architecture §33): produces
model-downgrade, streaming, cache, and free-tier-preference optimization **decisions**.
It never talks to a provider directly and never executes routing — it only produces the
`CostOptimizationResult` a future Policy Engine call will consume as a soft signal.

**STATUS:** implemented (Engineering Milestone EM-7, Blueprint §7, §8.17). Not yet wired
into `orchestrator`/`policy-engine` — that wiring is `strategy-layer`'s job (Wave 8, EM-8).

## What this answers (architecture §33.2's table, verbatim intent)

| Question                                       | Answered by                                                      |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| Can this request use a smaller model?          | `recommendedModelClassDowngrade` (`downgrade.ts`)                |
| Does this task require reasoning?              | `reasoningRequired` (`downgrade.ts`)                             |
| Can prompt length be reduced?                  | Delegated to `@ai-gateway/prompt-optimizer` (not this package)   |
| Can cached responses be reused?                | `cacheHit`, via the injected `CacheClient` (`cost-optimizer.ts`) |
| Should streaming be disabled?                  | `disableStreaming` (`streaming.ts`)                              |
| Can we downgrade providers / prefer free tier? | `preferFreeTierProviders`, read from the active Runtime Profile  |

Batching (architecture §33.2's table) is explicitly **not implemented** in this milestone,
per the architecture's own note — a recognized future extension point, not a gap.

## Engineering decisions worth knowing

- **`CachedResult` shape is designed, not specified** — architecture §33.2 names the type
  but never defines its fields. See `types.ts`'s doc comment.
- **Cache key derivation is a documented proxy — and unsafe to use verbatim in EM-8.**
  `OptimizationContext` (frozen verbatim per this milestone's scope) carries a token
  estimate, not raw prompt content, so `deriveCacheKey` builds a
  `task:profile.id:promptTokenEstimate` key rather than a true content hash. This key is
  collision-prone by construction (Independent Engineering Review of EM-7, Issue #10):
  harmless today since nothing calls `optimize()` from a live request path, but whoever
  wires this into `strategy-layer` (EM-8) must replace it with a real content hash first.
  See `cost-optimizer.ts`'s doc comment on `deriveCacheKey` for the full reasoning.
- **Cost/savings figures are illustrative, not billing-accurate** — this package has no
  dependency on `model-registry` (Blueprint §4.1's table), so real per-model $/1K-token
  rates aren't available here. `pricing.ts`'s coarse per-model-class table exists only to
  produce a directionally-correct estimate, the same trade-off architecture §34.4 makes for
  token estimation and for the identical reason.
- **Downgrade recommendation is a soft signal only** — never a hard override (architecture
  §33.2's own table row). This package's own logic additionally never _produces_ a
  downgrade recommendation that would contradict a hard capability requirement it has
  direct knowledge of (`reasoningDepth: "deep"`, `structuredOutput`, `toolCalling` — see
  `downgrade.ts`, and the Independent Engineering Review of EM-7, Issue #2, which found and
  closed a gap where only `reasoningDepth` was checked). The Policy Engine's Candidate
  Query (architecture §13.2) remains the actual hard-correctness enforcement point once
  this package is wired into the pipeline (EM-8) — this package's guarantee is about what
  it recommends, not about filtering the full candidate space.

## Testing

- Unit tests per downgrade/streaming/pricing rule, independently of the `CostOptimizer` class.
- End-to-end `DefaultCostOptimizer.optimize()` tests covering Runtime Profile consumption,
  cache hit/miss, and cost/savings estimation.
- Capability-preservation and "no invalid downgrade" tests specifically verifying the
  `DECIDE` node's guarantee from architecture §33.3: a deep reasoning need, a
  `structuredOutput` requirement, and a `toolCalling` requirement are each independently
  never downgraded away from, regardless of what other heuristic inputs suggest —
  matching §33.3's own named example (structured output) exactly, not just the
  `reasoningDepth` case.

## Relationship to `orchestrator`/`strategy-layer`

**Now wired in as of EM-8** (this note previously said "not wired in...
a future `strategy-layer` composition root (EM-8) constructs it" — EM-8
has since shipped and done exactly that; corrected here during the v1.2
documentation pass rather than left to mislead a reader into thinking
this is still pending). `DefaultCostOptimizer` remains a pure, injectable
class with no dependency of its own on `orchestrator` or `strategy-layer`
(see "Dependencies," below) — `packages/strategy-layer/src/strategy-layer.ts`
constructs it, supplies a real `CacheClient` backend, and calls
`optimize()` once per request between Execution Profile resolution and
the Policy Engine, exactly as architecture §33.1 describes. This only
takes effect when the Strategy Layer itself is enabled
(`enableStrategyLayer: true` — see `docs/release/DEPLOYMENT.md`); with
the flag off, this package is present but never invoked.

## Dependencies

`@ai-gateway/capability-registry`, `@ai-gateway/execution-profile-registry`,
and `@ai-gateway/runtime-profiles` (all `workspace:*`) — used to read the
capability set, execution profile, and runtime profile a given request
resolves to before deciding whether/how to downgrade it. No dependency on
`orchestrator`, `strategy-layer`, or `policy-engine` in either direction —
consistent with "Relationship to `orchestrator`/`strategy-layer`," above:
this package is called, it does not call out.

## Architecture reference

Architecture §33 (Cost Optimization Engine) — §33.1 (pipeline
placement), §33.2 (the table this README's "What this answers" section
quotes), §33.3 (the never-downgrade-below-capability guarantee tested
in "Testing," above); §34.4 (interaction with Prompt Optimization);
§13.2 (interaction with response caching). Engineering Blueprint §4.1
(dependency table) and §7 (EM-7 scope).
