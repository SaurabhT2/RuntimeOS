# `@ai-gateway/plugin-system`

The Gateway Plugin framework (architecture §11): the `GatewayPlugin` contract, plus
registration, lifecycle, discovery, and loading around it.

**STATUS:** implemented (Engineering Milestone EM-7, Blueprint §7, §8.18). **Not yet
integrated into the Orchestrator** — Blueprint §7 EM-7 is explicit: "Do NOT integrate
plugins into the Orchestrator yet. That occurs during EM-8."

## What's here

| File                 | Provides                                                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `plugin-contract.ts` | `GatewayPlugin` (architecture §11, verbatim, including the real `ProviderAdapter` type from `provider-sdk`).                                                                               |
| `plugin-host.ts`     | `PluginHost` — registration (with validation), lifecycle tracking, and hook execution (`runOnRequest`/`runOnResponse`/`notifyProviderRegistered`), each with per-plugin failure isolation. |
| `discovery.ts`       | `discoverPlugins` — resolves a list of caller-supplied `PluginSource`s into plugin instances, isolating a source that throws.                                                              |
| `loader.ts`          | `loadPlugins` — discovers, then validates/registers each discovered plugin into a `PluginHost`, isolating a single bad plugin from the rest.                                               |
| `example-plugin.ts`  | `createPassthroughLoggingPlugin` — the trivial example plugin Blueprint §7 EM-7 names as a deliverable.                                                                                    |

## Engineering decisions worth knowing

- **`onProviderRegistered` takes the real `ProviderAdapter` type**, imported from
  `@ai-gateway/provider-sdk` — an additional dependency edge beyond Blueprint §4.1's
  literal table (`core-contracts` only), added because `provider-sdk` is a Wave-1,
  `core-contracts`-only package with no layering or circularity risk, and because
  architecture §11's frozen interface requires it. An earlier draft substituted a narrowed
  local type instead; the Independent Engineering Review of EM-7 (Issue #1) found this was
  an avoidable interface-fidelity defect, not a genuine spec/Blueprint tension, and it was
  corrected — see ADR-0015 for the full record.
- **The default `onPluginError` is a genuine silent swallow** (Independent Engineering
  Review of EM-7, Issue #5) — with no callback supplied, a plugin hook failure produces no
  throw and no log anywhere (this package has no `telemetry` edge). A future `orchestrator`
  integration (EM-8) should always supply `onPluginError` wired to `telemetry`. See
  `plugin-host.ts`'s `PluginExecutionError` doc comment.
- **No filesystem/directory scanning or dynamic `import()` of arbitrary paths.** A
  `PluginSource` is the caller's own already-resolved reference to a plugin — loading
  arbitrary code from disk is a meaningfully larger, security-sensitive surface than this
  milestone calls for (a filesystem plugin marketplace is explicitly out of scope, per
  architecture §27's roadmap). See `discovery.ts`'s doc comment.
- **Per-plugin isolation is the default everywhere**: a throwing `onRequest`/`onResponse`/
  `onProviderRegistered` hook, a throwing discovery source, and an invalid or duplicate
  plugin at load time are all caught and reported (via `onPluginError` for hook failures,
  via return-value failure lists for discovery/loading) rather than aborting the whole
  operation.
- **Lifecycle is this package's own bookkeeping**, not part of the frozen `GatewayPlugin`
  contract — architecture §11 has no lifecycle field on the interface itself.

## Testing

Covers every Blueprint §7 EM-7 requirement for this package: registration, loading,
lifecycle, execution, isolation, and invalid plugin rejection — see
`test/plugin-host-registration.test.ts`, `test/plugin-host-lifecycle.test.ts`,
`test/plugin-host-execution.test.ts` (execution + isolation), `test/discovery.test.ts`,
`test/loader.test.ts`, and `test/example-plugin.test.ts`.

## Relationship to `orchestrator`

Not wired in. `PluginHost.runOnRequest`/`runOnResponse` exist so this package's own
execution/isolation behavior is independently testable against a real pipeline shape — a
future `orchestrator` integration (EM-8) is expected to either reuse this class directly or
call an equivalent seam at the appropriate point in the request lifecycle (architecture §17).
