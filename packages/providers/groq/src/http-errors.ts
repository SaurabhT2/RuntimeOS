import type { GatewayError } from "@ai-gateway/core-contracts";
import { createGatewayError } from "@ai-gateway/provider-sdk";

/**
 * Maps a Groq HTTP error response to the matching `GatewayError` (never
 * a raw HTTP/fetch exception, architecture §19.2). Groq's error body is
 * OpenAI-compatible (`{ error: { message, type, code } }`), but only the
 * HTTP status is consulted here — the body's `message` is folded into the
 * `GatewayError`'s own message for diagnostics, never parsed for control
 * flow (a provider's exact error-body shape is exactly the kind of detail
 * this translation layer exists to insulate the rest of the codebase
 * from).
 */
export function mapGroqHttpError(status: number, bodyText: string): GatewayError {
  const detail = `Groq HTTP ${status}: ${bodyText.slice(0, 500)}`;

  if (status === 401 || status === 403) {
    return createGatewayError("CREDENTIAL_INVALID", detail);
  }
  if (status === 429) {
    return createGatewayError("RATE_LIMITED", detail);
  }
  if (status === 400 || status === 404 || status === 422) {
    // Malformed/unsupported request shape (including an unrecognized
    // model identifier) — closest architecture §19.1 taxonomy fit for "the
    // request this adapter sent was rejected as invalid."
    return createGatewayError("INVALID_SCHEMA", detail);
  }
  return createGatewayError("INTERNAL_ERROR", detail);
}
