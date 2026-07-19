/**
 * @ai-gateway/prompt-optimizer
 *
 * A stage of the AI Strategy Layer's Optimization Pipeline (architecture
 * §34): a small, ordered pipeline of independently-testable
 * `PromptTransformer`s (compression, trimming, dedup, normalization,
 * budgeting). Provider-independent — operates purely on the normalized
 * `ChatMessage[]` shape. Transforms prompts only; never calls a provider.
 *
 * STATUS: implemented (Engineering Milestone EM-7, Blueprint §7, §8.17).
 * Not yet wired into `orchestrator`/`cost-optimizer` — that wiring is
 * `strategy-layer`'s job (Wave 8, EM-8).
 *
 * Architecture reference: §34
 *
 * NOTE on the `capability-registry` dependency edge (Blueprint §4.1's
 * table entry for this package): it is not imported anywhere in this
 * package's current code. architecture §34.3's `compressed` row names a
 * `CapabilitySet`-level gate ("where the task's `CapabilitySet` tolerates
 * it") in addition to the profile-id-based exclusion this package actually
 * implements (`EXACT_WORDING_PROFILE_IDS` in `prompt-optimizer.ts`) —
 * `PromptOptimizer.optimize`'s frozen signature (§34.2) never receives a
 * `CapabilitySet`, only a `ResolvedExecutionProfile`, so no capability-level
 * gate is reachable from inside this package today. An earlier draft
 * exported an unused, disconnected `capabilityTolerantOfCompression`
 * helper to exercise this edge speculatively; the Independent Engineering
 * Review of EM-7 (Issue #6) found it was dead code with no caller anywhere
 * in the workspace and it was removed. The dependency edge itself is kept,
 * matching this package's Blueprint §4.1 entry and this codebase's
 * "declare for a real, named future consumer, not for its own sake"
 * precedent (see `@ai-gateway/learning`'s equivalent note on its unused
 * `telemetry` edge) — its future consumer is a `strategy-layer` (EM-8)
 * composition root that has both a `ResolvedExecutionProfile` and the
 * `CapabilitySet` it was resolved from in scope at the same call site, and
 * can apply a capability-level compression gate `optimize()`'s own
 * signature cannot express.
 */

export type {
  TokenBudget,
  OptimizedPrompt,
  PromptTransformationId,
  PromptTransformer,
} from "./types.js";

export { estimateTokens } from "./token-estimator.js";

export {
  normalizedTransformer,
  systemPromptDedupedTransformer,
  duplicatesRemovedTransformer,
  contextTrimmedTransformer,
  longContextWindowedTransformer,
  compressedTransformer,
  DEFAULT_TRANSFORMER_PIPELINE,
} from "./transformers/index.js";

export {
  type PromptOptimizer,
  DefaultPromptOptimizer,
  EXACT_WORDING_PROFILE_IDS,
} from "./prompt-optimizer.js";
