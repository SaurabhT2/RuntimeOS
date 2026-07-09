import { defineConfig, mergeConfig } from "vitest/config";
import { sharedTestConfig } from "../../../vitest.config.base.js";

export default mergeConfig(
  defineConfig({ test: sharedTestConfig }),
  defineConfig({
    test: {
      include: ["test/**/*.test.ts"],
      coverage: {
        include: ["src/**/*.ts"],
        exclude: ["src/index.ts"],
      },
    },
  }),
);
