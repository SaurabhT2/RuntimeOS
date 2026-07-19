import { describe, expect, it } from "vitest";
import { KNOWN_TASK_TYPES } from "@ai-gateway/core-contracts";
import { SEED_EXECUTION_PROFILES, TASK_TO_EXECUTION_PROFILE_ID } from "../src/seed-data.js";
import { KNOWN_EXECUTION_PROFILE_IDS } from "../src/execution-profile.js";

describe("TASK_TO_EXECUTION_PROFILE_ID", () => {
  it("has an entry for every core-contracts KNOWN_TASK_TYPES entry", () => {
    for (const task of KNOWN_TASK_TYPES) {
      expect(
        TASK_TO_EXECUTION_PROFILE_ID[task],
        `missing profile mapping for "${task}"`,
      ).toBeDefined();
    }
  });

  it("only maps to registered seed profile ids", () => {
    const seedIds = new Set(SEED_EXECUTION_PROFILES.map((p) => p.id));
    for (const [task, profileId] of Object.entries(TASK_TO_EXECUTION_PROFILE_ID)) {
      expect(seedIds.has(profileId), `"${task}" maps to unregistered profile "${profileId}"`).toBe(
        true,
      );
    }
  });
});

describe("SEED_EXECUTION_PROFILES", () => {
  it("every seed profile id is a KNOWN_EXECUTION_PROFILE_IDS entry", () => {
    const known: readonly string[] = KNOWN_EXECUTION_PROFILE_IDS;
    for (const profile of SEED_EXECUTION_PROFILES) {
      expect(known.includes(profile.id)).toBe(true);
    }
  });

  it("has no duplicate ids", () => {
    const ids = SEED_EXECUTION_PROFILES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
