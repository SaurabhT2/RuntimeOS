/**
 * architecture §11 (`ProviderAdapter.healthCheck()`, `HealthMonitor.getHealth()`
 * — shape not spelled out there). A point-in-time health assessment for one
 * provider, used by the Health Monitor (`reliability`, Wave 2) to pick
 * failover targets and by the Policy Engine to avoid routing to a
 * known-unhealthy provider.
 */
export interface ProviderHealthSnapshot {
  providerId: string;
  healthy: boolean;
  /** Round-trip latency of the health check itself, when it succeeded. */
  latencyMs?: number;
  /** ISO-8601 timestamp of when this snapshot was produced. */
  lastCheckedAt: string;
  /** Consecutive failed health checks/invocations, reset to 0 on success. */
  consecutiveFailures: number;
  /** Human-readable detail when `healthy` is false. */
  message?: string;
}
