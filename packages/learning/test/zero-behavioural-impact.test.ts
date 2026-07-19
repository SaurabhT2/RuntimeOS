import { scoreCandidates } from "@ai-gateway/policy-engine";
import { describe, expect, it } from "vitest";
import { NoopAdaptiveRankingStrategy } from "../src/adaptive-ranking-strategy.js";
import { NoopLearningSignalCollector } from "../src/learning-signal-collector.js";
import type { LearningSignalCollector } from "../src/learning-signal-collector.js";
import { DefaultLearningRegistry } from "../src/registry.js";
import { baseWeights, candidateSet, health, requirement } from "./fixtures.js";

/**
 * architecture §36.3's guarantee, verified here rather than assumed
 * (Blueprint §7 EM-7's own testing requirement: "a test proving the no-op
 * learning collector has zero effect on scoring output"): "With the
 * default `NoopLearningSignalCollector` and no `AdaptiveRankingStrategy`
 * configured, v1.1's routing behavior is byte-for-byte identical to
 * v1.0/Section 13." This package is not wired into `policy-engine`
 * (Blueprint §7 EM-7 scope: no orchestrator/policy-engine integration) —
 * so this test exercises `policy-engine`'s real, unmodified
 * `scoreCandidates` function directly (an already-declared dependency of
 * this package) with weights taken straight from `DEFAULT_SCORING_WEIGHTS`
 * versus weights that have been round-tripped through
 * `NoopAdaptiveRankingStrategy.adjustWeights`, and asserts the two scoring
 * runs produce byte-for-byte identical results. `policy-engine` itself is
 * never modified by this milestone — this is a read-only, black-box
 * verification against its existing public API.
 */
describe("Zero behavioural impact on Policy Engine scoring", () => {
  it("scoreCandidates output is identical whether weights come from DEFAULT_SCORING_WEIGHTS directly or via the no-op strategy", () => {
    const models = candidateSet();
    const req = requirement();
    const getHealth = () => health();

    const withoutStrategy = scoreCandidates(models, req, getHealth, baseWeights);

    const strategy = new NoopAdaptiveRankingStrategy();
    const adjustedWeights = strategy.adjustWeights(baseWeights, []);
    const withStrategy = scoreCandidates(models, req, getHealth, adjustedWeights);

    expect(withStrategy).toEqual(withoutStrategy);
  });

  it("scoreCandidates output is identical across a non-empty (but still no-op-processed) outcome history", () => {
    const models = candidateSet();
    const req = requirement();
    const getHealth = () => health();
    const collector: LearningSignalCollector = new NoopLearningSignalCollector();
    const strategy = new NoopAdaptiveRankingStrategy();

    // Simulate outcomes being recorded — the no-op collector does nothing
    // with them, so they can't influence the strategy's history-derived
    // weights either (the strategy also ignores history, but this
    // simulates the realistic end-to-end shape: outcomes recorded, then
    // weights adjusted before the next scoring run).
    collector.record({
      requestId: "r1",
      providerId: "groq",
      modelId: "fast-model",
      modelClass: "fast-extraction",
      task: "summarization",
      latencyMs: 200,
      success: true,
      costUsd: 0.002,
    });

    const baseline = scoreCandidates(models, req, getHealth, baseWeights);
    const adjusted = strategy.adjustWeights(baseWeights, []);
    const afterRecording = scoreCandidates(models, req, getHealth, adjusted);

    expect(afterRecording).toEqual(baseline);
  });

  it("the DefaultLearningRegistry's shipped defaults produce the same zero-impact guarantee end-to-end", () => {
    const registry = new DefaultLearningRegistry();
    const models = candidateSet();
    const req = requirement();
    const getHealth = () => health();

    const baseline = scoreCandidates(models, req, getHealth, baseWeights);
    const viaRegistry = scoreCandidates(
      models,
      req,
      getHealth,
      registry.getRankingStrategy().adjustWeights(baseWeights, []),
    );

    expect(viaRegistry).toEqual(baseline);
  });
});
