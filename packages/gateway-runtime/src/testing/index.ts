/**
 * `@ai-gateway/gateway-runtime/testing` — a dedicated, vitest-dependent
 * entry point, deliberately separate from this package's main entry
 * point (`src/index.ts`).
 *
 * This is the same pattern already established in this codebase by
 * `@ai-gateway/provider-sdk/conformance` (see that package's `src/index.ts`
 * doc comment and its own history — `git log`, "fix(runtime): remove
 * Vitest dependency from production startup"): a package that ships both
 * production code and vitest-dependent test doubles must expose them
 * through *different* module graphs, because an ES module's static
 * `export ... from` re-exports cause the referenced module to be loaded
 * and executed the moment anything imports the barrel — regardless of
 * which specific binding the importer actually uses. If `fakeAdapter`/
 * `startTestDispatchServer` (which import `vitest`) were re-exported from
 * this package's main `src/index.ts`, then `apps/gateway-server/src/index.ts`
 * importing `bootstrap` from `"@ai-gateway/gateway-runtime"` would
 * transitively load `vitest` as part of the real Node runtime's own
 * startup — and `vitest`'s own module throws ("Vitest failed to access
 * its internal state") when loaded outside the actual `vitest` test
 * runner process. That is a release-blocking regression of exactly the
 * kind the `provider-sdk` fix above already exists to prevent; this
 * package now follows the same convention.
 *
 * Import from this subpath only in `test/` files. Never import it from
 * `src/` or from either app's own production entrypoint.
 */
export {
  fakeTelemetry,
  fakeAdapter,
  fakeSlowStreamAdapter,
  TEST_MODEL_SEED,
  testRuntimeConfig,
} from "./fixtures.js";
export { startTestDispatchServer, type TestDispatchServer } from "./test-server.js";
