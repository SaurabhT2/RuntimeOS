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
 * Architecture §10.2's `GET /v1/health` — a real `ProviderAdapter.
 * healthCheck` against every registered adapter, never a hardcoded
 * `{ status: "ok" }`. Under any hosting layer that runs multiple
 * concurrent instances (Vercel's Function model, or multiple
 * `apps/gateway-server` replicas behind a load balancer), this reflects
 * only whichever instance served the request — not a claim about every
 * instance (see `KNOWN_LIMITATIONS.md` §1.1).
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
