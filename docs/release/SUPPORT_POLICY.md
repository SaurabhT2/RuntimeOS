# Support Policy

## Scope

This policy covers support for the AI Gateway platform code in this
repository — the packages under `packages/`, the `apps/gateway-server`
composition root, and the example clients under `examples/`. It does not
cover support for third-party AI providers (Groq, NVIDIA NIM) themselves,
or for infrastructure you choose to run AI Gateway on.

## Supported version

Only the current tagged platform release (`v1.2.x` as of this writing —
see [`VERSIONING.md`](VERSIONING.md) for how the platform tag relates to
individual package versions) receives support. There is no long-term
support (LTS) branch and no backport policy for older releases (`v1.0.x`,
`v1.1.x`) at this stage of the project's history.

## How to get help

- **Bugs and defects:** open a GitHub issue. Please check
  [`KNOWN_LIMITATIONS.md`](KNOWN_LIMITATIONS.md) first — a behavior
  documented there as deferred/out-of-scope is not a defect, and won't
  be actioned as one.
- **Security vulnerabilities:** do **not** open a public issue — follow
  [`../../SECURITY.md`](../../SECURITY.md)'s private reporting process
  instead.
- **Usage questions:** open a GitHub issue or discussion. See
  `apps/gateway-server/README.md` for the public API and
  `examples/minimal-node-client`/`examples/streaming-client`/`examples/pipeline-client` for
  reference client code.
- **Feature requests / scope beyond v1.2:** open an issue describing the
  use case. Please note whether it maps to functionality already named
  in [`README.md`](../../README.md)'s "Roadmap" section or as a future
  milestone in the Engineering Blueprint (§7) — if so, it may already be
  planned, just not yet scheduled or scoped for this repository's next
  release.

## Response expectations

This is a single-maintainer-governed project at this stage. Support is
best-effort:

- Issues are triaged as time allows; there is no guaranteed first-
  response time.
- Confirmed defects in currently-supported scope are prioritized over
  feature requests.
- A defect in explicitly out-of-scope (deferred) functionality — per
  `KNOWN_LIMITATIONS.md` — will be closed with a reference to that
  document rather than actioned, unless it's re-scoped into a future
  milestone.

## What "supported" means for the current release

Supported means: a defect in functionality that
`docs/release/RELEASE_NOTES.md` and `CHANGELOG.md` describe as shipping
in the current tagged release (`v1.2.x`) will be investigated and, if
confirmed, fixed in a subsequent patch/minor release of the affected
package(s). A behavior explicitly documented as a known limitation in
[`KNOWN_LIMITATIONS.md`](KNOWN_LIMITATIONS.md) — for example, Budget
Governance's `switch_provider` gap (§9.2) or its lack of an
`apps/gateway-server` configuration surface (§9.3) — is not itself a
defect and will be triaged per "Response expectations," above.

It does **not** mean:

- A guarantee of uptime or availability for any specific deployment —
  this repository ships the software, not a hosted service.
- Support for modifications you make to the code in your own fork or
  deployment, beyond a best-effort attempt to help distinguish your
  change from an upstream defect.
- Enterprise support commitments (SLAs, dedicated support contacts,
  custom development) — none exist for this release.
