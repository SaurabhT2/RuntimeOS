import type { ScoringWeights } from "@ai-gateway/policy-engine";
import type { ExecutionOutcome } from "./learning-signal-collector.js";

/** architecture §36.2, verbatim. */
export interface AdaptiveRankingStrategy {
  /** Optional replacement for (or supplement to) the static scoring weights in architecture §13.3. */
  adjustWeights(base: ScoringWeights, history: ExecutionOutcome[]): ScoringWeights;
}

/**
 * The no-op counterpart to `NoopLearningSignalCollector`, shipped as this
 * package's default `AdaptiveRankingStrategy`. Architecture §36.3's own
 * guarantee: "With the default `NoopLearningSignalCollector` and no
 * `AdaptiveRankingStrategy` configured, v1.1's routing behavior is
 * byte-for-byte identical to v1.0/Section 13 — this section adds a socket,
 * not a behavior change." Not named explicitly in architecture §36.2's code
 * block (only `NoopLearningSignalCollector` is) — this package ships the
 * symmetric no-op for the sibling interface so a caller that wants "the
 * learning extension points, fully inert" can construct one default object
 * for each socket rather than needing to special-case
 * `AdaptiveRankingStrategy | undefined` at every call site. Returns a
 * shallow copy of `base`, not the same reference, so a caller can never
 * accidentally observe strategy-vs-no-strategy divergence via object
 * identity — only via the (verified-identical) field values.
 */
export class NoopAdaptiveRankingStrategy implements AdaptiveRankingStrategy {
  adjustWeights(base: ScoringWeights, _history: ExecutionOutcome[]): ScoringWeights {
    return { ...base };
  }
}
