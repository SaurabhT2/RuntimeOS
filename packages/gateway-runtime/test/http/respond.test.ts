import { describe, expect, it, vi } from "vitest";
import { GatewayError } from "@ai-gateway/core-contracts";
import {
  sendError,
  sendJson,
  statusForGatewayError,
  toErrorResponseBody,
} from "../../src/http/respond.js";

function fakeResponse() {
  const headers: Record<string, string> = {};
  return {
    writeHead: vi.fn(),
    end: vi.fn(),
    setHeader: vi.fn((name: string, value: string) => {
      headers[name] = value;
    }),
    headers,
  };
}

describe("statusForGatewayError", () => {
  it.each([
    ["INVALID_TASK", 400],
    ["INVALID_SCHEMA", 400],
    ["CREDENTIAL_INVALID", 401],
    ["CREDENTIAL_NOT_FOUND", 424],
    ["RATE_LIMITED", 429],
    ["TIMEOUT", 504],
    ["CANCELLED", 499],
    ["CONTENT_FILTERED", 422],
    ["ALL_PROVIDERS_UNAVAILABLE", 503],
    ["INTERNAL_ERROR", 500],
    ["BUDGET_EXCEEDED", 402],
  ] as const)("maps %s to %d", (code, expected) => {
    const error = new GatewayError(code, "test", false);
    expect(statusForGatewayError(error)).toBe(expected);
  });
});

describe("toErrorResponseBody", () => {
  it("serializes a GatewayError via toJSON()", () => {
    const error = new GatewayError("RATE_LIMITED", "slow down", true, { retryAfterMs: 500 });
    const { status, body } = toErrorResponseBody(error);
    expect(status).toBe(429);
    expect(body.error).toEqual({
      name: "GatewayError",
      code: "RATE_LIMITED",
      message: "slow down",
      retryable: true,
      details: { retryAfterMs: 500 },
    });
  });

  it("wraps a non-GatewayError as a generic INTERNAL_ERROR, never leaking its message", () => {
    const { status, body } = toErrorResponseBody(new Error("some internal secret detail"));
    expect(status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).not.toContain("some internal secret detail");
  });
});

describe("sendJson", () => {
  it("writes a JSON content-type header and the serialized body", () => {
    const res = fakeResponse();
    sendJson(res as never, 200, { hello: "world" });
    expect(res.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({ "content-type": "application/json; charset=utf-8" }),
    );
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({ hello: "world" }));
  });
});

describe("sendError", () => {
  it("sets a retry-after header (in seconds) for RATE_LIMITED", () => {
    const res = fakeResponse();
    const error = new GatewayError("RATE_LIMITED", "slow down", true, { retryAfterMs: 2500 });
    sendError(res as never, error);
    expect(res.setHeader).toHaveBeenCalledWith("retry-after", "3");
    expect(res.writeHead).toHaveBeenCalledWith(429, expect.anything());
  });

  it("does not set retry-after for other error codes", () => {
    const res = fakeResponse();
    sendError(res as never, new GatewayError("INVALID_TASK", "bad", false));
    expect(res.setHeader).not.toHaveBeenCalled();
  });
});
