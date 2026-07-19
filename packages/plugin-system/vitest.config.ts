import { defineConfig, mergeConfig } from "vitest/config";
import { sharedTestConfig } from "../../vitest.config.base.js";

export default mergeConfig(
  defineConfig({ test: sharedTestConfig }),
  defineConfig({
    test: {
      include: ["test/**/*.test.ts"],
      coverage: {
        include: ["src/**/*.ts"],
        // Pure barrel file (re-exports only) — package-specific override,
        // matching @ai-gateway/core-contracts' identical precedent.
        exclude: ["src/index.ts"],
      },
    },
  }),
);
