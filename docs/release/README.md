# Release Governance — Index

This directory holds the release-governance documentation for AI Gateway,
produced as a dedicated governance pass (separate from, and after, the
engineering milestones themselves — see
`docs/history/IMPLEMENTATION_PROGRESS.md` for that build history). It
does not describe engineering implementation; it describes what is
released, how it is versioned, how it is deployed, and how to prepare
the next release.

| Document | Purpose |
|---|---|
| [`RELEASE_NOTES.md`](RELEASE_NOTES.md) | User-facing description of what each tagged release delivers, current through v1.2.0. |
| [`KNOWN_LIMITATIONS.md`](KNOWN_LIMITATIONS.md) | The single, consolidated, sourced list of every documented limitation, current through v1.2. |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | How to build, configure, run, and operate the Node/container gateway server (`apps/gateway-server`), current through v1.2. |
| [`DEPLOYMENT-VERCEL.md`](DEPLOYMENT-VERCEL.md) | The equivalent deployment guide for the Vercel-hosted composition root (`apps/vercel-adapter`). |
| [`RUNTIME_CONFIGURATION_MATRIX.md`](RUNTIME_CONFIGURATION_MATRIX.md) | What RuntimeOS supports vs. what each deployment app currently exposes, capability by capability — and why that distinction matters. Added during the v1.2 documentation-completion pass. |
| [`MIGRATION.md`](MIGRATION.md) | For an existing v1.0 integration adopting the Strategy Layer, Pipeline Orchestration, or Budget Governance. Added during the v1.2 documentation pass. |
| [`VERSIONING.md`](VERSIONING.md) | Semantic versioning policy, API stability, and the release process. |
| [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md) | The checklist to run through for this and every future release. |
| [`SUPPORT_POLICY.md`](SUPPORT_POLICY.md) | What's supported, how to get help, and response expectations, current through v1.2. |

Related documents elsewhere in the repository:

- [`../../CHANGELOG.md`](../../CHANGELOG.md) — the versioned change
  history, starting at `1.0.0` and current through `1.2.0`.
- [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) — contributor
  workflow, coding standards, and the ADR process.
- [`../../SECURITY.md`](../../SECURITY.md) — vulnerability reporting and
  the current security boundary.
- [`../adr/README.md`](../adr/README.md) — the Architecture Decision
  Record index (27 ADRs on record: accepted decisions, open/draft
  implementation-gap findings, and one roadmap recommendation).
- [`../backlog/README.md`](../backlog/README.md) — scoped engineering
  work surfaced by this documentation (distinct from both an ADR and a
  known limitation — see that index for the distinction). Added during
  the v1.2 documentation-completion pass.
- [`../architecture/architecture-spec.md`](../architecture/architecture-spec.md)
  and [`../architecture/engineering-blueprint.md`](../architecture/engineering-blueprint.md)
  — the frozen source documents everything above cross-references.
- [`../history/IMPLEMENTATION_PROGRESS.md`](../history/IMPLEMENTATION_PROGRESS.md)
  — the chronological engineering build record (EM-0 through EM-11) that
  the documents in this directory summarize for a release audience.
