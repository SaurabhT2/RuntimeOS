import type { ChatMessage } from "@ai-gateway/core-contracts";
import type { ExecuteRequest } from "@ai-gateway/core-contracts";

/**
 * `ExecuteRequest.input` (architecture §10.3) carries `text` and/or
 * `messages`; `@ai-gateway/prompt-optimizer`'s frozen `PromptOptimizer.optimize`
 * (architecture §34.2) takes only `ChatMessage[]`. This is a deliberate,
 * small duplicate of `orchestrator`'s own `resolveMessages` (in
 * `invocation-builder.ts`) rather than an import from `orchestrator` —
 * `strategy-layer` must not depend on `orchestrator` (ADR-0016: that edge
 * runs the other way, `orchestrator → strategy-layer`; the reverse would
 * be the exact cycle that ADR corrects). `orchestrator`'s validation
 * (`DefaultExecutionOrchestrator.validate`) already guarantees at least one
 * of `text`/`messages` is present by the time any request reaches this
 * package in production; this function still handles the "neither" case
 * defensively for this package's own unit tests, which construct requests
 * directly without going through that validation.
 */
export function resolveMessages(req: ExecuteRequest): ChatMessage[] {
  if (req.input.messages && req.input.messages.length > 0) {
    return req.input.messages;
  }
  if (req.input.text !== undefined) {
    return [{ role: "user", content: req.input.text }];
  }
  return [];
}
