import { describe, expect, it } from "vitest";
import { mapGroqHttpError } from "../src/http-errors.js";

describe("mapGroqHttpError", () => {
  it.each([
    [401, "CREDENTIAL_INVALID", false],
    [403, "CREDENTIAL_INVALID", false],
    [429, "RATE_LIMITED", true],
    [400, "INVALID_SCHEMA", false],
    [404, "INVALID_SCHEMA", false],
    [422, "INVALID_SCHEMA", false],
    [500, "INTERNAL_ERROR", false],
    [503, "INTERNAL_ERROR", false],
    [418, "INTERNAL_ERROR", false],
  ] as const)("maps HTTP %i to %s (retryable: %s)", (status, code, retryable) => {
    const error = mapGroqHttpError(status, "body text");
    expect(error.code).toBe(code);
    expect(error.retryable).toBe(retryable);
  });

  it("includes a truncated version of the response body in the message for diagnostics", () => {
    const error = mapGroqHttpError(500, "x".repeat(1000));
    expect(error.message.length).toBeLessThan(600);
    expect(error.message).toContain("Groq HTTP 500");
  });
});
