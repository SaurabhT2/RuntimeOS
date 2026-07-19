import { describe, expect, it } from "vitest";
import { NoopLearningSignalCollector } from "../src/learning-signal-collector.js";
import type {
  ExecutionOutcome,
  LearningSignalCollector,
} from "../src/learning-signal-collector.js";

function outcome(overrides: Partial<ExecutionOutcome> = {}): ExecutionOutcome {
  return {
    requestId: "req-1",
    providerId: "groq",
    modelId: "llama-3.1-8b-instant",
    modelClass: "fast-extraction",
    task: "summarization",
    latencyMs: 250,
    success: true,
    costUsd: 0.001,
    ...overrides,
  };
}

describe("NoopLearningSignalCollector — default collector is no-op", () => {
  it("record() returns undefined and throws nothing for a successful outcome", () => {
    const collector: LearningSignalCollector = new NoopLearningSignalCollector();
    expect(() => collector.record(outcome())).not.toThrow();
    expect(collector.record(outcome())).toBeUndefined();
  });

  it("record() has no observable effect for a failure outcome either", () => {
    const collector: LearningSignalCollector = new NoopLearningSignalCollector();
    expect(() =>
      collector.record(
        outcome({ success: false, failureReason: { code: "PROVIDER_UNAVAILABLE" } }),
      ),
    ).not.toThrow();
  });

  it("record() does not mutate the outcome object passed to it", () => {
    const collector: LearningSignalCollector = new NoopLearningSignalCollector();
    const o = outcome();
    const snapshot = JSON.stringify(o);
    collector.record(o);
    expect(JSON.stringify(o)).toBe(snapshot);
  });

  it("record() has no effect regardless of how many times it's called", () => {
    const collector: LearningSignalCollector = new NoopLearningSignalCollector();
    for (let i = 0; i < 100; i += 1) {
      collector.record(outcome({ requestId: `req-${i}` }));
    }
    // No state accumulates anywhere observable — there is nothing to assert
    // beyond "this didn't throw and there is no getter exposing history,"
    // which is itself the guarantee: a no-op collector has no history to leak.
    expect(collector).toBeInstanceOf(NoopLearningSignalCollector);
  });
});
