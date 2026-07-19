import type { Telemetry } from "@ai-gateway/telemetry";
import type { CredentialScope } from "@ai-gateway/config";
import type { TenantContext } from "./types.js";

/**
 * architecture §15.4: "register, resolve — at scope-decision granularity,
 * not per-token, rotate, revoke." `resolve` here means "which scope's
 * `ScopeResolver` produced a hit," not one entry per token/call — a
 * request that resolves once still produces exactly one `resolve` audit
 * event, matching the "not per-token" qualifier.
 */
export const AUDIT_EVENT_TYPES = ["register", "resolve", "rotate", "revoke"] as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

/**
 * architecture §20.3, verbatim field list: "actor, tenant scope, provider,
 * timestamp, and outcome — explicitly excluding the secret value itself."
 * There is deliberately no field anywhere in this shape capable of holding
 * a raw key, so a future refactor can't accidentally start logging one.
 */
export interface AuditEvent {
  type: AuditEventType;
  /** Who performed the action — a user/service identifier, never a secret. */
  actor: string;
  scope: CredentialScope;
  tenant: TenantContext;
  provider: string;
  timestamp: string;
  outcome: "success" | "failure";
  /** Optional non-secret detail, e.g. a failure reason string. Never the credential's `key` value. */
  detail?: string;
}

/**
 * architecture §11 doesn't name an `AuditLogger` interface — audit logging
 * is described only in prose (§15.4, §20.3). This interface is designed,
 * not specified, kept intentionally to a single method (Blueprint §12's
 * "more than 3-4 methods is a signal to reconsider scope" — one method
 * covering four event *types* via a discriminated field is simpler than
 * four near-identical methods).
 */
export interface AuditLogger {
  record(event: Omit<AuditEvent, "timestamp">): void;
}

/**
 * Default `AuditLogger`: forwards to `@ai-gateway/telemetry`'s
 * `Telemetry.log`, which is this codebase's one seam for anything durable
 * and cross-cutting (Blueprint §8.3) — a dedicated audit-log
 * store/transport is not introduced here, since `Telemetry`'s structured
 * logging already satisfies "append-only... actor, tenant scope, provider,
 * timestamp, and outcome" (architecture §20.3) once a real log sink is
 * wired at deployment (EM-5's bootstrap, matching `telemetry`'s own
 * documented no-exporter-registered-here stance).
 */
export class DefaultAuditLogger implements AuditLogger {
  constructor(private readonly telemetry: Telemetry) {}

  record(event: Omit<AuditEvent, "timestamp">): void {
    const full: AuditEvent = { ...event, timestamp: new Date().toISOString() };
    this.telemetry.log("info", `credential_audit:${full.type}`, {
      auditEventType: full.type,
      actor: full.actor,
      scope: full.scope,
      provider: full.provider,
      tenant: full.tenant,
      outcome: full.outcome,
      detail: full.detail,
      timestamp: full.timestamp,
    });
  }
}
