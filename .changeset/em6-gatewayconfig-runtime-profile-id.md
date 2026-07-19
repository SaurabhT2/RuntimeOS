---
"@ai-gateway/config": minor
---

Add an optional `runtimeProfileId?: string` field to `GatewayConfig`
(architecture §37.4, ADR-0013), so a Runtime Profile
(`@ai-gateway/runtime-profiles`, new in EM-6) can be selected per
tenant/deployment. Fully additive and backward-compatible — every
`GatewayConfig` value valid before this change remains valid, unchanged,
after it.
