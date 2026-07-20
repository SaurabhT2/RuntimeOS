# Engineering Backlog

This directory tracks concrete, scoped engineering work that this
repository's documentation has surfaced but that is explicitly **not**
architecture-review work (that's `docs/adr/`'s job) and **not** a
release-blocking defect (that's `docs/release/KNOWN_LIMITATIONS.md`'s
job). An item here is real, tracked engineering work with a clear
description of what "done" looks like — distinct from both an
architectural decision awaiting Board ruling and a documented limitation
of the current release.

Added during the v1.2 documentation-completion pass, alongside the first
tracked item below.

| Item | Summary |
|---|---|
| [`expose-complete-gatewayruntimeconfig-surface.md`](expose-complete-gatewayruntimeconfig-surface.md) | Both deployment applications (`apps/gateway-server`, `apps/vercel-adapter`) expose only part of `@ai-gateway/gateway-runtime`'s `GatewayRuntimeConfig` through their own environment-variable/config-file loaders. Not a RuntimeOS implementation defect — deployment/composition-root integration work. |
