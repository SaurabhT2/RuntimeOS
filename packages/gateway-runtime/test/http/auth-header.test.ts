import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import { extractApiKey } from "../../src/http/auth-header.js";

function fakeReq(headers: Record<string, string>): IncomingMessage {
  return { headers } as IncomingMessage;
}

describe("extractApiKey", () => {
  it("extracts a Bearer token from the Authorization header", () => {
    expect(extractApiKey(fakeReq({ authorization: "Bearer abc123" }))).toBe("abc123");
  });

  it("is case-insensitive on the Bearer scheme", () => {
    expect(extractApiKey(fakeReq({ authorization: "bearer abc123" }))).toBe("abc123");
  });

  it("falls back to x-api-key when Authorization is absent", () => {
    expect(extractApiKey(fakeReq({ "x-api-key": "xyz789" }))).toBe("xyz789");
  });

  it("prefers Authorization over x-api-key when both are present", () => {
    expect(extractApiKey(fakeReq({ authorization: "Bearer abc123", "x-api-key": "xyz789" }))).toBe(
      "abc123",
    );
  });

  it("returns undefined when neither header is present", () => {
    expect(extractApiKey(fakeReq({}))).toBeUndefined();
  });

  it("returns undefined for a malformed Authorization header (not Bearer)", () => {
    expect(extractApiKey(fakeReq({ authorization: "Basic abc123" }))).toBeUndefined();
  });
});
