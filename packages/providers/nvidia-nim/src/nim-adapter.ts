import { isGatewayError } from "@ai-gateway/core-contracts";
import {
  createGatewayError,
  type CostEstimate,
  type NormalizedChunk,
  type NormalizedInvocation,
  type NormalizedResult,
  type ProviderAdapter,
  type ProviderCapabilities,
  type ProviderHealthSnapshot,
  type ScopedCredential,
} from "@ai-gateway/provider-sdk";
import { mapNimHttpError } from "./http-errors.js";
import {
  fromNimResponse,
  fromNimStreamEvent,
  toNimRequestBody,
  type NimChatCompletionResponse,
} from "./openai-compat.js";
import { parseSseDataLines } from "./sse-parser.js";

/**
 * architecture §12.3: "positioned in the registry primarily as a failover
 * and model-diversity target" — no special free-tier proactive rate
 * limiting is called out for NIM the way it is for Groq (§12.3's Groq
 * bullet, not repeated for NIM), so unlike `@ai-gateway/groq`'s
 * `GroqAdapter`, this adapter has no built-in token-bucket limiter. Its
 * declared `rateLimits` still mirror this repo's Model Registry seed data
 * for `nvidia-nim` (`requestsPerMinute: 60`, `tokensPerMinute: 60_000`)
 * for informational/Policy-Engine-scoring purposes (architecture §13.3's
 * `rateLimitPenalty` in `@ai-gateway/policy-engine` consults
 * `ModelDescriptor.availability.rateLimits`, not this adapter's
 * `capabilities.rateLimits` directly — the two are meant to describe the
 * same real-world ceiling, just from different layers).
 */
const DEFAULT_CAPABILITIES: ProviderCapabilities = {
  supportsStreaming: true,
  supportsJsonMode: true,
  supportsToolCalling: true,
  supportsSystemMessages: true,
  maxContextTokens: 128_000,
  rateLimits: { requestsPerMinute: 60, tokensPerMinute: 60_000 },
};

const DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1";

export interface NimPricing {
  inputPer1kTokensUsd: number;
  outputPer1kTokensUsd: number;
}

/**
 * NIM's paid-tier default, using this repo's Model Registry seed data's
 * lower (`fast-extraction`) figure as the adapter-wide flat default — a
 * documented simplification (real per-model NIM pricing varies, e.g. the
 * seed data's `complex-reasoning` entry is priced higher); a deployment
 * with accurate per-model economics overrides via `NimAdapterOptions.pricing`.
 */
const DEFAULT_PRICING: NimPricing = { inputPer1kTokensUsd: 0.05, outputPer1kTokensUsd: 0.08 };

export interface NimAdapterOptions {
  /** Defaults to `"nvidia-nim"`. */
  id?: string;
  baseUrl?: string;
  /** Injectable `fetch`, primarily a test seam (this package's README, Testing strategy). Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  capabilities?: Partial<ProviderCapabilities>;
  pricing?: NimPricing;
  /** Requests `stream_options: { include_usage: true }` for real token usage on the terminal stream chunk. Defaults to `true`. */
  streamIncludeUsage?: boolean;
}

function assertCredential(cred: ScopedCredential): void {
  if (!cred.key) {
    throw createGatewayError(
      "CREDENTIAL_INVALID",
      "NVIDIA NIM adapter received an empty credential key.",
    );
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * `ProviderAdapter` for NVIDIA's hosted NIM inference endpoints
 * (architecture §12.3) — "not self-hosted GPU inference — no GPU
 * orchestration concerns belong in this adapter," so this class is a
 * thin, purely HTTP-level OpenAI-compatible client, structurally the same
 * shape as `@ai-gateway/groq`'s `GroqAdapter` minus its rate limiter.
 */
export class NimAdapter implements ProviderAdapter {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;

  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly pricing: NimPricing;
  private readonly streamIncludeUsage: boolean;

  constructor(options: NimAdapterOptions = {}) {
    this.id = options.id ?? "nvidia-nim";
    this.capabilities = { ...DEFAULT_CAPABILITIES, ...options.capabilities };
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.pricing = options.pricing ?? DEFAULT_PRICING;
    this.streamIncludeUsage = options.streamIncludeUsage ?? true;
  }

  async invoke(req: NormalizedInvocation, cred: ScopedCredential): Promise<NormalizedResult> {
    assertCredential(cred);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);
    timer.unref?.();

    try {
      const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cred.key}`, "Content-Type": "application/json" },
        body: JSON.stringify(toNimRequestBody({ ...req, stream: false }, false)),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw mapNimHttpError(res.status, await res.text());
      }

      const json = (await res.json()) as NimChatCompletionResponse;
      return fromNimResponse(json);
    } catch (error) {
      if (isAbortError(error)) {
        throw createGatewayError("TIMEOUT", `Exceeded timeoutMs=${req.timeoutMs}`);
      }
      if (isGatewayError(error)) throw error;
      throw createGatewayError(
        "INTERNAL_ERROR",
        `NVIDIA NIM request failed: ${errorMessage(error)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async *invokeStream(
    req: NormalizedInvocation,
    cred: ScopedCredential,
  ): AsyncIterable<NormalizedChunk> {
    assertCredential(cred);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);
    timer.unref?.();

    try {
      let res: Response;
      try {
        res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${cred.key}`, "Content-Type": "application/json" },
          body: JSON.stringify(toNimRequestBody({ ...req, stream: true }, this.streamIncludeUsage)),
          signal: controller.signal,
        });
      } catch (error) {
        if (isAbortError(error))
          throw createGatewayError("TIMEOUT", `Exceeded timeoutMs=${req.timeoutMs}`);
        throw createGatewayError(
          "INTERNAL_ERROR",
          `NVIDIA NIM streaming request failed: ${errorMessage(error)}`,
        );
      }

      if (!res.ok) {
        throw mapNimHttpError(res.status, await res.text());
      }
      if (!res.body) {
        throw createGatewayError("INTERNAL_ERROR", "NVIDIA NIM streaming response had no body.");
      }

      let sawTerminal = false;
      for await (const payload of parseSseDataLines(res.body)) {
        let event: NimChatCompletionResponse;
        try {
          event = JSON.parse(payload) as NimChatCompletionResponse;
        } catch {
          throw createGatewayError(
            "INTERNAL_ERROR",
            "Received a malformed SSE frame from NVIDIA NIM.",
          );
        }
        const chunk = fromNimStreamEvent(event);
        if (!chunk) continue;
        if (chunk.done) sawTerminal = true;
        yield chunk;
      }

      if (!sawTerminal) {
        throw createGatewayError(
          "INTERNAL_ERROR",
          "NVIDIA NIM stream ended without a terminal chunk.",
        );
      }
    } catch (error) {
      if (isAbortError(error))
        throw createGatewayError("TIMEOUT", `Exceeded timeoutMs=${req.timeoutMs}`);
      if (isGatewayError(error)) throw error;
      throw createGatewayError(
        "INTERNAL_ERROR",
        `NVIDIA NIM stream failed: ${errorMessage(error)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async healthCheck(cred: ScopedCredential): Promise<ProviderHealthSnapshot> {
    const startedAt = Date.now();
    try {
      assertCredential(cred);
      const res = await this.fetchImpl(`${this.baseUrl}/models`, {
        method: "GET",
        headers: { Authorization: `Bearer ${cred.key}` },
      });
      if (!res.ok) {
        throw mapNimHttpError(res.status, await res.text());
      }
      return {
        providerId: this.id,
        healthy: true,
        latencyMs: Date.now() - startedAt,
        lastCheckedAt: new Date().toISOString(),
        consecutiveFailures: 0,
      };
    } catch (error) {
      return {
        providerId: this.id,
        healthy: false,
        lastCheckedAt: new Date().toISOString(),
        consecutiveFailures: 1,
        message: isGatewayError(error) ? error.message : errorMessage(error),
      };
    }
  }

  estimateCost(req: NormalizedInvocation): CostEstimate {
    const estimatedInputTokens = Math.max(
      1,
      Math.round(req.messages.reduce((sum, m) => sum + m.content.length, 0) / 4),
    );
    const estimatedOutputTokens = req.maxOutputTokens > 0 ? req.maxOutputTokens : 256;
    const estimatedCostUsd =
      (estimatedInputTokens / 1000) * this.pricing.inputPer1kTokensUsd +
      (estimatedOutputTokens / 1000) * this.pricing.outputPer1kTokensUsd;
    return { estimatedInputTokens, estimatedOutputTokens, estimatedCostUsd };
  }
}
