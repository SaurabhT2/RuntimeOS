import {
  NoopAdaptiveRankingStrategy,
  type AdaptiveRankingStrategy,
} from "./adaptive-ranking-strategy.js";
import {
  NoopLearningSignalCollector,
  type LearningSignalCollector,
} from "./learning-signal-collector.js";

/**
 * architecture §36's "registration mechanism" (Blueprint §7 EM-7 scope
 * list). Not itself named as a type in architecture §36.2's code block —
 * that section defines the two interfaces and the one shipped no-op
 * implementation; a registration mechanism for *swapping in* a non-default
 * implementation is Blueprint-level scope this package must still provide
 * (Blueprint §7: "registration mechanism" is a named deliverable). Designed,
 * not specified: a small mutable holder, defaulting to both no-op
 * implementations, matching the same "registered the same way any
 * `RoutingRule` or scoring strategy is" language architecture §36.3 uses —
 * i.e. a plain settable reference, not a multi-strategy list (there is
 * exactly one active collector and one active strategy at a time, mirroring
 * `policy-engine`'s own single-active-weights model).
 *
 * This package never reaches into `policy-engine` to install itself —
 * architecture §36.3's wiring ("the `ModelScorer` calls `adjustWeights`...
 * immediately before applying its weighted formula") is `strategy-layer`'s
 * job (Wave 8, EM-8), not this package's. `LearningRegistry` only holds
 * the active implementations; nothing in this package or `policy-engine`
 * consults it yet.
 *
 * Independent Engineering Review of EM-7, Issue #7 (Minor): architecture
 * §36.3 phrases a future consumer's check as a presence/absence condition
 * — "the `ModelScorer` calls `adjustWeights` (**if** a non-default strategy
 * is configured)" — which maps naturally to `AdaptiveRankingStrategy |
 * undefined`. `getRankingStrategy()`/`getSignalCollector()` deliberately
 * keep returning a concrete, never-`undefined` object (so every caller,
 * including this package's own tests, can call `.record()`/`.adjustWeights()`
 * without a null check) — but `hasCustomRankingStrategy()`/
 * `hasCustomSignalCollector()` are added so a future EM-8 consumer can
 * still answer architecture §36.3's actual question ("is a non-default
 * strategy configured?") directly, without resorting to an `instanceof
 * NoopAdaptiveRankingStrategy` check against this package's own internals.
 */
export interface LearningRegistry {
  getSignalCollector(): LearningSignalCollector;
  setSignalCollector(collector: LearningSignalCollector): void;
  /** architecture §36.3's actual gating question, answered directly rather than requiring an `instanceof` check against this package's default implementation. */
  hasCustomSignalCollector(): boolean;
  getRankingStrategy(): AdaptiveRankingStrategy;
  setRankingStrategy(strategy: AdaptiveRankingStrategy): void;
  /** architecture §36.3: "if a non-default strategy is configured." */
  hasCustomRankingStrategy(): boolean;
  /** Resets both sockets back to their shipped no-op defaults. */
  reset(): void;
}

export class DefaultLearningRegistry implements LearningRegistry {
  private collector: LearningSignalCollector = new NoopLearningSignalCollector();
  private strategy: AdaptiveRankingStrategy = new NoopAdaptiveRankingStrategy();
  private customCollector = false;
  private customStrategy = false;

  getSignalCollector(): LearningSignalCollector {
    return this.collector;
  }

  setSignalCollector(collector: LearningSignalCollector): void {
    this.collector = collector;
    this.customCollector = true;
  }

  hasCustomSignalCollector(): boolean {
    return this.customCollector;
  }

  getRankingStrategy(): AdaptiveRankingStrategy {
    return this.strategy;
  }

  setRankingStrategy(strategy: AdaptiveRankingStrategy): void {
    this.strategy = strategy;
    this.customStrategy = true;
  }

  hasCustomRankingStrategy(): boolean {
    return this.customStrategy;
  }

  reset(): void {
    this.collector = new NoopLearningSignalCollector();
    this.strategy = new NoopAdaptiveRankingStrategy();
    this.customCollector = false;
    this.customStrategy = false;
  }
}
