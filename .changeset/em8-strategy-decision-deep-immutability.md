---
"@ai-gateway/strategy-layer": patch
---

Fix `StrategyDecision` immutability: previously only the decision object
itself and its `optimizations` property were frozen (`Object.freeze` is
shallow), leaving every other nested object and array — `requiredCapabilities`,
`executionProfile` and its own nested `inference`/`retryPolicy`/`streaming`/
`structuredOutput`/`caching`/`adjustedBy` objects and
`preferredModelClasses`/`retryableErrorCodes` arrays, `optimizations.cost`,
`optimizations.prompt` and its `messages`/`transformationsApplied` arrays,
and `cacheHit` — fully mutable despite documentation claiming otherwise.
`DefaultStrategyPipeline.run` now deep-freezes the entire `StrategyDecision`
tree before returning it; any downstream mutation attempt now throws
instead of silently succeeding. No public interface change — `StrategyDecision`'s
shape is unchanged, only its runtime immutability guarantee is now actually
enforced as documented. Found by the EM-8 Independent Architecture &
Engineering Review, Finding 1.
