import { describe, expect, it } from "vitest";
import { SEED_MODELS } from "@ai-gateway/model-registry";
import type { ProviderHealthSnapshot } from "@ai-gateway/reliability";
import {
  healthScore,
  normalize,
  qualityScoreForTask,
  rateLimitPenalty,
  scoreCandidate,
  scoreCandidates,
} from "../src/model-scorer.js";
import { DEFAULT_SCORING_WEIGHTS } from "../src/types.js";
import type { CapabilityRequirement } from "../src/types.js";

const reasoningModel = SEED_MODELS.find(
  (m) => m.modelClass === "complex-reasoning" && m.providerId === "groq",
)!;
const creativeModel = SEED_MODELS.find((m) => m.modelClass === "creative")!;

function requirement(overrides: Partial<CapabilityRequirement> = {}): CapabilityRequirement {
  return {
    requiresJsonMode: false,
    requiresToolCalling: false,
    requiresStreaming: false,
    creativityAffinity: 0.3,
    reasoningAffinity: 0.3,
    ...overrides,
  };
}

function healthy(): ProviderHealthSnapshot {
  return {
    providerId: "groq",
    healthy: true,
    lastCheckedAt: new Date().toISOString(),
    consecutiveFailures: 0,
  };
}

describe("normalize", () => {
  it("maps min to 0 and max to 1", () => {
    expect(normalize(10, 10, 20)).toBe(0);
    expect(normalize(20, 10, 20)).toBe(1);
    expect(normalize(15, 10, 20)).toBe(0.5);
  });

  it("returns 1 for a degenerate (equal min/max) range", () => {
    expect(normalize(5, 5, 5)).toBe(1);
  });
});

describe("healthScore", () => {
  it("scores a fully healthy provider at 1", () => {
    expect(healthScore(healthy())).toBe(1);
  });

  it("degrades score with consecutive failures while still healthy", () => {
    const snapshot: ProviderHealthSnapshot = { ...healthy(), consecutiveFailures: 2 };
    expect(healthScore(snapshot)).toBeCloseTo(0.6, 5);
  });

  it("floors an unhealthy provider at a small positive score, never zero", () => {
    const snapshot: ProviderHealthSnapshot = {
      ...healthy(),
      healthy: false,
      consecutiveFailures: 10,
    };
    expect(healthScore(snapshot)).toBe(0.05);
    expect(healthScore(snapshot)).toBeGreaterThan(0);
  });
});

describe("rateLimitPenalty", () => {
  it("penalizes a lower requestsPerMinute ceiling more than a higher one", () => {
    const lowRpm = {
      ...reasoningModel,
      availability: { ...reasoningModel.availability, rateLimits: { requestsPerMinute: 30 } },
    };
    const highRpm = {
      ...reasoningModel,
      availability: { ...reasoningModel.availability, rateLimits: { requestsPerMinute: 6000 } },
    };
    expect(rateLimitPenalty(lowRpm)).toBeGreaterThan(rateLimitPenalty(highRpm));
  });

  it("returns 0 when no requestsPerMinute is configured", () => {
    const noLimit = {
      ...reasoningModel,
      availability: { ...reasoningModel.availability, rateLimits: {} },
    };
    expect(rateLimitPenalty(noLimit)).toBe(0);
  });

  it("caps the penalty at 0.2", () => {
    const tiny = {
      ...reasoningModel,
      availability: { ...reasoningModel.availability, rateLimits: { requestsPerMinute: 1 } },
    };
    expect(rateLimitPenalty(tiny)).toBeLessThanOrEqual(0.2);
  });
});

describe("qualityScoreForTask", () => {
  it("scores a deep-reasoning model higher for a reasoning-affinity task than a shallow model", () => {
    const fastExtraction = SEED_MODELS.find(
      (m) => m.modelClass === "fast-extraction" && m.providerId === "groq",
    )!;
    const req = requirement({ reasoningAffinity: 0.9, creativityAffinity: 0.1 });
    expect(qualityScoreForTask(reasoningModel, req)).toBeGreaterThan(
      qualityScoreForTask(fastExtraction, req),
    );
  });

  it("scores a high-creativity model higher for a creativity-affinity task", () => {
    const req = requirement({ reasoningAffinity: 0.1, creativityAffinity: 0.9 });
    expect(qualityScoreForTask(creativeModel, req)).toBeGreaterThan(
      qualityScoreForTask(reasoningModel, req),
    );
  });

  it("adds a structured-output bonus when required and supported", () => {
    const req = requirement({ requiresJsonMode: true });
    const withBonus = qualityScoreForTask(reasoningModel, req);
    const withoutBonus = qualityScoreForTask(reasoningModel, { ...req, requiresJsonMode: false });
    expect(withBonus).toBeGreaterThan(withoutBonus);
  });

  it("falls back to a neutral 0.5 blend when both affinities are zero (degenerate case)", () => {
    const req = requirement({ reasoningAffinity: 0, creativityAffinity: 0 });
    expect(qualityScoreForTask(reasoningModel, req)).toBe(0.5);
  });

  it("never exceeds 1", () => {
    const req = requirement({
      requiresJsonMode: true,
      reasoningAffinity: 1,
      creativityAffinity: 1,
    });
    expect(qualityScoreForTask(reasoningModel, req)).toBeLessThanOrEqual(1);
  });
});

describe("scoreCandidate / scoreCandidates", () => {
  it("returns an empty array for an empty candidate set", () => {
    expect(scoreCandidates([], requirement(), () => healthy(), DEFAULT_SCORING_WEIGHTS)).toEqual(
      [],
    );
  });

  it("produces a breakdown whose weighted sum (minus the penalty) equals the total score", () => {
    const scored = scoreCandidate({
      model: reasoningModel,
      requirement: requirement(),
      health: healthy(),
      weights: DEFAULT_SCORING_WEIGHTS,
      latencyRange: { min: 100, max: 1000 },
      costRange: { min: 0, max: 1 },
    });
    const w = DEFAULT_SCORING_WEIGHTS;
    const expected =
      w.quality * scored.breakdown.quality +
      w.latency * scored.breakdown.latency +
      w.cost * scored.breakdown.cost +
      w.health * scored.breakdown.health -
      scored.breakdown.rateLimitPenalty;
    expect(scored.score).toBeCloseTo(expected, 10);
  });

  it("ranks a lower-latency model higher than a higher-latency one, all else equal, when latency is weighted", () => {
    const fast = {
      ...reasoningModel,
      providerId: "fast",
      performance: { ...reasoningModel.performance, p50LatencyMs: 100 },
    };
    const slow = {
      ...reasoningModel,
      providerId: "slow",
      performance: { ...reasoningModel.performance, p50LatencyMs: 900 },
    };
    const scored = scoreCandidates([fast, slow], requirement(), () => healthy(), {
      quality: 0,
      latency: 1,
      cost: 0,
      health: 0,
    });
    const fastScore = scored.find((c) => c.providerId === "fast")!.score;
    const slowScore = scored.find((c) => c.providerId === "slow")!.score;
    expect(fastScore).toBeGreaterThan(slowScore);
  });

  it("ranks a healthier provider higher than a struggling one when only health is weighted", () => {
    const good = { ...reasoningModel, providerId: "good" };
    const bad = { ...reasoningModel, providerId: "bad" };
    const scored = scoreCandidates(
      [good, bad],
      requirement(),
      (providerId) =>
        providerId === "bad"
          ? {
              providerId,
              healthy: false,
              consecutiveFailures: 5,
              lastCheckedAt: new Date().toISOString(),
            }
          : healthy(),
      { quality: 0, latency: 0, cost: 0, health: 1 },
    );
    const goodScore = scored.find((c) => c.providerId === "good")!.score;
    const badScore = scored.find((c) => c.providerId === "bad")!.score;
    expect(goodScore).toBeGreaterThan(badScore);
  });
});
