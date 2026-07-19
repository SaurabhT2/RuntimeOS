import type { ExecuteResponse, StreamChunk } from "@ai-gateway/core-contracts";
import type { StrategyDecision } from "@ai-gateway/strategy-layer";

/**
 * architecture §30.3/§33.4: "If `cacheHit` is present, the Orchestrator
 * returns it directly and never invokes the Policy Engine at all for that
 * request — the cheapest possible execution is simply not executing."
 * This is the one place `StrategyDecision.cacheHit` (architecture §30.3)
 * is translated into the public `ExecuteResponse` shape (architecture
 * §10.4) — `cacheHit`'s own shape (`@ai-gateway/cost-optimizer`'s
 * `CachedResult`) is deliberately minimal (`content`, optional
 * `providerId`/`modelId`, `cachedAt`), so this mapping fills in the
 * remaining required `ExecuteResponse` fields with values that honestly
 * describe "this was served from cache, not a live provider call": zero
 * cost, zero latency (no provider round-trip happened), zero retries, no
 * failover, and a synthetic `execution.providerId`/`modelClass` of
 * `"cache"` when the cached entry didn't record which provider originally
 * produced it.
 */
export function buildCacheHitResponse(
  requestId: string,
  cacheHit: NonNullable<StrategyDecision["cacheHit"]>,
): ExecuteResponse {
  return {
    requestId,
    output: { text: cacheHit.content },
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
    },
    execution: {
      providerId: cacheHit.providerId ?? "cache",
      modelClass: cacheHit.modelId ?? "cache",
      latencyMs: 0,
      retries: 0,
      failedOver: false,
    },
    finishReason: "stop",
  };
}

/** Streaming counterpart of {@link buildCacheHitResponse} — a single, already-`done` chunk, since the entire cached content is available immediately (architecture §12.1's streaming variant has no partial-cache concept). */
export function buildCacheHitStreamChunk(
  requestId: string,
  cacheHit: NonNullable<StrategyDecision["cacheHit"]>,
): StreamChunk {
  return {
    requestId,
    delta: { text: cacheHit.content },
    done: true,
    finishReason: "stop",
  };
}
