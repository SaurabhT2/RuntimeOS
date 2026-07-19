import { defineConfig, mergeConfig } from "vitest/config";
import { sharedTestConfig } from "../../vitest.config.base.js";

export default mergeConfig(
  defineConfig({ test: sharedTestConfig }),
  defineConfig({
    test: {
      include: ["test/**/*.test.ts"],
      // This package has no `src/` of its own — it exercises the public
      // APIs of ten other already-covered packages end to end. Coverage
      // thresholds are a per-package concern for the packages that own
      // the source; enforcing them here would be meaningless.
      coverage: { enabled: false },
      // Real HTTP-fixture adapters + multi-candidate failover chains push
      // a couple of the chaos scenarios past Vitest's 5s default.
      testTimeout: 15_000,
    },
  }),
);
