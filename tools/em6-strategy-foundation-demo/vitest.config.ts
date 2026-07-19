import { defineConfig, mergeConfig } from "vitest/config";
import { sharedTestConfig } from "../../vitest.config.base.js";

export default mergeConfig(
  defineConfig({ test: sharedTestConfig }),
  defineConfig({
    test: {
      include: ["test/**/*.test.ts"],
      // No `src/` of its own — see tools/orchestrator-integration-tests for
      // the same rationale: coverage is each dependency package's own concern.
      coverage: { enabled: false },
    },
  }),
);
