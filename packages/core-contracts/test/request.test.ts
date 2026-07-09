import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { chatMessageSchema, executeRequestSchema } from "../src/request.js";

function loadFixture(name: string): unknown {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf-8"));
}

describe("executeRequestSchema", () => {
  it("parses the hand-written valid ExecuteRequest fixture", () => {
    const fixture = loadFixture("execute-request.valid.json");
    const result = executeRequestSchema.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it("parses a custom (non-KNOWN_TASK_TYPES) task with a requiredSchema", () => {
    const fixture = loadFixture("execute-request.custom-task-with-schema.json");
    const result = executeRequestSchema.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it("accepts a minimal request with only required fields", () => {
    const minimal = {
      task: "classification",
      input: {},
      tenant: { organizationId: "org_1" },
    };
    expect(executeRequestSchema.safeParse(minimal).success).toBe(true);
  });

  it("rejects a request missing tenant.organizationId", () => {
    const invalid = {
      task: "classification",
      input: { text: "hello" },
      tenant: {},
    };
    expect(executeRequestSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a request with an empty task string", () => {
    const invalid = {
      task: "",
      input: { text: "hello" },
      tenant: { organizationId: "org_1" },
    };
    expect(executeRequestSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a request where task is not a string (guards against caller passing a model object)", () => {
    const invalid = {
      task: { model: "gpt-4" },
      input: { text: "hello" },
      tenant: { organizationId: "org_1" },
    };
    expect(executeRequestSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects negative maxCostUsd", () => {
    const invalid = {
      task: "classification",
      input: { text: "hello" },
      constraints: { maxCostUsd: -1 },
      tenant: { organizationId: "org_1" },
    };
    expect(executeRequestSchema.safeParse(invalid).success).toBe(false);
  });
});

describe("chatMessageSchema", () => {
  it("parses a valid chat message", () => {
    expect(chatMessageSchema.safeParse({ role: "user", content: "hi" }).success).toBe(true);
  });

  it("rejects an invalid role", () => {
    expect(chatMessageSchema.safeParse({ role: "narrator", content: "hi" }).success).toBe(false);
  });
});
