import {
  GatewayError,
  executeRequestSchema,
  type ExecuteRequest,
} from "@ai-gateway/core-contracts";

/**
 * `MiddlewarePipeline`'s stages (`CacheMiddleware` in particular —
 * `tenantKey(req.tenant)`) assume they're already handed a well-shaped
 * `ExecuteRequest` — reasonably, since every other caller of
 * `MiddlewarePipeline`/`AuthMiddleware`/`RateLimitMiddleware`/
 * `CacheMiddleware` in this codebase's own EM-4 test suite already
 * constructs one by hand. `ExecutionOrchestrator.execute`/`.executeStream`
 * validate the request shape themselves (`executeRequestSchema`), but
 * only *after* the middleware pipeline has already run — too late to stop
 * a malformed body (e.g. a missing `tenant`) from throwing a raw,
 * non-`GatewayError` exception inside `CacheMiddleware` first.
 *
 * This function is this composition root's fix for that gap: parsed JSON
 * is validated against the same `executeRequestSchema` orchestrator itself
 * uses — not a second, divergent schema — immediately after body-parsing
 * and before either route handler calls into middleware. This keeps
 * `middleware`'s own contract (frozen EM-4: "assumes a valid
 * `ExecuteRequest`") intact rather than changing it, and avoids
 * duplicating orchestrator's validation logic (same schema, same object,
 * imported from the same place) — this is HTTP-boundary input validation
 * (this milestone's own "Public API... Verify request validation"
 * requirement), not new business logic.
 */
export function validateExecuteRequest(body: unknown): ExecuteRequest {
  const parsed = executeRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new GatewayError(
      "INVALID_SCHEMA",
      `Malformed ExecuteRequest: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
      false,
      { issues: parsed.error.issues },
    );
  }
  if (
    !parsed.data.input.text &&
    (!parsed.data.input.messages || parsed.data.input.messages.length === 0)
  ) {
    throw new GatewayError(
      "INVALID_SCHEMA",
      "ExecuteRequest.input must supply non-empty `text` or `messages`.",
      false,
    );
  }
  return parsed.data;
}
