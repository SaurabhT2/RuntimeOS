---
"@ai-gateway/orchestrator": patch
---

EM-9: `buildNormalizedInvocation` gains an optional third parameter,
`strategyDecision`. When supplied and its `optimizations.prompt.messages`
is present and well-formed, those messages replace `resolveMessages(req)`'s
output entirely (architecture §34.5). Both `execute` and `executeStream`
now pass their already-in-scope `strategyDecision` through. No change to
`NormalizedInvocation`'s shape; behavior is unaffected when
`strategyDecision` is absent or its prompt is malformed.
