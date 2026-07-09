# @ai-gateway/orchestrator-integration-tests

**Status:** implemented (EM-4). End-to-end integration + chaos tests for
`ExecutionOrchestrator`, wiring the real `orchestrator` package against
real `policy-engine`, `credential-resolver`, `reliability`, and `streaming`,
and against both `provider-sdk`'s real `MockAdapter` and the real
`GroqAdapter`/`NimAdapter` (recorded HTTP fixtures — no live network calls).

## Why this package exists, and why it lives in `tools/`

`orchestrator`'s frozen dependency edge (architecture §4.1's
`DEPENDENCY_TABLE`) deliberately excludes `provider-sdk` and every concrete
provider package (ADR-0008) — so no test file inside
`packages/orchestrator/test/` can ever import `MockAdapter`, `GroqAdapter`,
or `NimAdapter`; `dependency-cruiser`'s per-package boundary rule applies to
test files the same as source files, and `orchestrator`'s own
`package.json` doesn't even declare those packages as dependencies for
pnpm to resolve.

The Engineering Blueprint's EM-4 section nonetheless requires "end-to-end
integration tests against both the Mock Adapter and recorded-fixture real
adapters" and "a chaos test injecting Groq failures to verify automatic
failover" — tests that, by definition, need to import real adapter
packages alongside `orchestrator` in the same test file.

`tools/*` is this codebase's existing, established answer to exactly this
shape of problem: `tools/adapter-conformance-tests` already exists as a
cross-package test suite for the same reason (every provider adapter must
be tested against a shared conformance harness that itself needs no
package-specific dependency edge). Both `pnpm-workspace.yaml` (`tools/*` is
a workspace pattern) and `package.json`'s `graph:check` script (`depcruise
... packages apps` — `tools` is not cruised) confirm `tools/*` is
deliberately exempt from the strict per-package `DEPENDENCY_TABLE` the rest
of `packages/*` is held to. This package is the second occupant of that
exemption.

## What's here

- `test/fixtures.ts` — a **real** `DefaultCredentialResolver` (encrypted
  in-memory store, same wiring `credential-resolver`'s own
  `resolver.test.ts` uses) and a **real** `DefaultPolicyEngine`, seeded
  with a small, deterministic two-model (`groq` + `nvidia-nim`, same
  `modelClass`) registry rather than `model-registry`'s full `SEED_MODELS`
  — see that constant's doc comment for why `SEED_MODELS` itself is not
  usable here (`groq`'s free-tier pricing wins every top-3 scored slot for
  almost any task, so `nvidia-nim` never naturally appears as a fallback
  candidate). Also a minimal `fetch` fixture builder (`jsonFetch`,
  `throwingFetch`, `successBody`) for driving the real `GroqAdapter`/
  `NimAdapter` without a live network call — smaller than either
  package's own `test/fake-fetch.ts` (not importable here — a package's
  `test/` files are not part of its public `exports`), since this package
  only needs to script a success or a hard network failure, not the full
  fixture surface those packages' own adapter test suites use.
- `test/full-lifecycle.test.ts` — the complete chain named in the
  Blueprint's EM-4 section (Policy Engine → Execution Plan → Credential
  Resolution → Provider Resolution → Provider Execution → Retry →
  Fallback → Streaming → Completion), against `MockAdapter`. Covers
  success (non-streaming and streaming), retry-then-success,
  retry-exhausted-then-fallback, both-providers-down, credential failure,
  streaming interruption/cancellation, and a malformed provider response.
- `test/chaos-failover.test.ts` — the real `GroqAdapter` + real
  `NimAdapter`, driven by scripted `fetchImpl`s: a healthy baseline, a
  network-down chaos scenario (automatic failover), an HTTP 429 chaos
  scenario (retry-exhaustion then failover), both-down (typed terminal
  error, never a raw crash), and the same for a streaming request.

## Running

```
pnpm --filter @ai-gateway/orchestrator-integration-tests test
```

or, from the repo root, `pnpm test` (turbo picks this package up
automatically alongside every other workspace package's `test` script).
This package has no `build` script of its own (nothing here is published);
turbo's `test` task depends on `^build`, so its ten real dependencies are
built first, and this package's tests import their compiled `dist` output
via normal `@ai-gateway/*` package resolution — the same way any other
consumer of those packages would.

## Coverage

This package intentionally has no coverage thresholds of its own
(`vitest.config.ts`: `coverage: { enabled: false }`) — it exercises the
public APIs of ten already-covered packages end to end; coverage is each
of those packages' own concern, not this suite's.

## Dependencies

`@ai-gateway/orchestrator`, `@ai-gateway/policy-engine`,
`@ai-gateway/model-registry`, `@ai-gateway/credential-resolver`,
`@ai-gateway/reliability`, `@ai-gateway/streaming`,
`@ai-gateway/telemetry`, `@ai-gateway/core-contracts`,
`@ai-gateway/config`, `@ai-gateway/provider-sdk`, `@ai-gateway/groq`,
`@ai-gateway/nvidia-nim`.
