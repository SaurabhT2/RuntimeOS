import type {
  ExecutionProfileRegistry,
  ResolvedExecutionProfile,
} from "@ai-gateway/execution-profile-registry";
import type { RuntimeProfile } from "@ai-gateway/runtime-profiles";
import type { StrategyContext, StrategyPipelineStage } from "../types.js";

/**
 * architecture §37.4's "aggressiveness" enums are qualitative
 * (`"conservative" | "standard" | "aggressive"`), with no numeric
 * multiplier specified — designed, not specified, the same category of
 * choice `runtime-profiles`' own `SEED_RUNTIME_PROFILES` doc comment
 * makes for `maxProvidersInFailoverChain`/budget figures. `"standard"` is
 * always a no-op by construction (every profile's own resolved default
 * *is* the standard behavior), so a `"production"`-runtime-profile
 * request — the common default (`DEFAULT_RUNTIME_PROFILE_ID`,
 * `runtime-profiles/src/seed-data.ts`) — never has its retry policy
 * touched here.
 */
function adjustRetryPolicy(
  retryPolicy: ResolvedExecutionProfile["retryPolicy"],
  aggressiveness: RuntimeProfile["reliability"]["retryAggressiveness"],
): ResolvedExecutionProfile["retryPolicy"] {
  if (aggressiveness === "conservative") {
    return {
      ...retryPolicy,
      maxAttempts: Math.max(1, retryPolicy.maxAttempts - 1),
      baseDelayMs: retryPolicy.baseDelayMs * 2,
      maxDelayMs: retryPolicy.maxDelayMs * 2,
    };
  }
  if (aggressiveness === "aggressive") {
    return {
      ...retryPolicy,
      maxAttempts: retryPolicy.maxAttempts + 2,
      baseDelayMs: Math.max(1, Math.round(retryPolicy.baseDelayMs / 2)),
    };
  }
  return retryPolicy;
}

/** Same "`standard` is always a no-op" property as {@link adjustRetryPolicy}. */
function adjustCaching(
  caching: ResolvedExecutionProfile["caching"],
  aggressiveness: RuntimeProfile["caching"]["aggressiveness"],
): ResolvedExecutionProfile["caching"] {
  if (aggressiveness === "off") {
    return { defaultEnabled: false, keyStrategy: caching.keyStrategy };
  }
  if (aggressiveness === "aggressive") {
    return {
      ...caching,
      defaultEnabled: true,
      ttlSeconds: caching.ttlSeconds ? caching.ttlSeconds * 3 : 1_800,
    };
  }
  return caching;
}

/**
 * architecture §30.2's `PROF` node: "Execution Profile Registry:
 * capabilities + runtime profile -> ExecutionProfile." Resolves
 * `preferences.executionProfileOverride` (architecture §31.1) as the
 * optional caller-facing override — still a profile *ID*, never a raw
 * inference parameter, per that section's guarantee.
 *
 * **EM-9 (Independent Architecture & Engineering Review of EM-9,
 * activating architecture §37.4's first read site):** `execution-profile-registry`'s
 * own frozen `resolveProfile(task, overrideProfileId?)` (architecture
 * §31.2) still takes neither a `CapabilitySet` nor a `RuntimeProfile` — it
 * still resolves purely from `task` (+ the optional override), unchanged,
 * and this file still does not modify that package. What changes at EM-9
 * is this *stage*: with `RuntimeProfileResolutionStage` now running first
 * in `buildDefaultStages`'s order (`strategy-layer.ts`), `ctx.runtimeProfile`
 * is available here, so this stage now applies architecture §37.4's "the
 * Execution Profile Registry ... to adjust `streaming`, `caching`, and
 * `timeoutMs` defaults" for the two of those three fields `RuntimeProfile`
 * (architecture §37.2) actually has a corresponding field for:
 * `caching.aggressiveness` → `caching`, and (recorded on the profile's
 * `retryPolicy`, which is the field architecture §37.4's *fourth* read
 * site — "Retry Engine ... to adjust `RetryPolicy.maxAttempts`/backoff
 * ... per `reliability.retryAggressiveness`" — actually consumes, once
 * this profile flows through `StrategyDecision` to `orchestrator`'s Retry
 * Engine) `reliability.retryAggressiveness` → `retryPolicy`.
 *
 * `RuntimeProfile` (§37.2) has **no field** literally named `streaming` or
 * `timeoutMs`, so this stage does **not** invent a mapping for those two —
 * doing so would be exactly the kind of silently-resolved architecture
 * ambiguity this milestone's review instructions forbid. See this
 * package's README, "EM-9 Architecture Compliance Notes," and this
 * milestone's Review Closure Report for the documented gap (an ADR
 * candidate, not resolved here).
 *
 * `adjustedBy` is set only when at least one field actually changed
 * (`"standard"` aggressiveness on both axes — the default `production`
 * runtime profile — changes nothing, by design; see {@link adjustRetryPolicy}
 * / {@link adjustCaching}), so a request under the default runtime profile
 * produces exactly the same `ResolvedExecutionProfile` EM-8 did.
 */
export class ExecutionProfileResolutionStage implements StrategyPipelineStage {
  readonly name = "execution_profile_resolution";

  constructor(private readonly registry: ExecutionProfileRegistry) {}

  async run(ctx: StrategyContext): Promise<StrategyContext> {
    const profile = await this.registry.resolveProfile(
      ctx.request.task,
      ctx.request.preferences?.executionProfileOverride,
    );

    if (!ctx.runtimeProfile) {
      // Same fallback EM-8 had: no runtime profile resolved (e.g. a
      // custom, non-default stage list omits `RuntimeProfileResolutionStage`)
      // means no adjustment is possible — return the profile as resolved,
      // unmodified.
      const executionProfile: ResolvedExecutionProfile = profile;
      return { ...ctx, executionProfile };
    }

    const fieldsOverridden: string[] = [];

    const adjustedRetryPolicy = adjustRetryPolicy(
      profile.retryPolicy,
      ctx.runtimeProfile.reliability.retryAggressiveness,
    );
    if (adjustedRetryPolicy !== profile.retryPolicy) {
      fieldsOverridden.push("retryPolicy");
    }

    const adjustedCaching = adjustCaching(
      profile.caching,
      ctx.runtimeProfile.caching.aggressiveness,
    );
    if (adjustedCaching !== profile.caching) {
      fieldsOverridden.push("caching");
    }

    const executionProfile: ResolvedExecutionProfile = {
      ...profile,
      retryPolicy: adjustedRetryPolicy,
      caching: adjustedCaching,
      ...(fieldsOverridden.length > 0
        ? { adjustedBy: { runtimeProfileId: ctx.runtimeProfile.id, fieldsOverridden } }
        : {}),
    };

    return { ...ctx, executionProfile };
  }
}
