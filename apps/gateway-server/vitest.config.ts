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
        // actual process spawn. The composition/routing logic itself lives
        // in `@ai-gateway/gateway-runtime` (shared with `apps/vercel-adapter`)
        // since the EM-5.5 extraction; this app's own `http/server.ts` is
        // covered by the integration suite. See this package's README,
        // Testing strategy.
        exclude: ["src/index.ts"],
      },
    },
  }),
);
