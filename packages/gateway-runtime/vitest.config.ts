import { defineConfig, mergeConfig } from "vitest/config";
import { sharedTestConfig } from "../../vitest.config.base.js";

export default mergeConfig(
  defineConfig({ test: sharedTestConfig }),
  defineConfig({
    test: {
      include: ["test/**/*.test.ts"],
      coverage: {
        include: ["src/**/*.ts"],
        // Pure barrel file (re-exports only) — matches core-contracts'/
        // orchestrator's precedent. `src/testing/*` is test-support code
        // exercised BY the test suite, not independently unit-tested.
        exclude: ["src/index.ts", "src/testing/**"],
      },
    },
  }),
);
