import { describe, expect, it } from "vitest";
import { isGatewayError } from "@ai-gateway/core-contracts";
import type { ProviderAdapter } from "./provider-adapter.js";
import type { NormalizedInvocation } from "./invocation.js";
import type { ScopedCredential } from "./credential.js";
import type { MockAdapterBehavior } from "./mock-adapter.js";

/**
 * `tools/adapter-conformance-tests`'s actual logic (architecture §12.4,
 * §24). Lives in `provider-sdk` rather than a separate package so it ships
 * versioned together with the `ProviderAdapter` interface it validates
 * (they must never drift apart) — `tools/adapter-conformance-tests`
 * (Blueprint §7 EM-1 deliverable) is the thin per-adapter runner that calls
 * this function; see that directory's README.
 *
 * EM-1 scope note (Blueprint §7 risk): only the core behavioral contract is
 * asserted here — a valid id/capabilities, a well-shaped success result,
 * translated (never raw) errors, timeout enforcement, and well-shaped
 * streaming/health/cost results. Deeper provider-specific edge cases named
 * in architecture §24 (malformed JSON bodies, HTTP-level rate-limit
 * response parsing, partial-stream corruption at the wire level) are
 * deferred to EM-4, once a second real adapter (Groq/NIM) exists to
 * validate the harness against something other than the Mock Adapter
 * itself.
 */
export interface ConformanceOptions {
  /** Constructs a fresh adapter instance. Called once per scenario to avoid cross-test state leakage. */
  createAdapter: () => ProviderAdapter;
  /** A credential the adapter under test accepts as valid. */
  credential: ScopedCredential;
  /** A baseline invocation valid for this adapter (a real modelId, sane timeoutMs, etc.). */
  invocation: NormalizedInvocation;
  /**
   * Configures `adapter` to exhibit a given failure mode before a scenario
   * runs. Only the Mock Adapter can do this today (via `setBehavior`); a
   * real adapter's conformance run would wire this to a mock-HTTP-server
   * harness (architecture §24) — scenarios requiring this hook are skipped
   * when it isn't provided, rather than failing, so the suite still runs
   * usefully against an adapter that can't yet simulate every failure mode.
   */
  configureBehavior?: (adapter: ProviderAdapter, behavior: MockAdapterBehavior) => void;
}

/**
 * Runs the shared `ProviderAdapter` conformance suite against
 * `options.createAdapter()`. Call this from any adapter package's own test
 * file, e.g.:
 *
 * ```ts
 * import { runConformanceSuite } from "@ai-gateway/provider-sdk/conformance";
 * import { MockAdapter } from "@ai-gateway/provider-sdk";
 *
 * // Imported from the dedicated "/conformance" subpath (not the package's
 * // main entry point) because this module pulls in vitest, which must
 * // never load as part of production runtime execution.
 *
 * runConformanceSuite({
 *   createAdapter: () => new MockAdapter(),
 *   credential: { key: "test-key", scope: "workspace" },
 *   invocation: { modelId: "mock-model", messages: [...], temperature: 0.2, maxOutputTokens: 64, stream: false, timeoutMs: 5000 },
 *   configureBehavior: (adapter, behavior) => (adapter as MockAdapter).setBehavior(behavior),
 * });
 * ```
 */
export function runConformanceSuite(options: ConformanceOptions): void {
  const { createAdapter, credential, invocation, configureBehavior } = options;

  describe(`ProviderAdapter conformance: ${createAdapter().id}`, () => {
    it("declares a non-empty id and well-shaped capabilities", () => {
      const adapter = createAdapter();
      expect(adapter.id.length).toBeGreaterThan(0);
      expect(typeof adapter.capabilities.supportsStreaming).toBe("boolean");
      expect(typeof adapter.capabilities.supportsJsonMode).toBe("boolean");
      expect(typeof adapter.capabilities.supportsToolCalling).toBe("boolean");
      expect(typeof adapter.capabilities.supportsSystemMessages).toBe("boolean");
      expect(adapter.capabilities.maxContextTokens).toBeGreaterThan(0);
      expect(adapter.capabilities.rateLimits).toBeTypeOf("object");
    });

    it("invoke() returns a well-shaped NormalizedResult on success", async () => {
      const adapter = createAdapter();
      const result = await adapter.invoke(invocation, credential);
      expect(result.usage.inputTokens).toBeGreaterThanOrEqual(0);
      expect(result.usage.outputTokens).toBeGreaterThanOrEqual(0);
      expect(["stop", "length", "content_filter", "tool_call", "cancelled"]).toContain(
        result.finishReason,
      );
    });

    it("invoke() rejects with CREDENTIAL_INVALID (a GatewayError, never raw) for an empty credential key", async () => {
      const adapter = createAdapter();
      const invalidCredential: ScopedCredential = { ...credential, key: "" };
      await expect(adapter.invoke(invocation, invalidCredential)).rejects.toSatisfy(
        (error: unknown) => isGatewayError(error) && error.code === "CREDENTIAL_INVALID",
      );
    });

    it.skipIf(!configureBehavior)(
      "invoke() never lets a raw exception escape, and translates a configured error to the matching GatewayError code",
      async () => {
        const adapter = createAdapter();
        configureBehavior!(adapter, { mode: "error", errorCode: "RATE_LIMITED" });
        await expect(adapter.invoke(invocation, credential)).rejects.toSatisfy(
          (error: unknown) =>
            isGatewayError(error) && error.code === "RATE_LIMITED" && error.retryable,
        );
      },
    );

    it.skipIf(!configureBehavior)(
      "invoke() honors timeoutMs, translating an exceeded deadline into GatewayError TIMEOUT",
      async () => {
        const adapter = createAdapter();
        configureBehavior!(adapter, { mode: "timeout" });
        await expect(adapter.invoke(invocation, credential)).rejects.toSatisfy(
          (error: unknown) => isGatewayError(error) && error.code === "TIMEOUT" && error.retryable,
        );
      },
    );

    it("invokeStream() yields chunks ending with exactly one done:true terminal chunk carrying a finishReason", async () => {
      const adapter = createAdapter();
      if (!adapter.capabilities.supportsStreaming) return;
      const chunks = [];
      for await (const chunk of adapter.invokeStream(invocation, credential)) {
        chunks.push(chunk);
      }
      expect(chunks.length).toBeGreaterThan(0);
      const terminalChunks = chunks.filter((c) => c.done);
      expect(terminalChunks).toHaveLength(1);
      expect(terminalChunks[0]?.finishReason).toBeDefined();
      expect(chunks.indexOf(terminalChunks[0]!)).toBe(chunks.length - 1);
    });

    it.skipIf(!configureBehavior)(
      "invokeStream() never lets a raw exception escape on a mid-stream failure",
      async () => {
        const adapter = createAdapter();
        if (!adapter.capabilities.supportsStreaming) return;
        configureBehavior!(adapter, { mode: "malformed-stream", chunkCount: 4 });

        await expect(
          (async () => {
            const chunks = [];
            for await (const chunk of adapter.invokeStream(invocation, credential)) {
              chunks.push(chunk);
            }
            return chunks;
          })(),
        ).rejects.toSatisfy((error: unknown) => isGatewayError(error));
      },
    );

    it("healthCheck() returns a well-shaped ProviderHealthSnapshot", async () => {
      const adapter = createAdapter();
      const snapshot = await adapter.healthCheck(credential);
      expect(snapshot.providerId).toBe(adapter.id);
      expect(typeof snapshot.healthy).toBe("boolean");
      expect(typeof snapshot.lastCheckedAt).toBe("string");
      expect(() => new Date(snapshot.lastCheckedAt).toISOString()).not.toThrow();
      expect(snapshot.consecutiveFailures).toBeGreaterThanOrEqual(0);
    });

    it("estimateCost() returns a synchronous, non-negative CostEstimate", () => {
      const adapter = createAdapter();
      const estimate = adapter.estimateCost(invocation);
      expect(estimate.estimatedInputTokens).toBeGreaterThanOrEqual(0);
      expect(estimate.estimatedOutputTokens).toBeGreaterThanOrEqual(0);
      expect(estimate.estimatedCostUsd).toBeGreaterThanOrEqual(0);
    });
  });
}
