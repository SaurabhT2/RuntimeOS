import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  GATEWAY_ERROR_CODES,
  GatewayError,
  gatewayErrorCodeSchema,
  gatewayErrorPayloadSchema,
  isGatewayError,
} from "../src/errors.js";

function loadFixture(name: string): unknown {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf-8"));
}

describe("GatewayError", () => {
  it("constructs with code, message, retryable, and optional details", () => {
    const err = new GatewayError("TIMEOUT", "request timed out", true, { deadlineMs: 5000 });
    expect(err.code).toBe("TIMEOUT");
    expect(err.message).toBe("request timed out");
    expect(err.retryable).toBe(true);
    expect(err.details).toEqual({ deadlineMs: 5000 });
    expect(err.name).toBe("GatewayError");
  });

  it("is a real Error instance and an instanceof GatewayError", () => {
    const err = new GatewayError("INTERNAL_ERROR", "boom", false);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(GatewayError);
  });

  it("serializes via toJSON to a payload matching gatewayErrorPayloadSchema", () => {
    const err = new GatewayError("RATE_LIMITED", "slow down", true, { retryAfterMs: 2000 });
    const payload = err.toJSON();
    expect(gatewayErrorPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it.each(GATEWAY_ERROR_CODES)("accepts %s as a valid code", (code) => {
    const err = new GatewayError(code, "msg", false);
    expect(gatewayErrorCodeSchema.safeParse(err.code).success).toBe(true);
  });
});

describe("isGatewayError", () => {
  it("returns true for a GatewayError instance", () => {
    expect(isGatewayError(new GatewayError("TIMEOUT", "x", true))).toBe(true);
  });

  it("returns false for a plain Error or arbitrary value", () => {
    expect(isGatewayError(new Error("plain"))).toBe(false);
    expect(isGatewayError({ code: "TIMEOUT" })).toBe(false);
    expect(isGatewayError(null)).toBe(false);
  });
});

describe("gatewayErrorPayloadSchema", () => {
  it("parses the hand-written valid GatewayError fixture", () => {
    expect(
      gatewayErrorPayloadSchema.safeParse(loadFixture("gateway-error.valid.json")).success,
    ).toBe(true);
  });

  it("rejects a payload with an unrecognized error code", () => {
    const invalid = {
      name: "GatewayError",
      code: "SOMETHING_MADE_UP",
      message: "x",
      retryable: false,
    };
    expect(gatewayErrorPayloadSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a payload with the wrong name discriminator", () => {
    const invalid = {
      name: "Error",
      code: "TIMEOUT",
      message: "x",
      retryable: false,
    };
    expect(gatewayErrorPayloadSchema.safeParse(invalid).success).toBe(false);
  });
});
