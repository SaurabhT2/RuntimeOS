# tools/adapter-conformance-tests

**Status:** implemented (EM-1), as documentation + convention rather than a
separate installable package.

## Where the suite actually lives

The conformance suite's logic — `runConformanceSuite()` — lives in
[`@ai-gateway/provider-sdk`](../../packages/providers/provider-sdk/src/conformance.ts),
not in a standalone `tools/adapter-conformance-tests` package. This was a
deliberate EM-1 implementation decision: the suite validates the
`ProviderAdapter` interface, and the two must never drift apart. Shipping
them from the same package, versioned together, makes that guarantee
structural rather than a matter of remembering to update two places in
lockstep. A separate `tools/adapter-conformance-tests` package would need
its own dependency edge onto `provider-sdk` just to import the interface it
tests — adding a package/edge not present in Section 4.1's
`DEPENDENCY_TABLE` for no benefit.

This directory instead documents the convention every provider adapter
package follows to run the suite against itself.

## Running the suite against a new adapter

In the new adapter package's own test suite:

```ts
// packages/providers/<your-adapter>/test/conformance.test.ts
import { runConformanceSuite } from "@ai-gateway/provider-sdk";
import { YourAdapter } from "../src/your-adapter.js";

runConformanceSuite({
  createAdapter: () => new YourAdapter({ apiKey: "test-key" }),
  credential: { key: "test-key", scope: "workspace" },
  invocation: {
    modelId: "your-provider-model-id",
    messages: [{ role: "user", content: "test" }],
    temperature: 0.2,
    maxOutputTokens: 64,
    stream: false,
    timeoutMs: 5000,
  },
  // Optional: only adapters that expose a way to simulate specific failure
  // modes (e.g. a mock-HTTP-server harness) need to provide this.
  // configureBehavior: (adapter, behavior) => { ... },
});
```

See `packages/providers/provider-sdk/README.md` for exactly what the suite
checks in EM-1, and what's deliberately deferred to EM-4.

## Reference adapters

As of EM-1, the only adapter that exists is the Mock Adapter
(`@ai-gateway/provider-sdk`'s `MockAdapter`) — see
`packages/providers/provider-sdk/test/conformance.mock-adapter.test.ts` for
the reference invocation this README's example above is based on. The Groq
and NVIDIA NIM adapters (architecture §12.3) are EM-4 scope.
