/**
 * @ai-gateway/learning
 *
 * Intelligent Learning extension points (architecture §36): interfaces a
 * future, optional, pluggable component can implement, shipped with a
 * static/no-op default so v1.1's behavior today is fully deterministic and
 * auditable. No machine learning, and no adaptive ranking logic, is
 * implemented in this package — sockets only (architecture §36.1).
 *
 * STATUS: implemented (Engineering Milestone EM-7, Blueprint §7, §8.18).
 * Not consulted by `policy-engine` yet — that wiring (the `ModelScorer`
 * calling `adjustWeights` when a non-default strategy is configured,
 * architecture §36.3) is `strategy-layer`'s job (Wave 8, EM-8).
 *
 * Architecture reference: §36
 */

export {
  type ExecutionOutcome,
  type LearningSignalCollector,
  NoopLearningSignalCollector,
} from "./learning-signal-collector.js";

export {
  type AdaptiveRankingStrategy,
  NoopAdaptiveRankingStrategy,
} from "./adaptive-ranking-strategy.js";

export { type LearningRegistry, DefaultLearningRegistry } from "./registry.js";
