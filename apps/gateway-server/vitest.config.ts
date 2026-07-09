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
        // actual process spawn. `bootstrap.ts` and `http/**` (the actual
        // composition/routing logic) are fully covered by unit + the
        // integration suite; see this package's README, Testing strategy.
        exclude: ["src/index.ts"],
      },
    },
  }),
);
