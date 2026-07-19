# `@ai-gateway/learning`

Intelligent Learning extension points (architecture §36): `LearningSignalCollector`,
`AdaptiveRankingStrategy`, and their no-op-by-default implementations. **No machine
learning and no adaptive ranking logic is implemented here** — this package is sockets
only (architecture §36.1).

**STATUS:** implemented (Engineering Milestone EM-7, Blueprint §7, §8.18). Not consulted
by `policy-engine` yet — that wiring (the `ModelScorer` calling `adjustWeights` when a
non-default strategy is configured, architecture §36.3) is `strategy-layer`'s job
(Wave 8, EM-8).

## What's here

| File                           | Provides                                                                                                                                                                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `learning-signal-collector.ts` | `ExecutionOutcome`, `LearningSignalCollector`, `NoopLearningSignalCollector` (architecture §36.2, verbatim).                                                                                                                                                                    |
| `adaptive-ranking-strategy.ts` | `AdaptiveRankingStrategy` (architecture §36.2, verbatim) and `NoopAdaptiveRankingStrategy` — the symmetric no-op this package ships for the sibling interface (not itself named in §36.2's code block, but required by the "zero behavioral effect" guarantee §36.3 describes). |
| `registry.ts`                  | `LearningRegistry`/`DefaultLearningRegistry` — the registration mechanism (Blueprint §7 EM-7's named deliverable), a settable holder defaulting to both no-op implementations.                                                                                                  |

## Engineering decisions worth knowing

- **`task`/`failureReason` fields are locally narrowed types**, not imports of
  `core-contracts`' `TaskType`/`reliability`'s `FailureReason` — this package's Blueprint
  §4.1 dependency edges are `telemetry`, `policy-engine` only. See
  `learning-signal-collector.ts`'s doc comment.
- **The `telemetry` dependency edge is currently unused in code**, and that's intentional,
  not an oversight (Independent Engineering Review of EM-7, Issue #4): it's kept for the
  concrete future consumer architecture §36.2 anticipates — a real, non-default
  `LearningSignalCollector` a deployment registers to forward `ExecutionOutcome`s to a
  metrics backend. The shipped `NoopLearningSignalCollector` has nothing to send.
- **`LearningRegistry` is designed, not specified** — architecture §36.2 doesn't name a
  registration-mechanism type; Blueprint §7 EM-7 lists "registration mechanism" as a
  deliverable without further detail. A single settable collector + strategy pair,
  mirroring architecture §36.3's "registered the same way any `RoutingRule` or scoring
  strategy is" language (one active implementation at a time, not a list).
- **This package never reaches into `policy-engine` to install itself.** `LearningRegistry`
  only holds the active implementations; nothing in `policy-engine` consults it. That
  wiring is explicitly out of this milestone's scope (EM-8).

## Testing — the zero-behavioral-impact guarantee, verified not assumed

`test/zero-behavioural-impact.test.ts` is the test Blueprint §7 EM-7 names explicitly:
"a test proving the no-op learning collector has zero effect on scoring output." Since this
package isn't wired into `policy-engine`, the test instead calls `policy-engine`'s real,
unmodified `scoreCandidates` export directly (an already-declared dependency) — once with
`DEFAULT_SCORING_WEIGHTS` untouched, once with weights round-tripped through
`NoopAdaptiveRankingStrategy.adjustWeights` — and asserts the two scoring runs produce
byte-for-byte identical `ScoredCandidate[]` output. `policy-engine` itself is never
modified; this is a read-only, black-box verification against its existing public API,
consistent with this milestone's "no changes to Policy Engine behavior" constraint.

Fixture note: this package has no `model-registry`/`reliability` dependency edge, so
`test/fixtures.ts` derives the `ModelDescriptor`/`ProviderHealthSnapshot` shapes
structurally from `policy-engine`'s own already-declared `scoreCandidates` export
(`Parameters<typeof scoreCandidates>[...]`) rather than importing those packages directly.

## Relationship to `orchestrator`/`policy-engine`

Not wired in. A future `strategy-layer` composition root (EM-8) is the one that, per
architecture §36.3, has the `ModelScorer` call `adjustWeights` immediately before applying
its weighted formula, if and only if a non-default `AdaptiveRankingStrategy` has been
registered — with the shipped no-op default, v1.1's routing behavior stays byte-for-byte
identical to v1.0.
