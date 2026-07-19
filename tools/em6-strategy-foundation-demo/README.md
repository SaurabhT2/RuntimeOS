# @ai-gateway/em6-strategy-foundation-demo

**Status:** implemented (EM-6). This is Blueprint §7's EM-6 "demonstrable
outcome" — "a CLI script resolving `task: 'summarization'` to a capability
set and an execution profile, printed side by side — no live traffic
affected yet" — committed as a permanent, CI-run regression test rather
than a throwaway hand-run script, the same choice
`tools/orchestrator-integration-tests` and `tools/adapter-conformance-tests`
already made for their own milestones.

## Why this lives in `tools/`

No single package under `packages/*` is allowed to depend on all three of
`capability-registry`, `execution-profile-registry`, and `runtime-profiles`
at once (Blueprint §4.1's `DEPENDENCY_TABLE`: `capability-registry` →
`model-registry` + `core-contracts`; `execution-profile-registry` →
`config` + `core-contracts`; `runtime-profiles` → `config`). `tools/*` is
this codebase's established, `dependency-cruiser`-exempt home for exactly
this shape of cross-package demonstration — see
`tools/orchestrator-integration-tests/README.md` for the precedent.

## What's here

`test/em6-demo.test.ts` resolves `task: "summarization"` through all three
Wave 6 registries and logs the three results side by side, asserts they're
internally consistent with each other (e.g. a task whose `CapabilitySet`
prefers streaming is backed by an `ExecutionProfile` that also defaults
streaming on), resolves every `core-contracts` `KNOWN_TASK_TYPES` entry
end to end, and demonstrates architecture §37.1's central claim directly:
the same task resolves a different Runtime Profile posture (free-tier
preference, retry aggressiveness) for two different tenants, with zero
application-level change. Nothing in this file touches `orchestrator` or
`policy-engine` — confirming EM-6's "no live traffic affected yet" scope.

## Running

```
pnpm --filter @ai-gateway/em6-strategy-foundation-demo test
```

or `pnpm test` from the repo root (turbo builds the three dependency
packages first via `^build`, then runs this suite against their compiled
`dist` output).

## Coverage

Intentionally disabled (`vitest.config.ts`) — this package exercises three
already-covered packages' public APIs end to end; coverage is each of
those packages' own concern.

## Dependencies

`@ai-gateway/core-contracts`, `@ai-gateway/capability-registry`,
`@ai-gateway/execution-profile-registry`, `@ai-gateway/runtime-profiles`.
