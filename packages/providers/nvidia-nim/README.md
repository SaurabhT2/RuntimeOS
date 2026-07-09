# @ai-gateway/nvidia-nim

**Status:** implemented (EM-3). `ProviderAdapter` for NVIDIA's hosted NIM
inference endpoints (architecture §12.3: "positioned in the registry
primarily as a failover and model-diversity target").

## Public API

Same shape as `@ai-gateway/groq`'s `GroqAdapter`: `NimAdapter` implements
`invoke`/`invokeStream`/`healthCheck`/`estimateCost`, plus the
OpenAI-compatible translation layer (`toNimRequestBody`, `fromNimResponse`,
`fromNimStreamEvent`, `mapFinishReason`), `mapNimHttpError`, and
`parseSseDataLines`.

## Design notes / Engineering Decisions

1. **No token-bucket rate limiter, unlike `@ai-gateway/groq`.**
   Architecture §12.3 calls out Groq's proactive rate limiter explicitly
   as tuned for its free tier; it makes no equivalent statement for NIM.
   `NimAdapter.capabilities.rateLimits` still declares the same figures as
   this repo's Model Registry seed data (`requestsPerMinute: 60`,
   `tokensPerMinute: 60_000`) for informational/scoring purposes — see the
   doc comment on `DEFAULT_CAPABILITIES` in `nim-adapter.ts` for how that
   relates to `@ai-gateway/policy-engine`'s scoring.
2. **Translation layer is duplicated from `@ai-gateway/groq`, not
   shared.** Neither adapter package may depend on the other or on a
   third "shared adapter kit" package (Section 4.1's `DEPENDENCY_TABLE`
   allows only `provider-sdk` + `core-contracts` for each) — see
   `openai-compat.ts`'s doc comment for the precedent this follows
   elsewhere in the codebase.
3. **Default pricing is a documented simplification.** This repo's Model
   Registry seed data prices NIM's `fast-extraction`/`complex-reasoning`
   models differently; `NimAdapter`'s flat `DEFAULT_PRICING` uses the
   lower figure, overridable via `NimAdapterOptions.pricing` for
   deployments needing accurate per-model economics.
4. **`baseUrl` defaults to `https://integrate.api.nvidia.com/v1`** (NIM's
   public hosted-API base), fully overridable — e.g. for a
   self-hosted/on-prem NIM deployment, which architecture §12.3
   explicitly says is out of scope for this adapter's own GPU-orchestration
   concerns ("no GPU orchestration concerns belong in this adapter") but
   not for simply pointing it at a different compatible endpoint.

## Testing strategy

Identical strategy to `@ai-gateway/groq`: fixture-scripted `fetchImpl`
(`test/fake-fetch.ts`), no live network calls, unit tests per translation
layer, integration tests covering every success/failure path, and a
`conformance.test.ts` run of `provider-sdk`'s shared conformance suite.

## Dependencies

- `@ai-gateway/core-contracts`
- `@ai-gateway/provider-sdk`

## Architecture reference

§12.3
