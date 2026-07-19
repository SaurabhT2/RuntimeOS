import type {
  ChatMessage,
  ExecuteResponse,
  JSONSchema,
  ToolCall,
} from "@ai-gateway/core-contracts";
import type { ScopedCredential } from "@ai-gateway/credential-resolver";
import { providerUnavailable } from "./errors.js";

/**
 * ## Why this file exists (ADR-0008; see also ADR-0007)
 *
 * `orchestrator`'s frozen dependency edge (Section 4.1's `DEPENDENCY_TABLE`,
 * `.dependency-cruiser.cjs`, established at EM-0) is exactly:
 * `policy-engine`, `credential-resolver`, `reliability`, `streaming`,
 * `telemetry`, `core-contracts`. It deliberately does **not** include
 * `providers/provider-sdk` (nor, transitively, `providers/groq` /
 * `providers/nvidia-nim` — architecture §12.4's "no change to orchestrator"
 * design goal for adding a new provider is only true if `orchestrator`
 * never imports a concrete adapter package in the first place).
 *
 * `streaming`'s `StreamManager.openStream(adapter, invocation, cred,
 * requestId)` (ADR-0007) is typed against `provider-sdk`'s real
 * `ProviderAdapter`/`NormalizedInvocation`/`NormalizedChunk`. For
 * `orchestrator` to call that method — and to call a resolved adapter's
 * `invoke()` directly for the non-streaming path — it needs values that
 * are *structurally* assignable to those provider-sdk types, without ever
 * importing `@ai-gateway/providers/provider-sdk` itself.
 *
 * This file is the same solution this codebase already applies at every
 * other frozen-boundary crossing: `reliability` duplicates
 * `ProviderHealthSnapshot` rather than importing it from `provider-sdk`;
 * `credential-resolver` duplicates `ScopedCredential`/`TenantContext`;
 * `provider-sdk` itself duplicates `CredentialScope` rather than importing
 * it from `@ai-gateway/config`. Every one of those duplicates is
 * field-for-field identical to its counterpart, which is what makes
 * TypeScript's structural typing carry a real value across the boundary
 * with zero runtime mapping. The same pattern is applied here.
 *
 * `ScopedCredential` is the one exception: it is *not* duplicated again
 * here. `credential-resolver`'s own copy (imported below) is already
 * documented there as "field-for-field identical to
 * `@ai-gateway/provider-sdk`'s `ScopedCredential`", and `orchestrator`
 * already has a legitimate dependency edge onto `credential-resolver` — so
 * reusing that copy (rather than minting a third structurally-identical
 * one) is the minimal-duplication choice.
 */

/** Structurally identical to `provider-sdk`'s `ProviderCapabilities` (architecture §12.2). */
export interface ProviderCapabilities {
  supportsStreaming: boolean;
  supportsJsonMode: boolean;
  supportsToolCalling: boolean;
  supportsSystemMessages: boolean;
  maxContextTokens: number;
  rateLimits: { requestsPerMinute?: number; tokensPerMinute?: number };
}

/** Structurally identical to `provider-sdk`'s `CostEstimate`. */
export interface CostEstimate {
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
}

/** Structurally identical to `provider-sdk`'s `ProviderHealthSnapshot` (also duplicated by `reliability`). */
export interface ProviderHealthSnapshot {
  providerId: string;
  healthy: boolean;
  latencyMs?: number;
  lastCheckedAt: string;
  consecutiveFailures: number;
  message?: string;
}

/** Structurally identical to `provider-sdk`'s `ToolDefinition`. */
export interface ToolDefinition {
  name: string;
  description?: string;
  parameters: JSONSchema;
}

/** Structurally identical to `provider-sdk`'s `NormalizedInvocation` (architecture §12.1). */
export interface NormalizedInvocation {
  modelId: string;
  messages: ChatMessage[];
  temperature: number;
  maxOutputTokens: number;
  responseFormat?: { type: "json"; schema?: JSONSchema };
  tools?: ToolDefinition[];
  stream: boolean;
  timeoutMs: number;
}

/** Structurally identical to `provider-sdk`'s `NormalizedResult`. */
export interface NormalizedResult {
  text?: string;
  json?: unknown;
  toolCalls?: ToolCall[];
  usage: { inputTokens: number; outputTokens: number };
  finishReason: ExecuteResponse["finishReason"];
  raw?: unknown;
}

/** Structurally identical to `provider-sdk`'s `NormalizedChunk`. */
export interface NormalizedChunk {
  delta: { text?: string; toolCallDelta?: unknown };
  done: boolean;
  finishReason?: ExecuteResponse["finishReason"];
  usage?: { inputTokens: number; outputTokens: number };
}

/**
 * Structurally identical to `provider-sdk`'s `ProviderAdapter` (architecture
 * §11). This is the exact shape `streaming`'s `StreamManager.openStream`
 * expects for its `adapter` parameter (ADR-0007) — a value typed against
 * this interface is assignable there by structure, with no import edge
 * onto `provider-sdk` required.
 */
export interface ProviderAdapter {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  invoke(req: NormalizedInvocation, cred: ScopedCredential): Promise<NormalizedResult>;
  invokeStream(req: NormalizedInvocation, cred: ScopedCredential): AsyncIterable<NormalizedChunk>;
  healthCheck(cred: ScopedCredential): Promise<ProviderHealthSnapshot>;
  estimateCost(req: NormalizedInvocation): CostEstimate;
}

/**
 * The "adapter registry" ADR-0007 and the EM-3 Architecture & Engineering
 * Review (Section 7, Section 15) both call out as missing an owner: the
 * thing that maps a `providerId` string (from an `ExecutionPlan`) to a
 * live `ProviderAdapter` instance.
 *
 * `orchestrator` defines the *interface* only. Per architecture §6.4's
 * single-composition-root pattern, concrete adapter instances (a real
 * `GroqAdapter`, `NimAdapter`, or a `MockAdapter`) are constructed and
 * registered exactly once, at `apps/gateway-server/src/bootstrap.ts`
 * (EM-5) — the one file in the codebase permitted to import every
 * concrete implementation simultaneously. `orchestrator` never imports a
 * concrete adapter package; it only ever calls `resolve()` against
 * whatever registry its caller injected. This is also why architecture
 * §12.4's "Adding a New Provider" flow ends at "register the adapter
 * instance in `bootstrap.ts`" and explicitly states "no change to
 * `orchestrator`... is required" — that guarantee only holds if
 * `orchestrator` never has a static import of any adapter package, which
 * this design preserves.
 */
export interface ProviderAdapterRegistry {
  /**
   * Resolves `providerId` to a live adapter. Throws a
   * `GatewayError("ALL_PROVIDERS_UNAVAILABLE", ..., false)` (not a raw
   * error) if no adapter is registered for `providerId` — from the
   * orchestrator's perspective, an unregistered provider and an
   * unreachable one are both "this plan step cannot be executed right
   * now", so both are surfaced the same way to keep the failover loop
   * (see `orchestrator.ts`) a single code path.
   */
  resolve(providerId: string): ProviderAdapter;
}

/**
 * A trivial, in-memory `ProviderAdapterRegistry`. Good enough to be the
 * one shipped implementation today (nothing here needs a database or a
 * network client), and — because it depends on nothing but this file's
 * own structural `ProviderAdapter` type — trivially reusable by
 * `apps/gateway-server`'s composition root (EM-5) once real adapters
 * exist to register.
 */
export class InMemoryProviderAdapterRegistry implements ProviderAdapterRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>();

  constructor(adapters: Iterable<ProviderAdapter> = []) {
    for (const adapter of adapters) {
      this.register(adapter);
    }
  }

  /** Registers (or replaces) the adapter for `adapter.id`. */
  register(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  /** Unregisters the adapter for `providerId`, if any. Idempotent. */
  unregister(providerId: string): void {
    this.adapters.delete(providerId);
  }

  resolve(providerId: string): ProviderAdapter {
    const adapter = this.adapters.get(providerId);
    if (!adapter) {
      throw providerUnavailable(providerId);
    }
    return adapter;
  }
}
