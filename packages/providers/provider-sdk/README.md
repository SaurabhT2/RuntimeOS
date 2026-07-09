# @ai-gateway/provider-sdk

**Status:** implemented (EM-1). The `ProviderAdapter` interface (frozen), the
Mock Adapter, and the shared conformance test suite that every real
provider adapter must pass (architecture §12; Blueprint §6.1, §7, §8.4).

## Public API

- `ProviderAdapter` — the frozen interface (architecture §11): `id`,
  `capabilities`, `invoke`, `invokeStream`, `healthCheck`, `estimateCost`.
- `ProviderCapabilities`, `NormalizedInvocation`, `NormalizedResult`,
  `NormalizedChunk`, `ToolDefinition` — architecture §12.1/§12.2's
  normalized shapes every adapter translates to/from.
- `ScopedCredential`, `ProviderHealthSnapshot`, `CostEstimate` — referenced
  by the interfaces above but not spelled out in the architecture doc;
  defined here (see inline doc comments for the reasoning behind each
  field).
- `MockAdapter` — a fully in-memory `ProviderAdapter`, configurable via
  `setBehavior({ mode, errorCode?, latencyMs?, result?, chunkCount? })` to
  simulate success, a specific `GatewayErrorCode`, a timeout (explicit or
  organic — i.e. simulated latency that itself exceeds `timeoutMs`), or a
  mid-stream failure.
- `runConformanceSuite(options)` — the shared suite (`tools/adapter-conformance-tests`'
  actual logic). Call it from any adapter package's test file; see
  `test/conformance.mock-adapter.test.ts` for the reference invocation and
  `tools/adapter-conformance-tests/README.md` for how a new adapter wires
  this up.
- `createGatewayError`, `withTimeout`, `delay` — small helpers every adapter
  (mock or real) can reuse: `createGatewayError` derives the `retryable`
  flag from architecture §19.1's taxonomy so it can never drift out of sync
  with the code it's paired with; `withTimeout` is the mechanism for
  honoring `NormalizedInvocation.timeoutMs`.

## What the conformance suite checks (EM-1 scope)

A non-empty `id` and well-shaped `capabilities`; a well-shaped
`NormalizedResult` on success; that `invoke`/`invokeStream` never let a raw
(non-`GatewayError`) exception escape, including on a configured error, a
timeout, or a mid-stream failure; that a stream ends with exactly one
`done: true` terminal chunk carrying a `finishReason`; a well-shaped
`ProviderHealthSnapshot`; and a synchronous, non-negative `CostEstimate`.

**Deferred to EM-4** (Blueprint §7 risk, deliberately not built now): deeper
provider-specific edge cases named in architecture §24 — a real mock-HTTP-server
harness simulating malformed JSON bodies, HTTP-level rate-limit response
parsing, and wire-level partial-stream corruption. Building those now, before
a second real adapter (Groq/NIM) exists to validate the harness against
something other than the Mock Adapter itself, risks over-fitting the harness
to assumptions that don't hold once a real HTTP-based adapter shows up.

## The EM-1 vertical-slice demo

`test/integration/debug-endpoint.test.ts` (+ its `debug-server.ts` helper)
implements the EM-1 acceptance criterion "`POST /debug/execute` (a
temporary, non-public route) returns a Mock Adapter response end-to-end."
It deliberately does **not** live in `packages/orchestrator` or
`apps/gateway-server` — see the long comment at the top of
`test/integration/debug-server.ts` for why (short version: `orchestrator`'s
dependency edges are frozen at EM-0 to exclude `provider-sdk` directly, by
design — the real orchestrator always goes through `streaming` — and
`apps/gateway-server` is explicitly EM-5 scope). This is the one genuine
EM-0/EM-1 scope tension surfaced during implementation; flagged here rather
than resolved by amending EM-0 or `orchestrator`.

## Dependencies

- `@ai-gateway/core-contracts`
- `vitest` (a runtime dependency, not just a dev dependency: `runConformanceSuite`
  is `describe`/`it`/`expect` code consumed by _other_ packages' test files)

## Architecture reference

§12

## Testing strategy

Direct `MockAdapter` unit tests (`test/mock-adapter.test.ts`); the shared
suite run against `MockAdapter` both with and without the
`configureBehavior` hook, to prove behavior-dependent scenarios skip
cleanly rather than fail when an adapter can't yet simulate every failure
mode (`test/conformance.*.test.ts`); and the EM-1 vertical-slice HTTP
integration test described above.
