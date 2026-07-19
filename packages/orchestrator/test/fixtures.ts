import { vi } from "vitest";
import { GatewayError, type ExecuteRequest } from "@ai-gateway/core-contracts";
import type {
  CredentialResolver,
  ScopedCredential,
  TenantContext,
} from "@ai-gateway/credential-resolver";
import type { ExecutionPlan, PolicyContext, PolicyEngine } from "@ai-gateway/policy-engine";
import { DEFAULT_RETRY_POLICY } from "@ai-gateway/reliability";
import type { Telemetry } from "@ai-gateway/telemetry";
import type {
  NormalizedChunk,
  NormalizedInvocation,
  NormalizedResult,
  ProviderAdapter,
} from "../src/types.js";

export function baseRequest(overrides: Partial<ExecuteRequest> = {}): ExecuteRequest {
  return {
    task: "summarization",
    input: { text: "hello world" },
    tenant: { organizationId: "org-1" },
    ...overrides,
  };
}

export function plan(overrides: Partial<ExecutionPlan> = {}): ExecutionPlan {
  return {
    providerId: "groq",
    modelId: "groq-fast-extraction-v1",
    modelClass: "fast-extraction",
    temperature: 0.5,
    maxOutputTokens: 256,
    timeoutMs: 5000,
    retryPolicy: DEFAULT_RETRY_POLICY,
    streaming: false,
    fallbackPlans: [],
    ...overrides,
  };
}

/** A `PolicyEngine` that always returns a fixed, scripted `ExecutionPlan`. */
export function fakePolicyEngine(fixedPlan: ExecutionPlan): PolicyEngine {
  return {
    selectExecutionPlan: vi.fn(async (_req: ExecuteRequest, _ctx: PolicyContext) => fixedPlan),
  };
}

/** A `CredentialResolver` backed by an in-memory `providerId -> key` map. Missing entries reject with `CREDENTIAL_NOT_FOUND`, matching the real resolver's contract. */
export function fakeCredentialResolver(keysByProvider: Record<string, string>): CredentialResolver {
  return {
    resolve: vi.fn(async (provider: string, _tenant: TenantContext): Promise<ScopedCredential> => {
      const key = keysByProvider[provider];
      if (!key) {
        throw new GatewayError(
          "CREDENTIAL_NOT_FOUND",
          `No credential configured for provider "${provider}".`,
          false,
          { provider },
        );
      }
      return { key, scope: "workspace" };
    }),
  };
}

export function fakeTelemetry(): Telemetry {
  return {
    startSpan: vi.fn(() => ({ setStatus: vi.fn(), end: vi.fn() }) as never),
    recordMetric: vi.fn(),
    log: vi.fn(),
  };
}

export function invocationFixture(
  overrides: Partial<NormalizedInvocation> = {},
): NormalizedInvocation {
  return {
    modelId: "m",
    messages: [{ role: "user", content: "hi" }],
    temperature: 0.5,
    maxOutputTokens: 100,
    stream: false,
    timeoutMs: 5000,
    ...overrides,
  };
}

export interface FakeAdapterScript {
  /** Called once per `invoke`. Return a result or throw a `GatewayError`. */
  onInvoke?: (req: NormalizedInvocation, cred: ScopedCredential) => Promise<NormalizedResult>;
  /** Called once per `invokeStream`. */
  onInvokeStream?: (
    req: NormalizedInvocation,
    cred: ScopedCredential,
  ) => AsyncIterable<NormalizedChunk>;
}

/** A hand-built `ProviderAdapter` test double — see `orchestrator`'s README, Testing Strategy, for why this package never imports the real `provider-sdk` `MockAdapter`. */
export function fakeAdapter(id: string, script: FakeAdapterScript = {}): ProviderAdapter {
  return {
    id,
    capabilities: {
      supportsStreaming: true,
      supportsJsonMode: true,
      supportsToolCalling: false,
      supportsSystemMessages: true,
      maxContextTokens: 32_000,
      rateLimits: {},
    },
    invoke:
      script.onInvoke ??
      (async () => ({
        text: `canned response from ${id}`,
        usage: { inputTokens: 5, outputTokens: 5 },
        finishReason: "stop",
      })),
    invokeStream:
      script.onInvokeStream ??
      async function* () {
        yield { delta: { text: "hi" }, done: false };
        yield { delta: {}, done: true, finishReason: "stop" };
      },
    healthCheck: async () => ({
      providerId: id,
      healthy: true,
      lastCheckedAt: new Date().toISOString(),
      consecutiveFailures: 0,
    }),
    estimateCost: () => ({
      estimatedInputTokens: 1,
      estimatedOutputTokens: 1,
      estimatedCostUsd: 0,
    }),
  };
}

/** Always throws the given `GatewayError` from both `invoke` and `invokeStream`. */
export function failingAdapter(id: string, error: GatewayError): ProviderAdapter {
  return fakeAdapter(id, {
    onInvoke: async () => {
      throw error;
    },
    onInvokeStream: async function* () {
      throw error;
      yield { delta: {}, done: true };
    },
  });
}
