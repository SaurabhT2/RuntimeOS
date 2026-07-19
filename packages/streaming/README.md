# @ai-gateway/streaming

**Status:** implemented (EM-3). `StreamManager` + SSE transport
(architecture §11, §12.1 streaming variant).

## Public API

- `StreamManager` / `DefaultStreamManager` — `openStream(adapter,
invocation, cred, requestId)` calls `adapter.invokeStream()` and yields
  its chunks through unchanged, tracking one in-flight stream per
  `requestId` so `cancel(requestId)` can reach it. See `types.ts`'s doc
  comment and **ADR-0007** for why `openStream`'s parameter list differs
  from architecture §11's literal `(plan: ExecutionPlan, cred)`.
- `toStreamChunk` / `encodeSseChunk` / `decodeSseChunk` / `toSseFrames` /
  `toSseByteStream` — the SSE transport layer: frames a `NormalizedChunk`
  (provider-facing) as a `StreamChunk` (wire-facing, `core-contracts`),
  then as an SSE `data:` frame, then optionally as raw bytes ready to pipe
  into an HTTP response.

## Design notes / Engineering Decisions

1. **`openStream`'s signature is adapted from architecture §11's literal
   text — see ADR-0007** (`docs/adr/0007-stream-manager-signature-gap.md`).
   In short: `ExecutionPlan` is `policy-engine`'s type and this package
   has no dependency edge onto it (Section 4.1's `DEPENDENCY_TABLE`); even
   with that edge, a plan alone doesn't carry a resolved `ProviderAdapter`
   instance or a built `NormalizedInvocation`; and `cancel(requestId)`
   needs _some_ `requestId` established at `openStream` time to mean
   anything. The orchestrator (EM-4) is expected to be the seam that
   resolves an `ExecutionPlan` into `(adapter, invocation)` before calling
   this method.
2. **Cancellation is cooperative, not preemptive** (`stream-manager.ts`'s
   doc comment, and pre-existing ADR-0004: `provider-sdk`'s
   `ProviderAdapter` has no cancellation input to forward a cancel request
   to). `cancel()` flags the stream; the next chunk boundary — not
   mid-network-call — is where a synthetic `finishReason: "cancelled"`
   chunk is substituted and iteration stops. The underlying provider HTTP
   call may continue running in the background regardless; only its
   result is discarded. Fully closing this gap needs the `ProviderAdapter`
   interface change ADR-0004 already describes, which is out of EM-3's
   scope (a frozen EM-1 interface).
3. **No WebSocket transport.** This package's own EM-0 scaffold note
   mentioned `websocket.ts`, but Blueprint §7's EM-3 feature list is
   explicit: "SSE streaming transport," with no WebSocket mention.
   Deferred — see Deferred Work below.
4. **`decodeSseChunk` exists mainly as a test/tooling seam**, round-
   tripping the exact format `encodeSseChunk` emits. A real SSE _client_
   (e.g. a browser's native `EventSource`, or `examples/minimal-node-
client`, architecture §9) is out of this package's scope — `streaming`
   is the server-side transport, not a client library.

## Testing strategy

- `sse.test.ts`: encode/decode round-tripping, `finishReason` presence
  handling, and — directly satisfying Blueprint §7's "streaming
  chunk-ordering tests" requirement — an end-to-end ordering assertion
  that a multi-chunk `NormalizedChunk` sequence survives `toSseFrames`
  and decodes back in the exact original order.
- `stream-manager.test.ts`: ordering, terminal-chunk short-circuiting,
  `isOpen` lifecycle tracking, duplicate-`requestId` rejection,
  requestId-reuse-after-completion, cleanup-on-adapter-error, and
  cooperative cancellation (including that cancelling one `requestId`
  never affects a different, concurrently open one) — all against a
  hand-built fake `ProviderAdapter`, no real network involved.

## Deferred Work

- WebSocket transport (this package's own EM-0 scaffold note; not in
  Blueprint §7's EM-3 feature list).
- Fully preemptive cancellation (ADR-0004): requires a `ProviderAdapter`
  interface change (e.g. accepting an `AbortSignal`), which is a frozen
  EM-1 interface change outside EM-3's scope.

## Dependencies

- `@ai-gateway/core-contracts`
- `@ai-gateway/provider-sdk`

## Architecture reference

§12.1 (streaming variant), §11
