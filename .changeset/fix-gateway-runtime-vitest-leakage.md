---
"@ai-gateway/gateway-runtime": patch
---

Fix a release-blocking regression: `apps/gateway-server`'s production
startup (`node dist/index.js`) transitively loaded `vitest` via
`@ai-gateway/gateway-runtime`'s main entry point, which re-exported its
test-only fakes/harness (which import `vitest`) from the same barrel as
its production exports. `vitest` throws when loaded outside the actual
`vitest` test runner, so this broke `pnpm --filter @ai-gateway/gateway-server start`.

Test-only utilities now live behind a separate `@ai-gateway/gateway-runtime/testing`
entry point, never reachable from the production barrel — the same
pattern already established by `@ai-gateway/provider-sdk/conformance`.
No production behavior changes; `apps/gateway-server` now starts
correctly again.
