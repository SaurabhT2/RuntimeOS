/**
 * @ai-gateway/provider-sdk
 *
 * The ProviderAdapter interface, the Mock Adapter, and the shared
 * conformance test suite (`tools/adapter-conformance-tests`' logic).
 *
 * STATUS: implemented (Engineering Milestone EM-1, Blueprint §7, §8.4).
 *
 * Architecture reference: §12
 */

export type { ProviderAdapter } from "./provider-adapter.js";
export type { ProviderCapabilities } from "./capabilities.js";
export type {
  NormalizedInvocation,
  NormalizedResult,
  NormalizedChunk,
  ToolDefinition,
} from "./invocation.js";
export { CREDENTIAL_SCOPES, type CredentialScope, type ScopedCredential } from "./credential.js";
export type { ProviderHealthSnapshot } from "./health.js";
export type { CostEstimate } from "./cost.js";

export { MockAdapter, type MockAdapterMode, type MockAdapterBehavior } from "./mock-adapter.js";

export { runConformanceSuite, type ConformanceOptions } from "./conformance.js";

export { createGatewayError, withTimeout, delay } from "./internal/errors.js";
