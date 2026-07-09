import type { IncomingMessage, ServerResponse } from "node:http";
import type { GatewayApp } from "../../bootstrap.js";
import { sendJson } from "../respond.js";

interface ProviderHealthSummary {
  providerId: string;
  healthy: boolean;
  latencyMs?: number;
  message?: string;
}

export interface HealthResponseBody {
  status: "ok" | "degraded" | "unhealthy";
  providers: ProviderHealthSummary[];
}

/**
 * architecture §10.2's `GET /v1/health` ("gateway + provider health
 * summary") and this milestone's own "Validate that readiness reflects
 * actual runtime state rather than static success" requirement. Performs a
 * real `ProviderAdapter.healthCheck` against every registered adapter
 * (never a hardcoded `{ status: "ok" }`) using a platform-scoped
 * credential — a health probe has no caller/tenant of its own, so it
 * resolves under a reserved sentinel tenant rather than any real caller's
 * scope. A per-provider check failure (missing platform credential,
 * network error, non-2xx) is caught and reported as that provider being
 * unhealthy — never allowed to throw and take the whole health route down
 * with it, since "one provider is down" must never look like "the gateway
 * itself is down" to an orchestrator/load-balancer reading this endpoint.
 *
 * Overall `status` is `"ok"` if at least one provider is healthy (the
 * gateway can still serve traffic via failover), `"degraded"` if at least
 * one but not all are healthy, and `"unhealthy"` only if every registered
 * provider failed its check.
 */
export async function handleHealth(
  _req: IncomingMessage,
  res: ServerResponse,
  app: GatewayApp,
): Promise<void> {
  const healthCheckTenant = { organizationId: "__gateway_health_check__" };

  const providers = await Promise.all(
    app.adapters.map(async (adapter): Promise<ProviderHealthSummary> => {
      try {
        const cred = await app.credentialResolver.resolve(adapter.id, healthCheckTenant);
        const snapshot = await adapter.healthCheck(cred);
        return {
          providerId: adapter.id,
          healthy: snapshot.healthy,
          latencyMs: snapshot.latencyMs,
          message: snapshot.message,
        };
      } catch (error) {
        return {
          providerId: adapter.id,
          healthy: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );

  const healthyCount = providers.filter((p) => p.healthy).length;
  const status: HealthResponseBody["status"] =
    healthyCount === providers.length ? "ok" : healthyCount > 0 ? "degraded" : "unhealthy";

  const httpStatus = status === "unhealthy" ? 503 : 200;
  sendJson(res, httpStatus, { status, providers } satisfies HealthResponseBody);
}
