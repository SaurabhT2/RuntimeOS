import type { ChatMessage, ExecuteRequest } from "@ai-gateway/core-contracts";
import type { ExecutionPlan } from "@ai-gateway/policy-engine";
import type { NormalizedInvocation } from "./types.js";

/**
 * The seam ADR-0007 and `policy-engine`'s own README ("Relationship to
 * orchestrator/streaming") assign to `orchestrator`: translating an
 * `ExecuteRequest` (the caller's wire-level intent) plus an `ExecutionPlan`
 * (the Policy Engine's routing decision for *one* candidate — the primary
 * or a fallback) into the `NormalizedInvocation` a `ProviderAdapter`
 * actually consumes (architecture §12.1).
 *
 * Deliberately a pure function, not a method on the orchestrator class:
 * every other pipeline-stage function in this codebase (`policy-engine`'s
 * `classifyTask`/`scoreCandidates`/etc., `groq`'s `toGroqRequestBody`) is a
 * pure, independently-unit-testable mapping, and this is the same
 * convention (Blueprint §12 / architecture §24).
 */
export function buildNormalizedInvocation(
  req: ExecuteRequest,
  plan: ExecutionPlan,
): NormalizedInvocation {
  return {
    modelId: plan.modelId,
    messages: resolveMessages(req),
    temperature: plan.temperature,
    maxOutputTokens: plan.maxOutputTokens,
    responseFormat: req.constraints?.requiredSchema
      ? { type: "json", schema: req.constraints.requiredSchema }
      : undefined,
    stream: plan.streaming,
    timeoutMs: plan.timeoutMs,
  };
}

/**
 * `ExecuteRequest.input` (architecture §10.3) carries `text` and/or
 * `messages` — the wire contract allows either (a caller building a
 * single-turn `task` request typically supplies `text`; a caller building
 * a multi-turn chat-style request supplies `messages` directly). Every
 * `ProviderAdapter`, however, only ever receives a `messages` array
 * (architecture §12.1) — normalizing `text` into a single-turn `user`
 * message is this function's job, not each adapter's, so no adapter has to
 * reimplement it.
 */
function resolveMessages(req: ExecuteRequest): ChatMessage[] {
  if (req.input.messages && req.input.messages.length > 0) {
    return req.input.messages;
  }
  if (req.input.text !== undefined) {
    return [{ role: "user", content: req.input.text }];
  }
  // `executeRequestSchema` (core-contracts) does not itself require at
  // least one of `text`/`messages` to be present — both are optional
  // fields on `input`. A request with neither is meaningless to any
  // provider, so this is surfaced as an INVALID_SCHEMA fault by the
  // orchestrator's own request validation (`orchestrator.ts`), not here;
  // this function is never called with such a request. Returning an empty
  // array rather than throwing keeps this function total and side-effect
  // free, matching every other pipeline-stage function's convention.
  return [];
}
