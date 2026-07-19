import { GatewayError } from "@ai-gateway/core-contracts";
import type {
  NormalizedChunk,
  NormalizedInvocation,
  ProviderAdapter,
  ScopedCredential,
} from "@ai-gateway/provider-sdk";
import type { StreamManager } from "./types.js";

interface StreamState {
  cancelled: boolean;
}

/**
 * Default `StreamManager` (architecture §11, adapted per `types.ts`'s doc
 * comment / ADR-0007). Tracks one in-flight stream per `requestId` so a
 * later `cancel(requestId)` call can reach it.
 *
 * **Cancellation is cooperative, not preemptive** (ADR-0004, already
 * filed against `provider-sdk` during EM-1/EM-2: "no `ProviderAdapter`
 * method accepts an `AbortSignal`... a real fix needs either a
 * `ProviderAdapter` interface change... or a documented accepted
 * limitation for EM-1/EM-2's scope"). `cancel()` sets a flag this
 * generator checks *between* chunks the underlying `ProviderAdapter`
 * produces — it cannot interrupt an adapter mid-network-call, since
 * `ProviderAdapter.invokeStream` has no cancellation input to forward
 * that request to. Once flagged, the very next chunk (or the end of the
 * upstream stream, whichever comes first) is replaced with a synthetic
 * terminal chunk (`finishReason: "cancelled"`) and iteration stops — the
 * upstream HTTP call itself may continue running to completion in the
 * background, its result simply discarded. Closing this gap fully
 * requires the `ProviderAdapter` interface change ADR-0004 already
 * describes; that is out of EM-3's scope (a frozen EM-1 interface).
 *
 * A second, independent path to the same synthetic-termination behavior:
 * standard `for await...of` "IteratorClose" semantics mean that if
 * *this* generator's own consumer stops early (e.g. an SSE transport
 * whose HTTP client disconnected calls `.return()` on the iterable, or
 * simply `break`s out of a `for await` loop consuming it), the JS runtime
 * automatically calls `.return()` on the inner `adapter.invokeStream()`
 * iterator too — reaching each adapter's own `finally` block (e.g.
 * `@ai-gateway/groq`'s `GroqAdapter.invokeStream`, which clears its
 * timeout there) without this class needing to do anything extra. Real
 * network-level abort on *that* path is subject to the identical
 * ADR-0004 limitation.
 */
export class DefaultStreamManager implements StreamManager {
  private readonly active = new Map<string, StreamState>();

  async *openStream(
    adapter: ProviderAdapter,
    invocation: NormalizedInvocation,
    cred: ScopedCredential,
    requestId: string,
  ): AsyncGenerator<NormalizedChunk> {
    if (this.active.has(requestId)) {
      throw new GatewayError(
        "INVALID_SCHEMA",
        `A stream is already open for requestId "${requestId}"; each requestId may have at most one open stream.`,
        false,
        { requestId },
      );
    }

    const state: StreamState = { cancelled: false };
    this.active.set(requestId, state);

    try {
      for await (const chunk of adapter.invokeStream(invocation, cred)) {
        if (state.cancelled) {
          yield { delta: {}, done: true, finishReason: "cancelled" };
          return;
        }
        yield chunk;
        if (chunk.done) {
          return;
        }
      }
    } finally {
      this.active.delete(requestId);
    }
  }

  cancel(requestId: string): void {
    const state = this.active.get(requestId);
    if (state) {
      state.cancelled = true;
    }
  }

  /** Test/observability seam: whether a stream for `requestId` is currently tracked as open. Not part of the `StreamManager` interface itself. */
  isOpen(requestId: string): boolean {
    return this.active.has(requestId);
  }
}
