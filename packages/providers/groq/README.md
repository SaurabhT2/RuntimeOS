# @ai-gateway/groq

**Status:** implemented (EM-3). `ProviderAdapter` for Groq's OpenAI-compatible
`/openai/v1/chat/completions` endpoint (architecture §12.3).

## Public API

- `GroqAdapter` — implements `@ai-gateway/provider-sdk`'s `ProviderAdapter`
  (`invoke`, `invokeStream`, `healthCheck`, `estimateCost`). Constructor
  options (`GroqAdapterOptions`): `id`, `baseUrl` (default
  `https://api.groq.com/openai/v1`), `fetchImpl` (test seam), `capabilities`
  (partial override), `rateLimiter`, `pricing`, `streamIncludeUsage`.
- `TokenBucketRateLimiter` — architecture §12.3's "adapter-level
  token-bucket limiter that respects Groq's per-model RPM/TPM headers,
  proactively throttling before Groq returns a 429." Two independent
  buckets (requests, tokens); `acquire(estimatedTokens, timeoutMs)` waits
  for headroom if the wait fits inside `timeoutMs`, otherwise fails fast
  with a retryable `RATE_LIMITED` `GatewayError` rather than waiting out
  the deadline and failing with `TIMEOUT` anyway.
- `toGroqRequestBody` / `fromGroqResponse` / `fromGroqStreamEvent` /
  `mapFinishReason` — the OpenAI-compatible translation layer, exported
  individually and unit-tested in isolation from any HTTP concerns.
- `mapGroqHttpError` — HTTP status → `GatewayError` code mapping.
- `parseSseDataLines` — incremental SSE frame parser for the streaming
  response body, buffering correctly across chunk boundaries.

## Design notes / Engineering Decisions

1. **No adapter-side `modelId` translation.** `NormalizedInvocation.modelId`
   is documented (`provider-sdk`) as already provider-specific — this
   adapter passes it straight through as the `model` field. Architecture
   §12.3's "multiple `modelClass` mappings" bullet describes Model
   Registry _configuration_ (`@ai-gateway/model-registry`'s
   `ModelDescriptor.modelClass` → `modelId`, already EM-2), not adapter
   code — the registry's own seed-data comment is explicit that its
   `groq-*-v1` values are placeholders, "real model identifiers are an
   operator-configured value, not a `model-registry` code change,"
   expected to be supplied for real once this package lands.
2. **Timeout is enforced via `AbortController`, not `provider-sdk`'s
   `withTimeout`.** `withTimeout` races a promise against a timer but
   never cancels the underlying work — for a real HTTP call, that would
   leave a dangling in-flight request. This adapter ties `req.timeoutMs`
   directly to an `AbortController`, so an exceeded deadline actually
   cancels the HTTP request/stream, not just the adapter's wait for it.
3. **HTTP status → `GatewayErrorCode` mapping is a documented,
   best-fit heuristic** (`http-errors.ts`), not a literal spec table —
   architecture §19.1 defines the gateway-facing taxonomy, not a
   provider-specific HTTP-status crosswalk. `400`/`404`/`422` all map to
   `INVALID_SCHEMA` (closest fit for "the request shape this adapter sent
   was rejected"); every unrecognized status defaults to `INTERNAL_ERROR`.
4. **`estimateCost`/token estimates are heuristics, not billing-accurate**
   — matching `provider-sdk`'s own `MockAdapter` precedent (`chars / 4`).
   Defaults to Groq's free tier (`$0`/1K tokens, matching this repo's
   Model Registry seed data); a paid-tier deployment overrides via
   `pricing`.
5. **`healthCheck` calls `GET /models`**, a lightweight, non-completion
   endpoint — avoids consuming a real completion's worth of rate-limit
   budget just to check liveness.

## Testing strategy

- Fixture-scripted `fetchImpl` (`test/fake-fetch.ts`) — this package's
  tests never make a live network call (Blueprint's testing requirements:
  "Provider conformance validation... Failure injection"), matching
  `provider-sdk`'s own conformance suite's expectation of "recorded HTTP
  fixtures, not live calls, in CI."
- Unit tests per translation layer (`openai-compat.test.ts`,
  `http-errors.test.ts`, `sse-parser.test.ts`, `rate-limiter.test.ts`),
  isolated from HTTP entirely.
- Integration tests (`groq-adapter.test.ts`): success paths, credential
  validation, HTTP-error translation, timeout/abort translation, network-
  exception translation, streaming (multi-chunk + terminal chunk,
  malformed-frame, truncated-stream), health check, cost estimation,
  proactive rate-limiting (fails fast without a network call when the
  injected rate limiter has no headroom).
- `conformance.test.ts` — runs `provider-sdk`'s shared
  `runConformanceSuite` against a real `GroqAdapter` (the second adapter,
  after the Mock Adapter, to validate the harness).

## Dependencies

- `@ai-gateway/core-contracts`
- `@ai-gateway/provider-sdk`

## Architecture reference

§12.3
