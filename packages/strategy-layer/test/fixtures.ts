import { DefaultCapabilityRegistry, SEED_CAPABILITIES } from "@ai-gateway/capability-registry";
import type { ExecuteRequest } from "@ai-gateway/core-contracts";
import { DefaultCostOptimizer, InMemoryCacheClient } from "@ai-gateway/cost-optimizer";
import { createSeededExecutionProfileRegistry } from "@ai-gateway/execution-profile-registry";
import { DefaultLearningRegistry } from "@ai-gateway/learning";
import { DefaultPromptOptimizer } from "@ai-gateway/prompt-optimizer";
import { createSeededRuntimeProfileRegistry } from "@ai-gateway/runtime-profiles";
import type { StrategyLayerOptions } from "../src/strategy-layer.js";
import type { TenantContext } from "../src/types.js";

export function baseRequest(overrides: Partial<ExecuteRequest> = {}): ExecuteRequest {
  return {
    task: "summarization",
    input: { text: "Please just summarize this document for me, kindly and thoroughly." },
    tenant: { organizationId: "org-1" },
    ...overrides,
  };
}

export function tenant(overrides: Partial<TenantContext> = {}): TenantContext {
  return { organizationId: "org-1", ...overrides };
}

/** A fully-wired, seeded, in-memory `StrategyLayerOptions` set — every registry/optimizer this package actually ships, no test doubles, so pipeline/integration tests exercise real cross-package behavior. */
export function seededOptions(overrides: Partial<StrategyLayerOptions> = {}): StrategyLayerOptions {
  return {
    capabilityRegistry: new DefaultCapabilityRegistry({ seed: SEED_CAPABILITIES }),
    executionProfileRegistry: createSeededExecutionProfileRegistry(),
    runtimeProfileRegistry: createSeededRuntimeProfileRegistry(),
    costOptimizer: new DefaultCostOptimizer(),
    promptOptimizer: new DefaultPromptOptimizer(),
    learningRegistry: new DefaultLearningRegistry(),
    cache: new InMemoryCacheClient(),
    ...overrides,
  };
}
