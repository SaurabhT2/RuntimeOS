import { defineConfig, mergeConfig } from "vitest/config";
import { sharedTestConfig } from "../../vitest.config.base.js";

export default mergeConfig(
  defineConfig({ test: sharedTestConfig }),
  defineConfig({
    test: {
      include: ["test/**/*.test.ts"],
      coverage: {
        include: ["src/**/*.ts"],
        // `index.ts` is the process entrypoint (`listen()` + signal
        // handlers on the real process) — exercised by nothing short of an
        // actual process spawn, the same exclusion apps/gateway-server's
        // own vitest config makes for the same reason.
        exclude: ["src/index.ts"],
      },
    },
  }),
);
