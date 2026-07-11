import { describe, expect, it } from "vitest";
import { GatewayError } from "@ai-gateway/core-contracts";
import { validateExecuteRequest } from "../../src/http/validate-request.js";

describe("validateExecuteRequest", () => {
  it("returns the parsed request for valid input", () => {
    const body = {
      task: "summarization",
      input: { text: "hello" },
      tenant: { organizationId: "org-1" },
    };
    expect(validateExecuteRequest(body)).toMatchObject(body);
  });

  it("throws INVALID_SCHEMA for a missing tenant", () => {
    expect(() =>
      validateExecuteRequest({ task: "summarization", input: { text: "hello" } }),
    ).toThrow(GatewayError);
  });

  it("throws INVALID_SCHEMA for input with neither text nor messages", () => {
    expect(() =>
      validateExecuteRequest({
        task: "summarization",
        input: {},
        tenant: { organizationId: "org-1" },
      }),
    ).toThrow(GatewayError);
  });

  it("throws INVALID_SCHEMA for a completely malformed body", () => {
    expect(() => validateExecuteRequest("not an object")).toThrow(GatewayError);
    expect(() => validateExecuteRequest(null)).toThrow(GatewayError);
    expect(() => validateExecuteRequest(42)).toThrow(GatewayError);
  });

  it("accepts messages-based input without text", () => {
    const body = {
      task: "chat",
      input: { messages: [{ role: "user", content: "hi" }] },
      tenant: { organizationId: "org-1" },
    };
    expect(() => validateExecuteRequest(body)).not.toThrow();
  });
});
