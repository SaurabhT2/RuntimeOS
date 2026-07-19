import { runConformanceSuite } from "../src/conformance.js";
import { MockAdapter } from "../src/mock-adapter.js";
import type { NormalizedInvocation } from "../src/invocation.js";
import type { ScopedCredential } from "../src/credential.js";

/**
 * Runs the suite against an adapter with no `configureBehavior` hook (as a
 * real adapter without an injected mock-HTTP-server harness would look) and
 * against one with `supportsStreaming: false`, to prove those scenarios are
 * skipped rather than failing — the suite must remain usable against an
 * adapter that can't yet simulate every failure mode (see `conformance.ts`).
 */
const credential: ScopedCredential = { key: "test-key", scope: "workspace" };

const invocation: NormalizedInvocation = {
  modelId: "mock-fast-extraction",
  messages: [{ role: "user", content: "Summarize this." }],
  temperature: 0.2,
  maxOutputTokens: 64,
  stream: false,
  timeoutMs: 2000,
};

runConformanceSuite({
  createAdapter: () =>
    new MockAdapter({ id: "mock-no-behavior-hook", capabilities: { supportsStreaming: false } }),
  credential,
  invocation,
});
