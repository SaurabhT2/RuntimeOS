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
        // intentionally not part of the shared base config.
        exclude: ["src/index.ts"],
      },
    },
  }),
);
