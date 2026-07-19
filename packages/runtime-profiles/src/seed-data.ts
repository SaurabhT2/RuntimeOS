import type { RuntimeProfile } from "./runtime-profile.js";

/**
 * architecture §37.3's illustrative preset table, expressed as full
 * `RuntimeProfile` records. The table gives qualitative descriptions
 * (e.g. "Aggressive, wide failover chain") for most fields but no concrete
 * numbers for `maxProvidersInFailoverChain`, `tokenUsageCeilingPerRequest`,
 * or `dailyBudgetUsd` — those are designed, not specified, chosen to be
 * internally consistent with each row's own qualitative description (e.g.
 * `enterprise`'s "aggressive, wide failover chain" gets the largest
 * `maxProvidersInFailoverChain`; `free_tier`'s "minimize token burn" gets
 * the lowest `tokenUsageCeilingPerRequest`). Like `SEED_EXECUTION_PROFILES`
 * and `SEED_CAPABILITIES`, this is retunable seed data
 * (`RuntimeProfileRegistry.upsertProfile`), not compiled logic.
 */
export const SEED_RUNTIME_PROFILES: RuntimeProfile[] = [
  {
    id: "development",
    provider: {
      preferFreeTier: true,
      // §37.3 reads "All, including experimental" for this preset. Read as
      // excluding "deprecated"/"retired": those two states exist to mark
      // models on their way *out* of service, which is a signal a
      // fast-iteration development preset has no reason to route around —
      // "all" here means "the full range a developer might want to try,"
      // not "every lifecycle state the schema defines, including the ones
      // slated for removal."
      allowedLifecycleStates: ["experimental", "preview", "recommended", "stable"],
      maxProvidersInFailoverChain: 2,
    },
    reliability: { retryAggressiveness: "conservative", failoverAggressiveness: "conservative" },
    cost: { tokenUsageCeilingPerRequest: 32_000 },
    telemetry: { verbosity: "verbose" },
    caching: { aggressiveness: "aggressive" },
  },
  {
    id: "free_tier",
    provider: {
      preferFreeTier: true,
      allowedLifecycleStates: ["preview", "recommended", "stable"],
      maxProvidersInFailoverChain: 2,
    },
    reliability: { retryAggressiveness: "conservative", failoverAggressiveness: "conservative" },
    cost: { tokenUsageCeilingPerRequest: 8_000, dailyBudgetUsd: 1 },
    telemetry: { verbosity: "minimal" },
    caching: { aggressiveness: "aggressive" },
  },
  {
    id: "production",
    provider: {
      preferFreeTier: false,
      allowedLifecycleStates: ["recommended", "stable"],
      maxProvidersInFailoverChain: 3,
    },
    reliability: { retryAggressiveness: "standard", failoverAggressiveness: "standard" },
    cost: { tokenUsageCeilingPerRequest: 32_000, dailyBudgetUsd: 250 },
    telemetry: { verbosity: "standard" },
    caching: { aggressiveness: "standard" },
  },
  {
    id: "enterprise",
    provider: {
      preferFreeTier: false,
      allowedLifecycleStates: ["stable"],
      maxProvidersInFailoverChain: 5,
    },
    reliability: { retryAggressiveness: "aggressive", failoverAggressiveness: "aggressive" },
    cost: { dailyBudgetUsd: 5_000 },
    telemetry: { verbosity: "standard" },
    caching: { aggressiveness: "standard" },
  },
  {
    id: "offline",
    provider: {
      preferFreeTier: false,
      allowedLifecycleStates: ["stable"],
      // No network-dependent failover (architecture §37.3): a single,
      // self-hosted-compatible target rather than a chain.
      maxProvidersInFailoverChain: 1,
    },
    reliability: {
      retryAggressiveness: "conservative",
      // §37.3 reads "Disabled (no network-dependent failover)" for this
      // preset, but §37.2's schema has no "disabled" value in the
      // `failoverAggressiveness` enum — only "conservative" | "standard" |
      // "aggressive" — so some interpretation is unavoidable.
      // "conservative" is the stand-in: paired with the
      // `maxProvidersInFailoverChain: 1` above, a conservative failover
      // policy over a chain of length one has no second target to fail
      // over *to*, which reproduces "disabled" behavior without adding an
      // enum value the schema doesn't define.
      failoverAggressiveness: "conservative",
    },
    cost: {},
    telemetry: { verbosity: "standard" },
    caching: { aggressiveness: "aggressive" },
  },
  {
    id: "high_availability",
    provider: {
      preferFreeTier: false,
      allowedLifecycleStates: ["recommended", "stable"],
      maxProvidersInFailoverChain: 6,
    },
    reliability: { retryAggressiveness: "aggressive", failoverAggressiveness: "aggressive" },
    cost: { dailyBudgetUsd: 5_000 },
    telemetry: { verbosity: "standard" },
    caching: { aggressiveness: "standard" },
  },
];

/**
 * architecture §37.4: "selected per tenant ... or, for self-hosted
 * deployments, per environment/deployment as a whole." Absent any explicit
 * tenant override or configured deployment default, `production` is the
 * safe fallback — it is the profile whose own description is "Balanced
 * (Policy Engine default weights)", i.e. the profile designed to be a
 * reasonable default rather than an edge case.
 */
export const DEFAULT_RUNTIME_PROFILE_ID = "production" as const;
