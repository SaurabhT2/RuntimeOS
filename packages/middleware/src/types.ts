import type { ExecuteRequest } from "@ai-gateway/core-contracts";

/**
 * `core-contracts` does not export a standalone `TenantContext` type — only
 * `ExecuteRequest.tenant`, an inline object (architecture §10.3). Aliased
 * here, rather than duplicated field-for-field, since `middleware` *does*
 * have a dependency edge onto `core-contracts` (Section 4.1's
 * `DEPENDENCY_TABLE`) — this is a plain re-export-by-indexed-access for
 * readability across this package's files, not a cross-boundary structural
 * duplicate (contrast `orchestrator/src/types.ts`, which duplicates because
 * it has no such edge onto the package that owns the original type).
 */
export type TenantContext = ExecuteRequest["tenant"];

/**
 * architecture §20.5's RBAC roles, verbatim ("`org_admin`, `workspace_admin`,
 * `member`"). Deliberately a closed set here (not `string`) — `AuthContext`
 * is produced only by this package's own `AuthMiddleware`, never accepted
 * from a caller, so there is no forward-compatibility reason to leave it
 * open the way `core-contracts`' `TaskType` deliberately is.
 */
export const ROLES = ["org_admin", "workspace_admin", "member"] as const;
export type Role = (typeof ROLES)[number];

/**
 * What `AuthMiddleware.authenticate` produces from a caller-supplied API
 * key: the tenant scope the rest of the pipeline (rate limiting, caching)
 * keys off of, plus the role a future RBAC policy-check step (architecture
 * §20.5 — not itself EM-4 scope, see this package's README) gates on.
 */
export interface AuthContext {
  tenant: TenantContext;
  role: Role;
  /** The API key's own identifier (never the raw key) — safe to log/attach to telemetry. */
  keyId: string;
}

/** A single configured API key → identity mapping (`AuthMiddlewareOptions.keys`). */
export interface ApiKeyRecord {
  apiKey: string;
  tenant: TenantContext;
  role: Role;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Remaining requests in the current window, floored at 0. */
  remaining: number;
  /** Milliseconds until the caller should retry, present only when `allowed` is `false`. */
  retryAfterMs?: number;
}
