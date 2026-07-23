# Backlog: Expose Complete `GatewayRuntimeConfig` Surface Through Deployment Applications

**Filed:** 2026-07-19, during the v1.2 documentation-completion pass
**Type:** Deployment / composition-root integration work
**Not:** A RuntimeOS implementation defect, and not architecture-review
work — see "Why this is not an implementation defect," below.

## Summary

Both deployment applications in this repository —
`apps/gateway-server` (`apps/gateway-server/src/server-config.ts`'s
`loadServerConfigFromEnv`) and `apps/vercel-adapter`
(`apps/vercel-adapter/src/vercel-config.ts`'s `loadVercelConfigFromEnv`)
— construct a `@ai-gateway/gateway-runtime` `GatewayRuntimeConfig` from
`process.env`, but neither populates every field that interface defines.
Specifically, as of v1.2, neither app's loader reads any environment
variable (or `GATEWAY_CONFIG_PATH` JSON field, where that mechanism
applies — see below) for:

- `budgetPolicies`
- `budgetEnforcementMode`
- `maxPipelineSteps`

See [`docs/release/RUNTIME_CONFIGURATION_MATRIX.md`](../release/RUNTIME_CONFIGURATION_MATRIX.md)
for the full capability-by-capability breakdown, including the one
capability (`enableStrategyLayer`) that is _already_ reachable on both
apps today via a `GATEWAY_CONFIG_PATH` JSON file, which is the shape this
backlog item recommends extending to the three fields above.

## Why this is not an implementation defect

`@ai-gateway/gateway-runtime`'s `bootstrap()` fully supports all three
fields today — they are real, implemented, tested `GatewayRuntimeConfig`
fields, exercised directly by
`packages/gateway-runtime/test/bootstrap.test.ts`. The gap is entirely in
the two _application_ layers' own environment-variable/config-file
loaders, which is deployment/composition-root integration work, not a
change to `@ai-gateway/gateway-runtime` or any package it depends on.
This distinction matters for how this item should be scoped and by whom:
it does not require an Architecture Review Board decision (no frozen
interface changes), and it does not belong in
`docs/release/KNOWN_LIMITATIONS.md` as a defect to fix in a patch release
— it is net-new configuration-surface work for two specific,
already-identified files.

## Recommended shape of the fix

Mirroring `enableStrategyLayer`'s existing pattern in
`apps/gateway-server/src/server-config.ts` (a dedicated env var,
`ENABLE_STRATEGY_LAYER`, that overrides a same-named
`GatewayConfig`/`GATEWAY_CONFIG_PATH` field when present) is the most
consistent option, but is a design decision for whoever picks this up,
not mandated here. Two constraints that should hold regardless of the
exact mechanism chosen:

- **`budgetPolicies` cannot be a flat environment variable in any
  reasonable form** — it's an array of structured `BudgetPolicy` records
  (see `packages/budget-governance/src/types.ts`), not a scalar. A JSON
  string env var (`BUDGET_POLICIES_JSON`, mirroring
  `GATEWAY_API_KEYS_JSON`'s existing precedent in both apps' loaders) or
  a `GATEWAY_CONFIG_PATH` JSON field are the two realistic options —
  note that `budgetPolicies` is not currently part of
  `@ai-gateway/config`'s `GatewayConfig` Zod schema
  (`packages/config/src/schema.ts`), so the config-file route requires
  extending that schema first (an additive, non-breaking change, the
  same shape ADR-0013/0017 already established for
  `runtimeProfileId`/`enableStrategyLayer` — likely warrants its own ADR
  when implemented, following that precedent).
- **`budgetEnforcementMode` and `maxPipelineSteps` are simple scalars**
  and fit either mechanism cleanly (a `BUDGET_ENFORCEMENT_MODE` env var
  and a `MAX_PIPELINE_STEPS` env var, following
  `RATE_LIMIT_REQUESTS_PER_WINDOW`'s existing optional-positive-int
  parsing pattern in both apps' loaders).

Whichever mechanism is chosen, both `apps/gateway-server` and
`apps/vercel-adapter` should gain it together and identically — the two
apps' loaders are already deliberately kept in lockstep (see
`apps/vercel-adapter/src/vercel-config.ts`'s own doc comment: "every
recognized variable name/default/validation rule here is identical to
`apps/gateway-server`'s"), and this item should preserve that, not
introduce a new asymmetry between them.

## Acceptance criteria (draft — refine when this is actually scoped)

- [ ] An operator can configure `budgetPolicies` and
      `budgetEnforcementMode` for either deployed app without writing
      custom composition-root code.
- [ ] An operator can override `maxPipelineSteps` for either deployed
      app without writing custom composition-root code.
- [ ] `apps/gateway-server`'s and `apps/vercel-adapter`'s loaders remain
      symmetric — whatever mechanism is added exists identically in
      both, consistent with every other configuration field today.
- [ ] `docs/release/DEPLOYMENT.md`, `docs/release/DEPLOYMENT-VERCEL.md`,
      `docs/release/RUNTIME_CONFIGURATION_MATRIX.md`, and
      `docs/release/KNOWN_LIMITATIONS.md` §9.3 are all updated in the
      same change — this backlog item exists specifically because a
      configuration-surface change without a matching documentation
      change is exactly the kind of gap this documentation pass spent
      most of its effort correcting elsewhere.
- [ ] `docs/release/MIGRATION.md`'s "Adopting Budget Governance" section
      is updated to reflect the new, simpler configuration path (the
      custom-`bootstrap()`-call workaround it currently documents becomes
      unnecessary once this item ships).
