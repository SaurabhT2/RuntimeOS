import { describe, expect, it } from "vitest";
import { DefaultModelRegistry, SEED_MODELS } from "@ai-gateway/model-registry";
import { queryCandidates } from "../src/candidate-query.js";
import type { CapabilityRequirement } from "../src/types.js";

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

describe("queryCandidates", () => {
  it("returns every enabled seed model when the requirement is unconstrained", async () => {
    const registry = new DefaultModelRegistry({ seed: SEED_MODELS });
    const candidates = await queryCandidates(registry, requirement());
    expect(candidates).toHaveLength(SEED_MODELS.length);
  });

  it("filters out models lacking structured output when JSON mode is required", async () => {
    const registry = new DefaultModelRegistry({ seed: SEED_MODELS });
    const candidates = await queryCandidates(registry, requirement({ requiresJsonMode: true }));
    expect(candidates.every((m) => m.capabilities.structuredOutput)).toBe(true);
    // groq-creative-v1 declares structuredOutput: false in the seed data.
    expect(candidates.some((m) => m.modelId === "groq-creative-v1")).toBe(false);
  });

  it("filters out models lacking tool calling when tool calling is required", async () => {
    const registry = new DefaultModelRegistry({ seed: SEED_MODELS });
    const candidates = await queryCandidates(registry, requirement({ requiresToolCalling: true }));
    expect(candidates.every((m) => m.capabilities.toolCalling)).toBe(true);
    expect(
      candidates.some((m) => m.providerId === "groq" && m.modelClass === "fast-extraction"),
    ).toBe(false);
  });

  it("filters out models below a minContextTokens floor", async () => {
    const registry = new DefaultModelRegistry({ seed: SEED_MODELS });
    const candidates = await queryCandidates(registry, requirement({ minContextTokens: 100_000 }));
    expect(candidates.every((m) => m.capabilities.contextWindow >= 100_000)).toBe(true);
  });

  it("filters out non-streaming models when streaming is required (post-registry filter)", async () => {
    const registry = new DefaultModelRegistry({ seed: SEED_MODELS });
    const candidates = await queryCandidates(registry, requirement({ requiresStreaming: true }));
    expect(candidates.every((m) => m.capabilities.streaming)).toBe(true);
  });

  it("filters out models over a maxCostUsd ceiling (post-registry filter)", async () => {
    const registry = new DefaultModelRegistry({ seed: SEED_MODELS });
    const candidates = await queryCandidates(registry, requirement({ maxCostUsd: 0.01 }));
    // Only the free-tier Groq models (outputPer1kTokensUsd: 0) survive.
    expect(candidates.every((m) => m.cost.outputPer1kTokensUsd <= 0.01)).toBe(true);
    expect(candidates.some((m) => m.providerId === "nvidia-nim")).toBe(false);
  });

  it("excludes disabled models even when not explicitly requested (registry default enabledOnly)", async () => {
    const registry = new DefaultModelRegistry({
      seed: [
        ...SEED_MODELS,
        {
          ...SEED_MODELS[0]!,
          modelId: "groq-disabled-v1",
          availability: { ...SEED_MODELS[0]!.availability, enabled: false },
        },
      ],
    });
    const candidates = await queryCandidates(registry, requirement());
    expect(candidates.some((m) => m.modelId === "groq-disabled-v1")).toBe(false);
  });

  it("excludes a non-streaming model when streaming is required", async () => {
    const registry = new DefaultModelRegistry({
      seed: [
        ...SEED_MODELS,
        {
          ...SEED_MODELS[0]!,
          modelId: "groq-no-streaming-v1",
          capabilities: { ...SEED_MODELS[0]!.capabilities, streaming: false },
        },
      ],
    });
    const candidates = await queryCandidates(registry, requirement({ requiresStreaming: true }));
    expect(candidates.some((m) => m.modelId === "groq-no-streaming-v1")).toBe(false);
  });

  it("returns an empty array when no model satisfies the requirement", async () => {
    const registry = new DefaultModelRegistry({ seed: SEED_MODELS });
    const candidates = await queryCandidates(
      registry,
      requirement({ minContextTokens: 10_000_000 }),
    );
    expect(candidates).toEqual([]);
  });
});
