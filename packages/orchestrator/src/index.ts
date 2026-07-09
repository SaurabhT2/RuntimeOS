/**
 * @ai-gateway/orchestrator
 *
 * ExecutionOrchestrator — the full request lifecycle (architecture §17):
 * Policy Engine → Credential Resolution → Provider Resolution → Retry →
 * Failover → Streaming → Completion.
 *
 * STATUS: implemented (Engineering Milestone EM-4, Blueprint §7).
 *
 * Architecture reference: §11, §12.1, §12.4, §17, §18
 */

export {
  type ExecutionOrchestrator,
  type ExecutionOrchestratorOptions,
  DefaultExecutionOrchestrator,
} from "./orchestrator.js";

export {
  type ProviderAdapter,
  type ProviderAdapterRegistry,
  type ProviderCapabilities,
  type CostEstimate,
  type ProviderHealthSnapshot,
  type ToolDefinition,
  type NormalizedInvocation,
  type NormalizedResult,
  type NormalizedChunk,
  InMemoryProviderAdapterRegistry,
} from "./types.js";

export { buildNormalizedInvocation } from "./invocation-builder.js";
export { buildExecuteResponse, type ExecutionMeta } from "./response-mapper.js";
export { providerUnavailable, allProvidersUnavailable } from "./errors.js";
