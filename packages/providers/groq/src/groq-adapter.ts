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
import { mapGroqHttpError } from "./http-errors.js";
import {
  fromGroqResponse,
  fromGroqStreamEvent,
  toGroqRequestBody,
  type GroqChatCompletionResponse,
} from "./openai-compat.js";
import { TokenBucketRateLimiter } from "./rate-limiter.js";
import { parseSseDataLines } from "./sse-parser.js";

/** architecture §12.3: free-tier defaults, matching this repo's Model Registry seed data for `groq`'s models (`requestsPerMinute: 30`, `tokensPerMinute: 6000`). */
const DEFAULT_CAPABILITIES: ProviderCapabilities = {
  supportsStreaming: true,
  supportsJsonMode: true,
  supportsToolCalling: true,
  supportsSystemMessages: true,
  maxContextTokens: 128_000,
  rateLimits: { requestsPerMinute: 30, tokensPerMinute: 6000 },
};

const DEFAULT_BASE_URL = "https://api.groq.com/openai/v1";

export interface GroqPricing {
  inputPer1kTokensUsd: number;
  outputPer1kTokensUsd: number;
}

/** Free tier: $0/1K tokens, matching this repo's Model Registry seed data's `cost.tier: "free"` for every `groq` model. A paid-tier deployment overrides this via `GroqAdapterOptions.pricing`. */
const DEFAULT_PRICING: GroqPricing = { inputPer1kTokensUsd: 0, outputPer1kTokensUsd: 0 };

export interface GroqAdapterOptions {
  /** Defaults to `"groq"`. Overridable so a deployment could run two differently-configured Groq adapter instances (e.g. distinct rate-limit tiers) side by side. */
  id?: string;
  baseUrl?: string;
  /** Injectable `fetch`, primarily a test seam (recorded/mocked HTTP responses, never live calls in CI — this package's README, Testing strategy). Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  capabilities?: Partial<ProviderCapabilities>;
  /** Injectable for testing; defaults to a real `TokenBucketRateLimiter` seeded from `capabilities.rateLimits`. */
  rateLimiter?: TokenBucketRateLimiter;
  pricing?: GroqPricing;
  /** Requests `stream_options: { include_usage: true }` so the terminal stream chunk carries real token usage. Defaults to `true`; set `false` if a future non-standard Groq deployment rejects the field. */
  streamIncludeUsage?: boolean;
}

function assertCredential(cred: ScopedCredential): void {
  if (!cred.key) {
    throw createGatewayError(
      "CREDENTIAL_INVALID",
      "Groq adapter received an empty credential key.",
    );
  }
}

/** A deliberately simple token estimate for the rate limiter/cost estimate — not billing-accurate, matching `provider-sdk`'s Mock Adapter's own documented approach. */
function estimateTokens(req: NormalizedInvocation): number {
  const chars = req.messages.reduce((sum, m) => sum + m.content.length, 0);
  return Math.max(1, Math.round(chars / 4)) + req.maxOutputTokens;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * `ProviderAdapter` for Groq's OpenAI-compatible `/openai/v1/chat/completions`
 * endpoint (architecture §12.3). Talks to real HTTP by default; every
 * network/timeout/HTTP-error path is translated to a `GatewayError` before
 * it can escape this class (architecture §19.2, enforced in this
 * package's own conformance-suite run — see `test/groq-adapter.test.ts`).
 */
export class GroqAdapter implements ProviderAdapter {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;

  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly rateLimiter: TokenBucketRateLimiter;
  private readonly pricing: GroqPricing;
  private readonly streamIncludeUsage: boolean;

  constructor(options: GroqAdapterOptions = {}) {
    this.id = options.id ?? "groq";
    this.capabilities = { ...DEFAULT_CAPABILITIES, ...options.capabilities };
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.pricing = options.pricing ?? DEFAULT_PRICING;
    this.streamIncludeUsage = options.streamIncludeUsage ?? true;
    this.rateLimiter =
      options.rateLimiter ??
      new TokenBucketRateLimiter({
        requestsPerMinute: this.capabilities.rateLimits.requestsPerMinute,
        tokensPerMinute: this.capabilities.rateLimits.tokensPerMinute,
      });
  }

  async invoke(req: NormalizedInvocation, cred: ScopedCredential): Promise<NormalizedResult> {
    assertCredential(cred);
    await this.rateLimiter.acquire(estimateTokens(req), req.timeoutMs);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);
    timer.unref?.();

    try {
      const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cred.key}`, "Content-Type": "application/json" },
        body: JSON.stringify(toGroqRequestBody({ ...req, stream: false }, false)),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw mapGroqHttpError(res.status, await res.text());
      }

      const json = (await res.json()) as GroqChatCompletionResponse;
      return fromGroqResponse(json);
    } catch (error) {
      if (isAbortError(error)) {
        throw createGatewayError("TIMEOUT", `Exceeded timeoutMs=${req.timeoutMs}`);
      }
      if (isGatewayError(error)) throw error;
      throw createGatewayError("INTERNAL_ERROR", `Groq request failed: ${errorMessage(error)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  async *invokeStream(
    req: NormalizedInvocation,
    cred: ScopedCredential,
  ): AsyncIterable<NormalizedChunk> {
    assertCredential(cred);
    await this.rateLimiter.acquire(estimateTokens(req), req.timeoutMs);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);
    timer.unref?.();

    try {
      let res: Response;
      try {
        res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${cred.key}`, "Content-Type": "application/json" },
          body: JSON.stringify(
            toGroqRequestBody({ ...req, stream: true }, this.streamIncludeUsage),
          ),
          signal: controller.signal,
        });
      } catch (error) {
        if (isAbortError(error))
          throw createGatewayError("TIMEOUT", `Exceeded timeoutMs=${req.timeoutMs}`);
        throw createGatewayError(
          "INTERNAL_ERROR",
          `Groq streaming request failed: ${errorMessage(error)}`,
        );
      }

      if (!res.ok) {
        throw mapGroqHttpError(res.status, await res.text());
      }
      if (!res.body) {
        throw createGatewayError("INTERNAL_ERROR", "Groq streaming response had no body.");
      }

      let sawTerminal = false;
      for await (const payload of parseSseDataLines(res.body)) {
        let event: GroqChatCompletionResponse;
        try {
          event = JSON.parse(payload) as GroqChatCompletionResponse;
        } catch {
          throw createGatewayError("INTERNAL_ERROR", "Received a malformed SSE frame from Groq.");
        }
        const chunk = fromGroqStreamEvent(event);
        if (!chunk) continue;
        if (chunk.done) sawTerminal = true;
        yield chunk;
      }

      if (!sawTerminal) {
        // The stream ended (or was aborted) without a terminal chunk —
        // never let a truncated stream look like a clean completion
        // (architecture §19.2).
        throw createGatewayError("INTERNAL_ERROR", "Groq stream ended without a terminal chunk.");
      }
    } catch (error) {
      if (isAbortError(error))
        throw createGatewayError("TIMEOUT", `Exceeded timeoutMs=${req.timeoutMs}`);
      if (isGatewayError(error)) throw error;
      throw createGatewayError("INTERNAL_ERROR", `Groq stream failed: ${errorMessage(error)}`);
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
        throw mapGroqHttpError(res.status, await res.text());
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
