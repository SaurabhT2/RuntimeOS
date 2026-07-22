# Runtime Configuration Matrix

Every capability below is fully implemented and tested at the **platform
runtime level** (`@ai-gateway/gateway-runtime`'s `bootstrap()`, which
`GatewayRuntimeConfig` — see that package's source — accepts). What
differs between the two deployment applications is only **which of
those `GatewayRuntimeConfig` fields each app's own environment-variable
loader actually populates**. A capability marked ⚠ below is not
unsupported by RuntimeOS — it means the deployed application doesn't yet
give an operator a way to reach it without writing custom composition-
root code. That distinction is the entire point of this document; see
"How to read '⚠ not exposed'," below, before drawing any conclusion from
this table.

| Capability                                                    | RuntimeOS runtime supports                                                   | `apps/gateway-server` exposes                                                                                                                       | `apps/vercel-adapter` exposes                                                                                                      |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Strategy Layer (`enableStrategyLayer`)                        | ✅ Yes                                                                       | ✅ `ENABLE_STRATEGY_LAYER` env var (takes precedence), or `enableStrategyLayer` in a `GATEWAY_CONFIG_PATH` JSON file                                | ✅ Only via `enableStrategyLayer` in a `GATEWAY_CONFIG_PATH` JSON file — **no dedicated environment variable exists for this app** |
| Runtime Profiles (`runtimeProfileId`)                         | ✅ Yes                                                                       | ✅ Only via `runtimeProfileId` in a `GATEWAY_CONFIG_PATH` JSON file — no dedicated env var in either app                                            | ✅ Same — only via `GATEWAY_CONFIG_PATH` JSON file                                                                                 |
| Budget Governance (`budgetPolicies`, `budgetEnforcementMode`) | ✅ Yes                                                                       | ⚠ Not exposed — no environment variable, and not a field in `@ai-gateway/config`'s `GatewayConfig` schema, so no `GATEWAY_CONFIG_PATH` route either | ⚠ Not exposed — identical gap                                                                                                      |
| Pipeline Orchestrator (`POST /v1/execute/pipeline`)           | ✅ Yes                                                                       | ✅ Endpoint always registered, no flag needed                                                                                                       | ✅ Endpoint always registered, no flag needed                                                                                      |
| Pipeline step cap (`maxPipelineSteps`)                        | ✅ Yes (defaults to the `pipeline-orchestrator` package's own default of 20) | ⚠ Not exposed — always uses the package default                                                                                                     | ⚠ Not exposed — always uses the package default                                                                                    |
| Rate limiting (`rateLimit.requestsPerWindow`/`windowMs`)      | ✅ Yes                                                                       | ✅ `RATE_LIMIT_REQUESTS_PER_WINDOW`, `RATE_LIMIT_WINDOW_MS`                                                                                         | ✅ Same two env vars, identical names/semantics                                                                                    |
| Response cache (`cache.ttlMs`/`includeTenantInKey`)           | ✅ Yes                                                                       | ✅ `CACHE_TTL_MS`, `CACHE_INCLUDE_TENANT`                                                                                                           | ✅ Same two env vars, identical names/semantics                                                                                    |
| BYOK / platform-managed credentials                           | ✅ Yes                                                                       | ✅ `GATEWAY_API_KEYS_JSON`, `CREDENTIAL_PRIORITY`, `GROQ_PLATFORM_API_KEY_ENV_VAR`, `NVIDIA_NIM_PLATFORM_API_KEY_ENV_VAR`                           | ✅ Same four env vars, identical names/semantics                                                                                   |

_Every claim in this table was checked directly against
`packages/gateway-runtime/src/bootstrap.ts`'s `GatewayRuntimeConfig`
interface and doc comments, `apps/gateway-server/src/server-config.ts`,
and `apps/vercel-adapter/src/vercel-config.ts` — not inferred from either
app's README. The Strategy Layer row in particular is easy to get wrong:
a naive check of `apps/vercel-adapter/src/vercel-config.ts` alone finds
no `ENABLE_STRATEGY_LAYER`-equivalent variable and could lead to
reporting it as entirely unexposed on Vercel, which is incorrect — the
config-file fallback (`bootstrap()`'s
`runtimeConfig.enableStrategyLayer ?? parsedGatewayConfig.data.enableStrategyLayer ?? false`)
is reachable by both apps identically, since both forward
`gatewayConfigPath` unconditionally. Only the environment-variable
shortcut differs between them._

## How to read "⚠ not exposed"

RuntimeOS **fully supports** Budget Governance, the pipeline step cap,
and (for `vercel-adapter`) a same-effect environment-variable shortcut
for the Strategy Layer — the code is implemented, tested, and documented
at the package and `gateway-runtime` level. What "⚠ not exposed" means
in every row above is narrower and more specific: **the published
application binary's own environment-variable (or, where applicable,
`GATEWAY_CONFIG_PATH` JSON) loader does not populate that
`GatewayRuntimeConfig` field from anything an operator can set without
writing code.** This is a deployment/composition-root integration gap,
not a RuntimeOS implementation defect — see
[`docs/release/KNOWN_LIMITATIONS.md` §9.3](KNOWN_LIMITATIONS.md#93-neither-deployment-application-has-a-configuration-surface-for-budget-governance)
for the fullest treatment of this distinction for Budget Governance
specifically, and the backlog item referenced below for the tracked fix.

**What an operator can do about it today:** write a thin, custom
composition-root entrypoint (mirroring `apps/gateway-server/src/index.ts`
or `apps/vercel-adapter/src/runtime.ts`) that calls
`@ai-gateway/gateway-runtime`'s `bootstrap()` directly, supplying
`budgetPolicies`/`budgetEnforcementMode`/`maxPipelineSteps` in code
rather than through either app's standard environment-variable surface.
See [`DEPLOYMENT.md`'s "Budget Governance"
section](DEPLOYMENT.md#budget-governance-em-10-v12) for a worked
example of exactly this.

**What's tracked for the future:** exposing the full
`GatewayRuntimeConfig` surface through both deployment applications'
standard configuration mechanisms is tracked as an engineering backlog
item, not left as an implicit gap — see
[`docs/backlog/expose-complete-gatewayruntimeconfig-surface.md`](../backlog/expose-complete-gatewayruntimeconfig-surface.md).

## Configuration examples

These are documentation examples only — see
[`examples/`](../../examples) for runnable client code (which calls a
gateway over HTTP and has no visibility into or control over any of the
settings below; they are all operator/deployment-side).

### Strategy Layer

```bash
ENABLE_STRATEGY_LAYER=true
```

Set on `apps/gateway-server` (only — see the matrix above for why this
specific variable has no `apps/vercel-adapter` equivalent). Enables
capability-aware, execution-profile-aware, cost-aware, and
prompt-optimization-aware routing ahead of Policy Engine for every
request. Off (`false`) is the default and was the only behavior available
before EM-8. Read
[`DEPLOYMENT.md`'s "Strategy Layer" section](DEPLOYMENT.md#strategy-layer-em-8-v11v12)
before enabling this in production — the Engineering Blueprint's own
EM-8 exit criteria call for a staging validation pass this repository
cannot perform for you.

On `apps/vercel-adapter`, the equivalent is a `GATEWAY_CONFIG_PATH` JSON
file containing:

```jsonc
{ "enableStrategyLayer": true }
```

### Budget Governance

Not reachable through either app's standard configuration surface (see
above) — this example illustrates the shape a caller would pass to
`bootstrap()` directly, in custom composition-root code:

```ts
{
  budgetPolicies: [
    {
      tenant: { organizationId: "acme" },
      dailyBudgetUsd: 50,
      thresholds: [
        { atPercentOfBudget: 100, action: "block" },
        { atPercentOfBudget: 80, action: "alert" },
      ],
    },
  ],
  budgetEnforcementMode: "shadow", // recommended starting point — see below
}
```

**`budgetEnforcementMode: "shadow"` is the recommended initial
deployment for any new Budget Governance configuration** — it is also
the default, so simply omitting `budgetEnforcementMode` gets you the
same recommended starting point. Shadow mode computes real enforcement
decisions and records them to telemetry without ever blocking or
altering a request. Only switch to `budgetEnforcementMode: "enforcing"`
after observing that telemetry against real traffic for a full
observation period, and only after reading
[`KNOWN_LIMITATIONS.md` §9.2](KNOWN_LIMITATIONS.md#92-switch_provider-threshold-actions-have-no-effect-on-real-routing--read-this-before-enabling-enforcement-mode) —
`switch_provider` threshold actions do not affect real routing today;
`block`, `alert`, and `downgrade_model` do.

No configuration key above is invented — every field name
(`budgetPolicies`, `dailyBudgetUsd`, `thresholds`, `atPercentOfBudget`, `action`,
`budgetEnforcementMode`) is taken directly from
`packages/budget-governance/src` and `packages/gateway-runtime/src/bootstrap.ts`'s
existing, shipped types.

## See also

- [`KNOWN_LIMITATIONS.md`](KNOWN_LIMITATIONS.md) §9.3, for the fullest
  treatment of the Budget Governance config-surface gap specifically.
- [`DEPLOYMENT.md`](DEPLOYMENT.md) and
  [`DEPLOYMENT-VERCEL.md`](DEPLOYMENT-VERCEL.md), for the full
  environment-variable reference for each app.
- [`MIGRATION.md`](MIGRATION.md), for adopting any of these capabilities
  on top of an existing integration.
- [`docs/backlog/expose-complete-gatewayruntimeconfig-surface.md`](../backlog/expose-complete-gatewayruntimeconfig-surface.md),
  the tracked engineering work to close the ⚠ gaps above.
- [`docs/adr/0027-api-contract-publication.md`](../adr/0027-api-contract-publication.md)
  and `README.md`'s "Roadmap" section, for related forward-looking work
  (OpenAPI generation, SDKs) that is out of scope for this document.
