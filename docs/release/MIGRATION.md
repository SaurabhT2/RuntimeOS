# Migration Guide

This document is for callers or operators with an existing AI Gateway
v1.0 integration who want to adopt what shipped since — the Strategy
Layer (v1.1/v1.2, EM-6–EM-8), Pipeline Orchestration (v1.2, EM-10), and
Budget Governance (v1.2, EM-10–EM-11). If you're starting fresh, you
don't need this document — go to [`README.md`](../../README.md)'s
"Getting started" instead.

## The headline: nothing you already built needs to change

**No breaking change exists anywhere in the public HTTP API between
v1.0.0 and v1.2.0.** `POST /v1/execute`, `POST /v1/execute/stream`, and
`GET /v1/health` behave identically to how they did at v1.0, whether or
not any v1.1/v1.2 feature is enabled on the deployment you're calling.
This isn't an informal claim — it's an enforced regression suite:
`packages/gateway-runtime/test/integration/end-to-end.test.ts`'s "EM-8
Pass-through Regression" proves `enableStrategyLayer: true` and `false`
produce byte-for-byte identical `provider`/`retries`/`failedOver`/
`finishReason` results against a Mock Adapter, and none of Pipeline
Orchestration or Budget Governance touches the single-step execution
path at all unless you explicitly call the new endpoint or a deployment
explicitly wires budget policies in. If you're calling
`POST /v1/execute` today, you can upgrade the platform version underneath
you with no client-side changes, full stop.

Everything below is about *opting into* new capability, not about
keeping up with a moving target underneath you.

## Adopting the Strategy Layer

**What it is:** capability-aware, execution-profile-aware, cost-aware,
and prompt-optimization-aware routing, layered ahead of Policy Engine.
See `README.md`'s "What v1.2 delivers" and
`packages/strategy-layer/README.md` for what it actually does.

**What you need to do:** nothing, as a caller. The Strategy Layer is an
**operator-side** setting (`ENABLE_STRATEGY_LAYER=true`) — your
`ExecuteRequest` shape is unchanged, and enabling it on the deployment
you're calling doesn't require you to send any new field. If it's
enabled, you may notice different `provider`/model choices in
`ExecuteResponse.execution` for the same `task` than you saw under v1.0
— that's the Strategy Layer working as intended, not a regression.

**If you're the operator** deciding whether to flip
`ENABLE_STRATEGY_LAYER=true`: read
[`DEPLOYMENT.md`'s "Strategy Layer" section](DEPLOYMENT.md#strategy-layer-em-8-v11v12)
in full before doing so in production — the Engineering Blueprint's own
EM-8 exit criteria call for an A/B replay against a staging deployment
with a measured latency budget, and nothing in this repository can
perform that validation for you (see
[`KNOWN_LIMITATIONS.md` §10.1](KNOWN_LIMITATIONS.md#101-ab-replay-of-em-5-load-test-traffic-and-gateway-latency-budget-validation-cannot-be-performed-within-this-repository)).

## Adopting Pipeline Orchestration

**What it is:** running a sequence of steps through the gateway in one
call, a later step optionally consuming an earlier step's output. See
[`apps/gateway-server/README.md`'s `POST /v1/execute/pipeline`
section](../../apps/gateway-server/README.md) for the full request/
response contract.

**What you need to do:** call the new endpoint instead of (or alongside)
`POST /v1/execute` — no flag, no operator-side configuration required
beyond what a normal deployment already needs. See
[`examples/pipeline-client`](../../examples/pipeline-client) for a
complete, runnable client. If a deployment has Budget Governance
configured (see below), it applies per step exactly as it would to an
equivalent standalone `POST /v1/execute` call — nothing extra to handle
on your side.

**Migrating an existing multi-request workflow:** if your application
currently makes several sequential `POST /v1/execute` calls itself,
stitching one response into the next request's input in your own code,
you can fold that into a single pipeline call — replace each of your
`fetch` calls with one `steps[]` entry, and replace your own
response-to-next-request wiring with `inputFrom`. This reduces round
trips but does not change per-step behavior; each step still runs
through the exact same `ExecutionOrchestrator.execute()` a standalone
call would use.

## Adopting Budget Governance

**What it is:** per-tenant daily/monthly spend budgets with configurable
threshold actions. See `README.md`'s "What v1.2 delivers" for the
one-paragraph summary.

**Read this before doing anything else:** as shipped, the published
`apps/gateway-server` binary **cannot** enable Budget Governance at all
— there is no environment variable or config-file field for it. This is
not a migration step you can complete by changing configuration; it
requires writing code. See
[`KNOWN_LIMITATIONS.md` §9.3](KNOWN_LIMITATIONS.md#93-neither-deployment-application-has-a-configuration-surface-for-budget-governance)
for exactly why, and
[`DEPLOYMENT.md`'s "Budget Governance" section](DEPLOYMENT.md#budget-governance-em-10-v12)
for a worked example of the composition-root code you'd write instead of
relying on `apps/gateway-server`'s standard env-var configuration.

**If you do write that code, migrate in this order — don't skip
straight to enforcement:**

1. Start with `budgetEnforcementMode: "shadow"` (the default, and the
   only mode you should run in for at least one full billing/observation
   cycle). Nothing is blocked or altered; you get real telemetry on what
   *would* happen.
2. Watch that telemetry. Confirm the thresholds and actions you
   configured produce the outcomes you expect against real traffic
   patterns, not just the test fixtures in
   `packages/budget-governance/test/`.
3. Before flipping to `budgetEnforcementMode: "enforcing"`, read
   [`KNOWN_LIMITATIONS.md` §9.2](KNOWN_LIMITATIONS.md#92-switch_provider-threshold-actions-have-no-effect-on-real-routing--read-this-before-enabling-enforcement-mode)
   in full. `block`, `alert`, and `downgrade_model` are verified working
   end-to-end; `switch_provider` is not — if any of your threshold
   configuration relies on `switch_provider`, reconfigure it to use
   `block` or `downgrade_model` instead before enforcing, not after.
4. Remember `InMemoryBudgetLedger` is non-durable
   ([§9.1](KNOWN_LIMITATIONS.md#91-inmemorybudgetledger-is-non-durable))
   — a process restart zeroes cumulative spend tracking. If your
   migration plan assumes spend tracking survives a deploy, it currently
   doesn't; plan your deployment cadence around that or wait for a
   durable ledger implementation (tracked as a v1.3 candidate in
   `README.md`'s "Roadmap").

## Package-level consumers (internal/monorepo callers only)

If you depend on `@ai-gateway/*` packages directly rather than calling
the HTTP API — which
[`VERSIONING.md`](VERSIONING.md#compatibility-expectations-for-integrators)
notes is not a supported integration path outside this monorepo, but
applies to anyone extending the platform itself — check each package's
own README for what changed. The five packages whose "Relationship to
`orchestrator`/`strategy-layer`" notes were corrected during the v1.2
documentation pass (`cost-optimizer`, `prompt-optimizer` — now genuinely
wired in and invoked as of EM-8; `learning` — reachable but not yet
functionally invoked; `plugin-system` — still not wired in anywhere) are
the ones most likely to surprise you if you were relying on an older
description of their integration status.

## Questions this guide doesn't answer

If you're trying to determine whether a specific behavior changed
between two versions and this document doesn't cover it, check
[`CHANGELOG.md`](../../CHANGELOG.md) for the specific release, and
[`KNOWN_LIMITATIONS.md`](KNOWN_LIMITATIONS.md) for whether it's a
documented, intentional limitation rather than a migration concern.
