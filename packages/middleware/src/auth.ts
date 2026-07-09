import { GatewayError } from "@ai-gateway/core-contracts";
import type { Telemetry } from "@ai-gateway/telemetry";
import type { ApiKeyRecord, AuthContext } from "./types.js";

/**
 * architecture §20.5: "Standard RBAC at the API layer... implemented as
 * `AuthMiddleware` + a policy-check step, independent of the execution
 * core, so authorization logic can evolve without touching orchestration
 * logic." This is that `AuthMiddleware` — the policy-check *step* itself
 * (which roles may do what) is explicitly named as a separate concern by
 * that same sentence and is not part of the Engineering Blueprint's EM-4
 * feature list (see this package's README, Scope Verification); this class
 * is only the identity-resolution half.
 *
 * ## Why API keys are a constructor option, not `@ai-gateway/config`
 *
 * `GatewayConfig` (architecture §10.6, `@ai-gateway/config`, frozen at
 * EM-1) has no field for API keys, roles, or any other auth material —
 * `credentialPriority`/`routing`/`reliability` are its only sections. This
 * package cannot add one (EM-1 is frozen); see this package's README,
 * Engineering Decisions, and ADR-0009 for the full reasoning. The
 * constructor-injected `Map` here is the same shape of workaround
 * `policy-engine` already used for the analogous `config` gap it hit
 * (ADR-0006) and `orchestrator` uses for its adapter registry (ADR-0008):
 * whichever package eventually owns real key storage (a database-backed
 * store, mirroring `credential-resolver`'s `CredentialStore`) only needs to
 * implement this same constructor shape.
 */
export interface AuthMiddlewareOptions {
  keys: ApiKeyRecord[];
  telemetry: Telemetry;
}

export class AuthMiddleware {
  private readonly byKey: Map<string, ApiKeyRecord>;
  private readonly telemetry: Telemetry;

  constructor(options: AuthMiddlewareOptions) {
    this.byKey = new Map(options.keys.map((record) => [record.apiKey, record]));
    this.telemetry = options.telemetry;
  }

  /**
   * Resolves a caller-supplied API key to an {@link AuthContext}.
   * Synchronous and total: an unknown or missing key never throws a raw
   * `Error`, always a `GatewayError("CREDENTIAL_INVALID", ..., false)` —
   * the closest fit in `core-contracts`' `GatewayErrorCode` union for "the
   * caller's credential to *this gateway* (as opposed to a provider
   * credential, which is `credential-resolver`'s concern) did not check
   * out" (`core-contracts` has no dedicated `UNAUTHORIZED`/`FORBIDDEN`
   * code — see this package's README, Engineering Decisions).
   */
  authenticate(apiKey: string | undefined): AuthContext {
    if (!apiKey) {
      this.telemetry.recordMetric("middleware.auth.failure", 1, { reason: "missing_key" });
      throw new GatewayError("CREDENTIAL_INVALID", "No API key was supplied.", false);
    }
    const record = this.byKey.get(apiKey);
    if (!record) {
      this.telemetry.recordMetric("middleware.auth.failure", 1, { reason: "unknown_key" });
      throw new GatewayError(
        "CREDENTIAL_INVALID",
        "The supplied API key is not recognized.",
        false,
      );
    }
    this.telemetry.recordMetric("middleware.auth.success", 1, {
      organizationId: record.tenant.organizationId,
    });
    return { tenant: record.tenant, role: record.role, keyId: maskKey(apiKey) };
  }
}

/**
 * `keyId` on {@link AuthContext} exists precisely so that logs/telemetry
 * never need to touch the raw key (a plaintext secret) — this derives a
 * short, stable, non-reversible-enough-for-logs identifier from it. Not a
 * cryptographic commitment; good enough for "which configured key was
 * this" in a log line, which is the only thing `keyId` is for.
 */
function maskKey(apiKey: string): string {
  return apiKey.length <= 8 ? "****" : `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
}
