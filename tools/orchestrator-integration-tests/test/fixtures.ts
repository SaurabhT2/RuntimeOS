import { vi } from "vitest";
import type { CredentialScope } from "@ai-gateway/config";
import {
  AesGcmEncryptor,
  DbScopeResolver,
  DbSecretSource,
  DefaultCredentialResolver,
  DefaultResolutionChain,
  generateEncryptionKey,
  InMemoryCredentialStore,
  registerCredential,
  type CredentialResolver,
  type TenantContext,
} from "@ai-gateway/credential-resolver";
import { DefaultModelRegistry, type ModelDescriptor } from "@ai-gateway/model-registry";
import { DefaultHealthMonitor } from "@ai-gateway/reliability";
import { DefaultPolicyEngine, type PolicyEngine } from "@ai-gateway/policy-engine";
import type { Telemetry } from "@ai-gateway/telemetry";

const PRIORITY: CredentialScope[] = ["user", "project", "workspace", "organization", "platform"];

export function fakeTelemetry(): Telemetry {
  return {
    startSpan: vi.fn(() => ({ setStatus: vi.fn(), end: vi.fn() }) as never),
    recordMetric: vi.fn(),
    log: vi.fn(),
  };
}

/**
 * `model-registry`'s real `SEED_MODELS` (architecture §14.3's illustrative
 * table) gives `groq` three free-tier models spanning three different
 * `modelClass`es and `nvidia-nim` two paid-tier models — so for almost
 * every `task`, `groq`'s zero cost wins every one of the top-3 scored
 * candidate slots outright (`preferredProvidersRule`'s own doc comment:
 * the built-in provider-preference rule is a soft +0.2 score boost, not a
 * hard veto — not enough to overcome that cost gap). A test that needs a
 * deterministic groq+nvidia-nim `fallbackPlans` chain (every test in this
 * directory that exercises failover) cannot rely on `SEED_MODELS` for
 * that reason.
 *
 * This is a real `DefaultModelRegistry` (not a test double — the same
 * class `SEED_MODELS`-based tests elsewhere in this codebase use) seeded
 * with exactly one model per provider, both in the same `modelClass`, so
 * `DefaultPolicyEngine`'s real candidate-query + scoring pipeline is
 * guaranteed to return both as candidates for any request whose task maps
 * to that class — giving a deterministic two-candidate chain without
 * faking the Policy Engine itself.
 */
const TWO_PROVIDER_SEED: ModelDescriptor[] = [
  {
    providerId: "groq",
    modelId: "groq-fast-extraction-v1",
    modelClass: "fast-extraction",
    capabilities: {
      contextWindow: 32_000,
      structuredOutput: true,
      streaming: true,
      toolCalling: false,
      reasoningDepth: "shallow",
      creativityScore: 0.2,
    },
    performance: { p50LatencyMs: 180, p99LatencyMs: 420, tokensPerSecond: 280 },
    cost: { inputPer1kTokensUsd: 0, outputPer1kTokensUsd: 0, tier: "free" },
    availability: { enabled: true, rateLimits: { requestsPerMinute: 30, tokensPerMinute: 6000 } },
  },
  {
    providerId: "nvidia-nim",
    modelId: "nim-fast-extraction-v1",
    modelClass: "fast-extraction",
    capabilities: {
      contextWindow: 32_000,
      structuredOutput: true,
      streaming: true,
      toolCalling: true,
      reasoningDepth: "shallow",
      creativityScore: 0.2,
    },
    performance: { p50LatencyMs: 220, p99LatencyMs: 500, tokensPerSecond: 240 },
    cost: { inputPer1kTokensUsd: 0.05, outputPer1kTokensUsd: 0.08, tier: "paid" },
    availability: { enabled: true, rateLimits: { requestsPerMinute: 60, tokensPerMinute: 60_000 } },
  },
];

/** A real `DefaultCredentialResolver`, wired the same way `credential-resolver`'s
 * own `resolver.test.ts` wires one (`InMemoryCredentialStore` +
 * `AesGcmEncryptor` + a single-scope `DefaultResolutionChain`), seeded with
 * one workspace-scoped credential per `providerId` in `seed`. Real
 * encryption, real resolution chain — only the storage backend
 * (in-memory instead of a database) differs from a production deployment,
 * which is exactly the axis `InMemoryCredentialStore` exists to let a
 * caller substitute (this package's own README; `credential-resolver`'s
 * README, Testing Strategy).
 */
export async function buildCredentialResolver(
  seed: Record<string, string>,
  tenant: TenantContext,
): Promise<CredentialResolver> {
  const store = new InMemoryCredentialStore();
  const encryptor = new AesGcmEncryptor(generateEncryptionKey());
  const chain = new DefaultResolutionChain({
    resolvers: [new DbScopeResolver("workspace", store)],
    sources: [new DbSecretSource(store, encryptor)],
    priority: PRIORITY,
  });
  const auditLogger = { record: () => {} };
  const resolver = new DefaultCredentialResolver({
    chain,
    auditLogger,
    defaultActor: "orchestrator-integration-tests",
  });
  for (const [provider, key] of Object.entries(seed)) {
    await registerCredential(store, encryptor, auditLogger, {
      scope: "workspace",
      provider,
      tenant,
      plaintextKey: key,
      actor: "orchestrator-integration-tests-setup",
    });
  }
  return resolver;
}

/** A real `DefaultPolicyEngine` seeded with {@link TWO_PROVIDER_SEED} — see that constant's doc comment for why. */
export function buildPolicyEngine(): PolicyEngine {
  const modelRegistry = new DefaultModelRegistry({ seed: TWO_PROVIDER_SEED });
  const healthMonitor = new DefaultHealthMonitor();
  return new DefaultPolicyEngine({ modelRegistry, healthMonitor });
}

// ---------------------------------------------------------------------
// Minimal fetch fixture for the real GroqAdapter / NimAdapter.
//
// `@ai-gateway/groq` and `@ai-gateway/nvidia-nim` each ship a richer
// `createFakeFetch` under their own `test/` directory, but a package's
// `test/` files are not part of its public `exports` map (by design —
// they are that package's own test helpers, not a published API), so this
// package cannot import them. This is a deliberately small subset — just
// enough to script a successful OpenAI-compatible chat completion or a
// network failure — rather than a full re-implementation.
// ---------------------------------------------------------------------

export function jsonFetch(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

export function throwingFetch(message: string): typeof fetch {
  return (async () => {
    throw new Error(message);
  }) as unknown as typeof fetch;
}

/** A successful OpenAI-compatible chat completion body — the shape both `GroqAdapter` and `NimAdapter` parse (both packages' own `test/*-adapter.test.ts`). */
export function successBody(text: string) {
  return {
    id: "chatcmpl-1",
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  };
}
