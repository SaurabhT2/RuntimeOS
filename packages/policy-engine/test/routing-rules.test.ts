import { describe, expect, it } from "vitest";
import {
  applyPrioritization,
  preferredProvidersRule,
  rankCandidates,
} from "../src/routing-rules.js";
import { DEFAULT_SCORING_WEIGHTS } from "../src/types.js";
import type { PolicyContext, ScoredCandidate } from "../src/types.js";

function candidate(overrides: Partial<ScoredCandidate>): ScoredCandidate {
  return {
    providerId: "groq",
    modelId: "m",
    modelClass: "fast-extraction",
    score: 0.5,
    breakdown: { quality: 0, latency: 0, cost: 0, health: 0, rateLimitPenalty: 0 },
    contextWindow: 32_000,
    structuredOutput: true,
    toolCalling: false,
    streaming: true,
    ...overrides,
  };
}

describe("applyPrioritization", () => {
  it("returns the same weights unchanged when no prioritization is requested", () => {
    expect(applyPrioritization(DEFAULT_SCORING_WEIGHTS, undefined)).toEqual(
      DEFAULT_SCORING_WEIGHTS,
    );
  });

  it("boosts exactly the prioritized weight, leaving the others untouched", () => {
    const boosted = applyPrioritization(DEFAULT_SCORING_WEIGHTS, "cost");
    expect(boosted.cost).toBeGreaterThan(DEFAULT_SCORING_WEIGHTS.cost);
    expect(boosted.quality).toBe(DEFAULT_SCORING_WEIGHTS.quality);
    expect(boosted.latency).toBe(DEFAULT_SCORING_WEIGHTS.latency);
    expect(boosted.health).toBe(DEFAULT_SCORING_WEIGHTS.health);
  });
});

describe("preferredProvidersRule", () => {
  it("does not apply when routingOverride has no preferredProviders", () => {
    expect(preferredProvidersRule.applies({})).toBe(false);
    expect(preferredProvidersRule.applies({ routingOverride: {} })).toBe(false);
  });

  it("applies when preferredProviders is non-empty", () => {
    expect(
      preferredProvidersRule.applies({ routingOverride: { preferredProviders: ["groq"] } }),
    ).toBe(true);
  });

  it("boosts only the preferred provider's candidates", () => {
    const ctx: PolicyContext = { routingOverride: { preferredProviders: ["nvidia-nim"] } };
    const candidates = [
      candidate({ providerId: "groq", score: 0.5 }),
      candidate({ providerId: "nvidia-nim", score: 0.4 }),
    ];
    const result = preferredProvidersRule.apply(candidates, ctx);
    expect(result.find((c) => c.providerId === "groq")!.score).toBe(0.5);
    expect(result.find((c) => c.providerId === "nvidia-nim")!.score).toBeGreaterThan(0.4);
  });
});

describe("rankCandidates", () => {
  it("sorts candidates by score, descending", () => {
    const candidates = [
      candidate({ providerId: "a", score: 0.2 }),
      candidate({ providerId: "b", score: 0.8 }),
    ];
    const ranked = rankCandidates(candidates, {}, []);
    expect(ranked.map((c) => c.providerId)).toEqual(["b", "a"]);
  });

  it("applies only rules whose applies() returns true for the given context", () => {
    const candidates = [
      candidate({ providerId: "groq", score: 0.5 }),
      candidate({ providerId: "nvidia-nim", score: 0.4 }),
    ];
    const rankedWithoutOverride = rankCandidates(candidates, {}, [preferredProvidersRule]);
    expect(rankedWithoutOverride.map((c) => c.providerId)).toEqual(["groq", "nvidia-nim"]);

    const rankedWithOverride = rankCandidates(
      candidates,
      { routingOverride: { preferredProviders: ["nvidia-nim"] } },
      [preferredProvidersRule],
    );
    expect(rankedWithOverride[0]!.providerId).toBe("nvidia-nim");
  });

  it("can reorder the field via a custom rule that vetoes a candidate outright", () => {
    const vetoRule = {
      name: "veto-groq",
      applies: () => true,
      apply: (candidates: ScoredCandidate[]) => candidates.filter((c) => c.providerId !== "groq"),
    };
    const candidates = [
      candidate({ providerId: "groq", score: 0.9 }),
      candidate({ providerId: "nvidia-nim", score: 0.1 }),
    ];
    const ranked = rankCandidates(candidates, {}, [vetoRule]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.providerId).toBe("nvidia-nim");
  });
});
