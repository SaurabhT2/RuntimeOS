---
"@ai-gateway/strategy-layer": minor
---

EM-9: `RuntimeProfileResolutionStage` now runs before
`ExecutionProfileResolutionStage` (previously the reverse), so the latter
can merge the active `RuntimeProfile`'s `caching.aggressiveness` and
`reliability.retryAggressiveness` into the resolved `ExecutionProfile`'s
`caching`/`retryPolicy` fields (architecture §37.4's first and fourth
Runtime Profile read sites), populating `adjustedBy` when a field actually
changed. The default `production` runtime profile (`"standard"` on both
axes) is a no-op by construction, so this reorder does not change any
existing EM-8 request's resolved `ExecutionProfile`. Does not implement
architecture §37.4's `streaming`/`timeoutMs` claim (no corresponding
`RuntimeProfile` field exists) or its Policy Engine lifecycle-filtering /
Circuit Breaker read sites — see ADR-0020.
