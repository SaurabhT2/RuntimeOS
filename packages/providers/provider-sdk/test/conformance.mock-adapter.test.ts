import { runConformanceSuite } from "../src/conformance.js";
import { MockAdapter } from "../src/mock-adapter.js";
import type { NormalizedInvocation } from "../src/invocation.js";
import type { ScopedCredential } from "../src/credential.js";

/**
 * Validates the conformance harness itself against a known-good adapter
 * (Blueprint §7 EM-1: "the conformance harness is validated against the
 * Mock Adapter before any real adapter exists"). Every real adapter's own
 * test suite calls `runConformanceSuite` the same way — see this file for
 * the reference invocation.
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
  createAdapter: () => new MockAdapter(),
  credential,
  invocation,
  configureBehavior: (adapter, behavior) => (adapter as MockAdapter).setBehavior(behavior),
});
