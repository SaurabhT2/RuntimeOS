import { describe, expect, it } from "vitest";
import { isGatewayError } from "@ai-gateway/core-contracts";
import { AuthMiddleware } from "../src/auth.js";
import { fakeTelemetry } from "./fixtures.js";

const tenant = { organizationId: "org-1", workspaceId: "ws-1" };

function middleware(): AuthMiddleware {
  return new AuthMiddleware({
    keys: [{ apiKey: "sk-valid-key-12345", tenant, role: "member" }],
    telemetry: fakeTelemetry(),
  });
}

describe("AuthMiddleware.authenticate", () => {
  it("resolves a valid API key to its configured AuthContext", () => {
    const auth = middleware().authenticate("sk-valid-key-12345");
    expect(auth.tenant).toEqual(tenant);
    expect(auth.role).toBe("member");
  });

  it("never leaks the raw key back out via keyId", () => {
    const auth = middleware().authenticate("sk-valid-key-12345");
    expect(auth.keyId).not.toContain("valid-key-12345");
    expect(auth.keyId).toMatch(/^sk-v\.\.\./);
  });

  it("throws a non-retryable CREDENTIAL_INVALID for an unrecognized key", () => {
    try {
      middleware().authenticate("sk-not-a-real-key");
      expect.unreachable();
    } catch (error) {
      expect(isGatewayError(error)).toBe(true);
      if (isGatewayError(error)) {
        expect(error.code).toBe("CREDENTIAL_INVALID");
        expect(error.retryable).toBe(false);
      }
    }
  });

  it("throws CREDENTIAL_INVALID for a missing key", () => {
    try {
      middleware().authenticate(undefined);
      expect.unreachable();
    } catch (error) {
      expect(isGatewayError(error)).toBe(true);
      if (isGatewayError(error)) {
        expect(error.code).toBe("CREDENTIAL_INVALID");
      }
    }
  });

  it("masks a short key entirely rather than partially revealing it", () => {
    const short = new AuthMiddleware({
      keys: [{ apiKey: "sk-1", tenant, role: "member" }],
      telemetry: fakeTelemetry(),
    });
    expect(short.authenticate("sk-1").keyId).toBe("****");
  });
});
