import type { ServerResponse } from "node:http";
import { GatewayError, isGatewayError, type GatewayErrorCode } from "@ai-gateway/core-contracts";

/** `GatewayErrorCode` → HTTP status. Every non-2xx response body this gateway ever sends is a serialized `GatewayError` (architecture §19.1/§19.3), never a raw stack trace or exception message. */
const STATUS_BY_CODE: Record<GatewayErrorCode, number> = {
  INVALID_TASK: 400,
  INVALID_SCHEMA: 400,
  CREDENTIAL_INVALID: 401,
  CREDENTIAL_NOT_FOUND: 424,
  RATE_LIMITED: 429,
  TIMEOUT: 504,
  CANCELLED: 499,
  CONTENT_FILTERED: 422,
  ALL_PROVIDERS_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
  // EM-10 (architecture §43): 402 Payment Required — the literal,
  // conventional HTTP status for exactly this scenario, and deliberately
  // distinct from ALL_PROVIDERS_UNAVAILABLE's 503 (no provider was ever
  // unavailable; a policy decision was made before any was tried) and
  // RATE_LIMITED's 429 (a provider-side signal, not a spend-policy one).
  BUDGET_EXCEEDED: 402,
};

export function statusForGatewayError(error: GatewayError): number {
  return STATUS_BY_CODE[error.code] ?? 500;
}

export interface ErrorResponseBody {
  error: ReturnType<GatewayError["toJSON"]>;
}

export function toErrorResponseBody(error: unknown): { status: number; body: ErrorResponseBody } {
  if (isGatewayError(error)) {
    return { status: statusForGatewayError(error), body: { error: error.toJSON() } };
  }
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
