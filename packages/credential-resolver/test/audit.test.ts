import { describe, expect, it, vi } from "vitest";
import { DefaultAuditLogger } from "../src/audit.js";
import type { Telemetry } from "@ai-gateway/telemetry";
import type { TenantContext } from "../src/types.js";

const tenant: TenantContext = { organizationId: "org-a", workspaceId: "ws-a" };

function fakeTelemetry(): Telemetry & { log: ReturnType<typeof vi.fn> } {
  return {
    startSpan: vi.fn(),
    recordMetric: vi.fn(),
    log: vi.fn(),
  } as unknown as Telemetry & { log: ReturnType<typeof vi.fn> };
}

describe("DefaultAuditLogger", () => {
  it("forwards a resolve event to Telemetry.log with the architecture §20.3 field set", () => {
    const telemetry = fakeTelemetry();
    const logger = new DefaultAuditLogger(telemetry);

    logger.record({
      type: "resolve",
      actor: "user-a",
      scope: "workspace",
      tenant,
      provider: "groq",
      outcome: "success",
    });

    expect(telemetry.log).toHaveBeenCalledTimes(1);
    const [level, message, fields] = telemetry.log.mock.calls[0]!;
    expect(level).toBe("info");
    expect(message).toBe("credential_audit:resolve");
    expect(fields).toMatchObject({
      auditEventType: "resolve",
      actor: "user-a",
      scope: "workspace",
      provider: "groq",
      tenant,
      outcome: "success",
    });
    expect(typeof fields.timestamp).toBe("string");
  });

  it("never includes a secret/key field in the logged fields", () => {
    const telemetry = fakeTelemetry();
    const logger = new DefaultAuditLogger(telemetry);

    logger.record({
      type: "register",
      actor: "user-a",
      scope: "user",
      tenant,
      provider: "groq",
      outcome: "success",
    });

    const [, , fields] = telemetry.log.mock.calls[0]!;
    expect(Object.keys(fields as object)).not.toContain("key");
    expect(Object.keys(fields as object)).not.toContain("plaintextKey");
    expect(Object.keys(fields as object)).not.toContain("encryptedKey");
  });

  it("logs each of register/resolve/rotate/revoke with the correct message prefix", () => {
    const telemetry = fakeTelemetry();
    const logger = new DefaultAuditLogger(telemetry);

    for (const type of ["register", "resolve", "rotate", "revoke"] as const) {
      logger.record({
        type,
        actor: "user-a",
        scope: "user",
        tenant,
        provider: "groq",
        outcome: "success",
      });
    }

    const messages = telemetry.log.mock.calls.map((call) => call[1]);
    expect(messages).toEqual([
      "credential_audit:register",
      "credential_audit:resolve",
      "credential_audit:rotate",
      "credential_audit:revoke",
    ]);
  });

  it("carries an optional detail field through for failures", () => {
    const telemetry = fakeTelemetry();
    const logger = new DefaultAuditLogger(telemetry);

    logger.record({
      type: "resolve",
      actor: "user-a",
      scope: "platform",
      tenant,
      provider: "groq",
      outcome: "failure",
      detail: "no scope resolved a credential",
    });

    const [, , fields] = telemetry.log.mock.calls[0]!;
    expect(fields.detail).toBe("no scope resolved a credential");
  });
});
