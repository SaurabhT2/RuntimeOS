import type { IncomingMessage } from "node:http";

/**
 * `AuthMiddleware.authenticate(apiKey: string | undefined)` (frozen EM-4)
 * doesn't specify where its `apiKey` argument comes from on the wire —
 * that's this HTTP layer's job to decide (architecture §10 names the REST
 * routes and payloads but not the auth header convention). `Authorization:
 * Bearer <key>` is the standard convention for a bearer-token API key and
 * is used here as the primary form; `x-api-key` is accepted as a fallback
 * for callers/tools that default to it. Returns `undefined` — never
 * throws — when neither is present; `AuthMiddleware.authenticate(undefined)`
 * already defines the correct `GatewayError("CREDENTIAL_INVALID", ...)`
 * behavior for that case, so this function does not duplicate that check.
 */
export function extractApiKey(req: IncomingMessage): string | undefined {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string") {
    const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
    if (match?.[1]) {
      return match[1];
    }
  }
  const apiKeyHeader = req.headers["x-api-key"];
  if (typeof apiKeyHeader === "string" && apiKeyHeader.length > 0) {
    return apiKeyHeader;
  }
  return undefined;
}
