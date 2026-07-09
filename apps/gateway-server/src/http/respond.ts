import type { ServerResponse } from "node:http";
import { GatewayError, isGatewayError, type GatewayErrorCode } from "@ai-gateway/core-contracts";

/**
 * architecture §19.1's error taxonomy table maps `GatewayErrorCode` to HTTP
 * status only loosely ("Auth/credential errors -> 401/424", "everything
 * else" left to this layer's judgment) — architecture §10 does not name a
 * single canonical `GatewayErrorCode`-to-status table anywhere, and no
 * earlier milestone needed one (there was no HTTP layer before EM-5). This
 * is therefore a designed-here mapping, following the same "make the
 * judgment call and document it" pattern the rest of this codebase already
 * uses for similar gaps (e.g. `orchestrator`'s failover-eligibility
 * blocklist, ADR-0008/0009).
 *
 * `CREDENTIAL_INVALID` and `CREDENTIAL_NOT_FOUND` are the one genuinely
 * ambiguous pair — architecture §19.1 lists both under the same "401/424"
 * cell without saying which gets which. This file splits them by which
 * layer is more likely to have produced each: `AuthMiddleware.authenticate`
 * (this gateway's own caller-identity check) is the only place in the
 * codebase that throws `CREDENTIAL_INVALID` for a *gateway* API key, so
 * `CREDENTIAL_INVALID` -> 401 ("who are you" failed); `CREDENTIAL_NOT_FOUND`
 * is what `credential-resolver` throws when no *provider* credential could
 * be resolved for an authenticated caller, so it -> 424 Failed Dependency
 * ("we know who you are, but couldn't reach a provider on your behalf").
 * `credential-resolver` can also throw `CREDENTIAL_INVALID` itself (a
 * malformed stored reference, a decryption failure) — those are rarer,
 * operator-facing integrity problems, not caller-facing auth failures, but
 * they still map to 401 under this table since the code alone can't
 * distinguish the two call sites from here. Flagged for the Board as a
 * possible future refinement, not a defect blocking this milestone.
 */
const STATUS_BY_CODE: Record<GatewayErrorCode, number> = {
  INVALID_TASK: 400,
  INVALID_SCHEMA: 400,
  CREDENTIAL_INVALID: 401,
  CREDENTIAL_NOT_FOUND: 424,
  RATE_LIMITED: 429,
  TIMEOUT: 504,
  // 499 ("Client Closed Request") is not an IANA-registered status but is
  // widely understood in gateway/reverse-proxy contexts (nginx originated
  // it) for exactly this case: the caller's own request was cancelled, not
  // a server-side failure. `CANCELLED` results from the caller's own
  // `AbortSignal`/disconnect (this route's own handling, see execute.ts)
  // or an explicit `cancel(requestId)` call, never from a gateway defect.
  CANCELLED: 499,
  CONTENT_FILTERED: 422,
  ALL_PROVIDERS_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

export function statusForGatewayError(error: GatewayError): number {
  return STATUS_BY_CODE[error.code] ?? 500;
}

/** Every non-2xx response body shape this server ever sends — always a serialized `GatewayError`, never a raw stack trace or exception message (architecture §19.1/§19.3). */
export interface ErrorResponseBody {
  error: ReturnType<GatewayError["toJSON"]>;
}

export function toErrorResponseBody(error: unknown): { status: number; body: ErrorResponseBody } {
  if (isGatewayError(error)) {
    return { status: statusForGatewayError(error), body: { error: error.toJSON() } };
  }
  // Anything that escapes as a non-`GatewayError` is itself the bug this
  // milestone's Error Handling section calls out ("no raw exceptions
  // should escape the public API") — caught here as a last line of
  // defense so the HTTP layer never leaks an internal exception's message
  // or stack to a caller, matching architecture §19.3's "generic message
  // returned to caller" principle even for a failure mode no lower layer
  // anticipated.
  const wrapped = new GatewayError(
    "INTERNAL_ERROR",
    "An unexpected internal error occurred.",
    false,
  );
  return { status: 500, body: { error: wrapped.toJSON() } };
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

export function sendError(res: ServerResponse, error: unknown): void {
  const { status, body } = toErrorResponseBody(error);
  if (isGatewayError(error) && error.code === "RATE_LIMITED") {
    const retryAfterMs = error.details?.retryAfterMs;
    if (typeof retryAfterMs === "number") {
      res.setHeader("retry-after", String(Math.ceil(retryAfterMs / 1000)));
    }
  }
  sendJson(res, status, body);
}
