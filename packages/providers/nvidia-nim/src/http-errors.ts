import type { GatewayError } from "@ai-gateway/core-contracts";
import { createGatewayError } from "@ai-gateway/provider-sdk";

/**
 * Maps a NIM HTTP error response to the matching `GatewayError` (never a
 * raw HTTP/fetch exception, architecture §19.2). Mirrors
 * `@ai-gateway/groq`'s `mapGroqHttpError` — see this package's
 * `openai-compat.ts` doc comment for why the translation layer is
 * duplicated rather than shared between the two adapter packages.
 */
export function mapNimHttpError(status: number, bodyText: string): GatewayError {
  const detail = `NVIDIA NIM HTTP ${status}: ${bodyText.slice(0, 500)}`;

  if (status === 401 || status === 403) {
    return createGatewayError("CREDENTIAL_INVALID", detail);
  }
  if (status === 429) {
    return createGatewayError("RATE_LIMITED", detail);
  }
  if (status === 400 || status === 404 || status === 422) {
    return createGatewayError("INVALID_SCHEMA", detail);
  }
  return createGatewayError("INTERNAL_ERROR", detail);
}
