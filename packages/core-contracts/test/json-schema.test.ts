import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { jsonSchemaSchema } from "../src/json-schema.js";

function loadFixture(name: string): unknown {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf-8"));
}

describe("jsonSchemaSchema", () => {
  it("parses the nested requiredSchema from the custom-task fixture", () => {
    const fixture = loadFixture("execute-request.custom-task-with-schema.json") as {
      constraints: { requiredSchema: unknown };
    };
    expect(jsonSchemaSchema.safeParse(fixture.constraints.requiredSchema).success).toBe(true);
  });

  it("parses a schema with array items and enum constraints", () => {
    const schema = {
      type: "object",
      properties: {
        status: { type: "string", enum: ["draft", "published"] },
        tags: { type: "array", items: { type: "string" } },
      },
      additionalProperties: false,
    };
    expect(jsonSchemaSchema.safeParse(schema).success).toBe(true);
  });

  it("parses an empty object as a permissive (accept-anything) schema", () => {
    expect(jsonSchemaSchema.safeParse({}).success).toBe(true);
  });
});
