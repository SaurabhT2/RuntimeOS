---
"@ai-gateway/policy-engine": minor
---

EM-9: `DefaultPolicyEngine.selectExecutionPlan` now reads a well-formed
`ctx.strategyDecision` (present since EM-8 via ADR-0018, previously
accepted-but-ignored) to influence routing: `requiredCapabilities`
supersedes the ad-hoc task-classifier's capability-filter fields;
`executionProfile.preferredModelClasses` and
`optimizations.cost.recommendedModelClassDowngrade`/`preferFreeTierProviders`
nudge scoring (soft signals only — architecture §33.2, never a hard
override); `executionProfile.inference`/`.timeoutMs`/`.retryPolicy`/`.streaming.defaultEnabled`
supersede EM-3's request-derived/hardcoded Plan Assembly defaults; and
`optimizations.cost.disableStreaming` forces `streaming: false`. Every
field is validated independently and falls back to the exact EM-3/EM-8
value when absent or malformed — `selectExecutionPlan`'s signature is
unchanged, and behavior is unaffected when `ctx.strategyDecision` is
absent (the common case until `enableStrategyLayer` is turned on).
Exports `StrategySignals`, `CapabilitySetLike`, `ResolvedExecutionProfileLike`,
`CostOptimizationResultLike`, and the `strategy-signals.ts` derivation/validation
helpers.
