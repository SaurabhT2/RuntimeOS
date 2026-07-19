import { describe, expect, it } from "vitest";
import { mapNimHttpError } from "../src/http-errors.js";

describe("mapNimHttpError", () => {
  it.each([
    [401, "CREDENTIAL_INVALID", false],
    [403, "CREDENTIAL_INVALID", false],
    [429, "RATE_LIMITED", true],
    [400, "INVALID_SCHEMA", false],
    [404, "INVALID_SCHEMA", false],
    [422, "INVALID_SCHEMA", false],
    [500, "INTERNAL_ERROR", false],
    [503, "INTERNAL_ERROR", false],
  ] as const)("maps HTTP %i to %s (retryable: %s)", (status, code, retryable) => {
    const error = mapNimHttpError(status, "body");
    expect(error.code).toBe(code);
    expect(error.retryable).toBe(retryable);
  });

  it("truncates a long response body in the message", () => {
    expect(mapNimHttpError(500, "x".repeat(1000)).message.length).toBeLessThan(600);
  });
});
