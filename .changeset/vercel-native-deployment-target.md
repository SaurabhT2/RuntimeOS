---
"@ai-gateway/vercel-adapter": minor
"@ai-gateway/gateway-runtime": minor
"@ai-gateway/gateway-server": patch
---

Add `apps/vercel-adapter` (EM-5.5): an additive Vercel-native deployment
target for the AI Gateway, approved (revised) in
`docs/Hosting-architecture/EM-5.5-vercel-deployment-architecture-review.md`.
Same platform packages, same REST contract (`POST /v1/execute`,
`POST /v1/execute/stream`, `GET /v1/health`), same request handling as
`apps/gateway-server` — only the hosting lifecycle differs (a single Vercel
Node.js Function instead of a long-running `createServer()`/`.listen()`
process).

The composition root and HTTP layer (`bootstrap()`, `GatewayApp`, the
router, request handlers, parsing, validation, response-shaping) now live
in a new shared package, `@ai-gateway/gateway-runtime`, which both apps
depend on — see [ADR-0012](../docs/adr/0012-shared-gateway-runtime-package.md).
`apps/gateway-server` is behaviorally unmodified (verified against its
pre-extraction implementation) but gains a dependency on the new shared
package and loses local ownership of the files that moved; this is a
`patch` for that app, not a `minor`, since nothing about its public
behavior changes.
