import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { executeRequestSchema } from "../src/request.js";
import { executeResponseSchema } from "../src/response.js";
import { streamChunkSchema } from "../src/streaming.js";
import { gatewayErrorPayloadSchema } from "../src/errors.js";

/**
 * Engineering Blueprint §7, EM-0 acceptance criteria:
 * "A hand-written JSON fixture validates against every exported schema."
 *
 * This test is the literal, single-place check for that criterion — every
 * schema `core-contracts` exports for wire-level validation is listed here
 * against a fixture that was authored by hand (not generated from the
 * schema), so a schema/fixture drift catches a real regression rather than
 * a tautology.
 */
function loadFixture(name: string): unknown {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf-8"));
}

describe("EM-0 acceptance: every exported wire schema has a validating hand-written fixture", () => {
  const cases: Array<[string, unknown, string]> = [
    ["ExecuteRequest", executeRequestSchema, "execute-request.valid.json"],
    ["ExecuteResponse", executeResponseSchema, "execute-response.valid.json"],
    ["StreamChunk", streamChunkSchema, "stream-chunk.valid.json"],
    ["GatewayError (wire payload)", gatewayErrorPayloadSchema, "gateway-error.valid.json"],
  ];

  it.each(cases)("%s fixture parses successfully", (_label, schema, fixtureName) => {
    const fixture = loadFixture(fixtureName);
    const result = (
      schema as { safeParse: (v: unknown) => { success: boolean; error?: unknown } }
    ).safeParse(fixture);
    if (!result.success) {
      throw new Error(`${fixtureName} failed schema validation: ${JSON.stringify(result.error)}`);
    }
    expect(result.success).toBe(true);
  });
});
