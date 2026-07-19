import { describe, expect, it } from "vitest";
import { KNOWN_TASK_TYPES } from "@ai-gateway/core-contracts";
import { SEED_CAPABILITIES } from "../src/seed-data.js";

describe("SEED_CAPABILITIES", () => {
  it("has a mapping for every core-contracts KNOWN_TASK_TYPES entry", () => {
    for (const task of KNOWN_TASK_TYPES) {
      expect(SEED_CAPABILITIES[task], `missing seed mapping for "${task}"`).toBeDefined();
    }
  });

  it("has no stray entries outside KNOWN_TASK_TYPES", () => {
    const known: readonly string[] = KNOWN_TASK_TYPES;
    for (const task of Object.keys(SEED_CAPABILITIES)) {
      expect(known.includes(task), `unexpected seed mapping for "${task}"`).toBe(true);
    }
  });
});
