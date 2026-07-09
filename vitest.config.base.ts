import type { UserConfig } from "vitest/config";

/**
 * Shared Vitest `test` defaults for every package in the monorepo.
 *
 * This exists to close a gap identified in the EM-0 review: coverage
 * thresholds were previously only configured in `core-contracts`, so every
 * new package had to remember to add them individually or shipped with no
 * enforced coverage bar at all. Centralizing the defaults here means new
 * packages inherit them automatically the moment they compose this config.
 *
 * This is Vitest's own supported composition mechanism (`mergeConfig`) —
 * not a custom test runner or a redesign of the testing setup. Every
 * package still owns its own `vitest.config.ts` and can override any of
 * these fields (see `core-contracts/vitest.config.ts`, which excludes its
 * pure-barrel `src/index.ts` from coverage — a package-specific decision
 * that stays local to that package rather than living here).
 */
export const sharedTestConfig: UserConfig["test"] = {
  environment: "node",
  coverage: {
    provider: "v8",
    thresholds: {
      lines: 90,
      statements: 90,
      functions: 90,
      branches: 85,
    },
  },
};
