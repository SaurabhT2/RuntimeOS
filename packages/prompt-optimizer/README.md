# `@ai-gateway/prompt-optimizer`

A stage of the AI Strategy Layer's Optimization Pipeline (architecture §34): a small,
ordered pipeline of independently-testable `PromptTransformer`s. Provider-independent —
operates purely on the normalized `ChatMessage[]` shape, so it runs identically regardless
of which provider the Policy Engine eventually selects. Transforms prompts only; never
calls a provider.

**STATUS:** implemented (Engineering Milestone EM-7, Blueprint §7, §8.17). Not yet wired
into `orchestrator`/`cost-optimizer` — that wiring is `strategy-layer`'s job (Wave 8, EM-8).

## The six transformers (architecture §34.3, table order)

| Transformer             | File                                    | Responsibility                                                                         |
| ----------------------- | --------------------------------------- | -------------------------------------------------------------------------------------- |
| `normalized`            | `transformers/normalized.ts`            | Whitespace/encoding normalization — always first.                                      |
| `system_prompt_deduped` | `transformers/system-prompt-deduped.ts` | Drops repeated identical system prompts within a request.                              |
| `duplicates_removed`    | `transformers/duplicates-removed.ts`    | Drops exact-duplicate `(role, content)` message pairs.                                 |
| `context_trimmed`       | `transformers/context-trimmed.ts`       | Drops oldest non-system turns once over `budget.maxInputTokens`.                       |
| `long_context_windowed` | `transformers/long-context-windowed.ts` | Head+tail windows a single very-large message rather than truncating.                  |
| `compressed`            | `transformers/compressed.ts`            | Strips filler/hedging phrasing — **excluded for `coding`/`json_generation` profiles.** |

`DEFAULT_TRANSFORMER_PIPELINE` (`transformers/index.ts`) runs them in the order above.
`DefaultPromptOptimizer.optimize()` (`prompt-optimizer.ts`) is the only place profile-based
exclusion happens — `PromptTransformer.apply` (architecture §34.2) never receives a
`ResolvedExecutionProfile`, only the token budget, so exclusion is necessarily a pipeline-
orchestration concern, not something an individual transformer decides for itself.

## Engineering decisions worth knowing

- **Dependency on `execution-profile-registry` is a documented deviation from Blueprint
  §4.1's literal table** (which lists only `capability-registry, core-contracts`).
  Architecture §34.2's frozen `PromptOptimizer.optimize` signature takes a
  `profile: ResolvedExecutionProfile` parameter — `execution-profile-registry`'s own
  exported type — so implementing that interface verbatim requires this edge. Resolved the
  same way EM-6 resolved its own architecture-spec-vs-Blueprint tension (§31.4/§37.2 field
  naming): followed the more specific, directly-binding source (the frozen interface) over
  the summary table, and flagged the deviation explicitly rather than silently absorbing it
  or breaking the interface. See `prompt-optimizer.ts`'s doc comment and
  `.dependency-cruiser.cjs`'s `prompt-optimizer` entry.
- **`compressed`'s exclusion list is exactly `{coding, json_generation}`** — architecture
  §34.3 names these as _examples_ ("profiles like...") of exact-wording-matters profiles,
  not an exhaustive rule. This milestone implements exactly what's named (Blueprint §7 EM-7:
  "tested explicitly for the `coding`/`json_generation` profiles") rather than speculatively
  guessing at other exclusions. architecture §34.3 also names a complementary
  `CapabilitySet`-level judgment ("where the task's `CapabilitySet` tolerates it"), but
  `optimize()`'s frozen signature (§34.2) never receives a `CapabilitySet` — only a
  `ResolvedExecutionProfile` — so no capability-level gate is reachable from inside this
  package. An earlier draft exported a disconnected helper to exercise this anyway; the
  Independent Engineering Review of EM-7 found it was dead code and it was removed (see
  `index.ts`'s doc comment for the full note, including why the `capability-registry`
  dependency edge itself is kept regardless).
- **`estimateTokens` is a ~4-chars-per-token heuristic** (architecture §34.4: "not a
  provider's exact tokenizer... good enough to drive trimming decisions, not to be
  billing-accurate"). See `token-estimator.ts`.
- **`system_prompt_deduped` only covers within-request duplication**, not the
  cross-request system-prompt cache architecture §34.3 also mentions as an alternative —
  that would require cross-request state this package deliberately doesn't hold (every
  transformer here is pure and stateless). See that file's doc comment.
- **`context_trimmed` treats every `role: "system"` message as "must keep"** — the closest
  concept `ChatMessage` (architecture §10.3) has to an explicit priority marker.

## Testing

- Every transformer has its own independent test file (`test/transformers/*.test.ts`),
  proving its specific responsibility in isolation from the pipeline.
- `test/prompt-optimizer.test.ts` covers the Blueprint §7 EM-7 requirements end-to-end:
  measurable token reduction on a redundant-content fixture, `coding`/`json_generation`
  bypass of `compressed`, and exact-output preservation (a `coding`-profile fixture survives
  byte-for-byte aside from whitespace normalization, which is safe for every profile).

## Relationship to `orchestrator`/`strategy-layer`

**Now wired in and actually invoked as of EM-8** (this note previously
said "not wired in... a future `strategy-layer` composition root (EM-8)
calls `optimize()`" — EM-8 has since shipped and does exactly that;
corrected here during the v1.2 documentation pass). Confirmed by
inspection: `packages/strategy-layer/src/strategy-layer.ts` constructs a
`PromptOptimizationStage` wrapping the injected `PromptOptimizer`, and
that stage's `run()` genuinely calls `this.optimizer.optimize(messages,
budget, ctx.executionProfile)` — this is not socket-wiring-only, unlike
`@ai-gateway/learning`'s stage (see that package's README). `optimize()`
runs upstream of the Cost Optimizer reading back a final token estimate
(architecture §34.1), and the `OptimizedPrompt.messages` it returns
become the eventual `NormalizedInvocation.messages` (architecture §12.1)
every provider receives — but only when the Strategy Layer itself is
enabled (`enableStrategyLayer: true`); with the flag off, this package is
present but never invoked.

## Dependencies

`@ai-gateway/capability-registry`, `@ai-gateway/core-contracts`, and
`@ai-gateway/execution-profile-registry` (all `workspace:*`). The
dependency on `execution-profile-registry` is real but was not reflected
in Engineering Blueprint §4.1's dependency table at the time it was
introduced — see [ADR-0014](../../docs/adr/0014-prompt-optimizer-execution-profile-registry-dependency-gap.md),
which documents this exact gap and remains open pending an Architecture
Review Board decision on whether to correct the table. No dependency on
`orchestrator` or `strategy-layer` in either direction — this package is
called, it does not call out.

## Architecture reference

Architecture §34 (Prompt Optimization Pipeline) — §34.1 (pipeline
placement, upstream of Cost Optimizer), §34.2/§34.3 (the six
transformers this README's own section above documents), §34.4
(interaction with Cost Optimization); §12.1
(`NormalizedInvocation.messages`); §10.3 (token-budget context this
package reads from). Engineering Blueprint §7 (EM-7 scope).
