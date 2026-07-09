import type { ModelDescriptor, ModelQuery, ModelRegistry } from "@ai-gateway/model-registry";
import type { CapabilityRequirement } from "./types.js";

/** Translates a `CapabilityRequirement` into a `ModelRegistry.queryModels` filter (architecture §13.2 step 2). */
export function buildModelQuery(requirement: CapabilityRequirement): ModelQuery {
  return {
    enabledOnly: true,
    minContextWindow: requirement.minContextTokens,
    requiresStructuredOutput: requirement.requiresJsonMode || undefined,
    requiresToolCalling: requirement.requiresToolCalling || undefined,
  };
}

/**
 * Queries the Model Registry, then applies the requirement fields
 * `ModelQuery` cannot express directly: `requiresStreaming` (the registry's
 * `ModelQuery` has no streaming filter — added here, matching how
 * `requiresJsonMode`/`requiresToolCalling` are optional-boolean filters
 * only meaningful when `true`) and `maxCostUsd` (a per-request soft cap on
 * *output* cost per 1K tokens, not exposed as a `ModelQuery` field since
 * it's a request-time constraint, not a registry-wide filter dimension).
 */
export async function queryCandidates(
  registry: ModelRegistry,
  requirement: CapabilityRequirement,
): Promise<ModelDescriptor[]> {
  const results = await registry.queryModels(buildModelQuery(requirement));

  return results.filter((model) => {
    if (requirement.requiresStreaming && !model.capabilities.streaming) {
      return false;
    }
    if (
      requirement.maxCostUsd !== undefined &&
      model.cost.outputPer1kTokensUsd > requirement.maxCostUsd
    ) {
      return false;
    }
    return true;
  });
}
