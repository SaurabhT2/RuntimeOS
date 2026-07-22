# Versioning Policy

## Two levels of versioning

AI Gateway versions at two independent levels, and it's important not to
conflate them:

1. **The platform release** — a git tag on this repository (e.g.
   `v1.0.0`) marking a complete, deployable milestone of
   `apps/gateway-server` and every package it composes. This is what
   `CHANGELOG.md` and `docs/release/RELEASE_NOTES.md` describe.
2. **Per-package semantic versioning** — each package under `packages/`
   and `apps/` has its own independent semver number in its
   `package.json`, managed via [Changesets](https://github.com/changesets/changesets)
   (`.changeset/config.json`).

**A platform release tag does not require every package to read the
same version number.** As of the `v1.0.0` platform tag, `core-contracts`
is at `1.0.0` (frozen, see below); every other package is at `0.1.0`.
This remains true as of the current `v1.2.0` tag — no package's public
surface has yet crossed the "consumed outside this monorepo" threshold
described below that would justify an independent version bump. This is
expected and correct — it reflects that `core-contracts` is the
one package with an external, independently-versioned compatibility
promise today, while every other package's public surface is still
consumed only from within this same monorepo, at the same commit, via
`workspace:*` references. Bumping every package's `package.json` to
`1.0.0` to "match" the platform tag is not part of this project's
versioning policy and should not be done just for cosmetic consistency.

## Semantic versioning policy

Every package follows standard semver (`MAJOR.MINOR.PATCH`):

- **MAJOR** — a breaking change to that package's public API (an
  exported type, function signature, or documented behavior changes in
  a way that could break an existing consumer).
- **MINOR** — a backward-compatible addition (a new export, a new
  optional field, a new optional constructor parameter with a default).
- **PATCH** — a backward-compatible fix.

Changes are proposed via `pnpm changeset`, which records the affected
package(s) and bump type; `pnpm version-packages` (`changeset version`)
applies the accumulated changesets to bump versions and generate
changelog entries at release time.

### `core-contracts`: the strictest compatibility bar

`core-contracts` is frozen at `1.0.0` (per
[ADR-0001](../adr/0001-em0-core-contracts-freeze.md)) because every
other package, and every external consumer's request/response handling,
depends on it. Any change to an exported type in `core-contracts`
requires an ADR, following the same Context / Decision / Consequences /
Alternatives process used for architecture-level contract changes
(Engineering Blueprint §6.3; Architecture Specification §28/§39/§46).
This is a materially higher bar than the ADR requirement for other
packages' interfaces (see "API stability," below) — `core-contracts` has
no lower-risk path for a breaking change.

## API stability

Two different kinds of "public API" exist in this codebase, with
different stability guarantees:

1. **The HTTP API** (`POST /v1/execute`, `POST /v1/execute/stream`,
   `POST /v1/execute/pipeline` (v1.2), `GET /v1/health`) — this is the
   contract external, non-monorepo callers depend on (see `examples/*`).
   Changes here follow the same
   discipline as a `core-contracts` change: the request/response bodies
   are `core-contracts` types, so a breaking HTTP contract change is, by
   definition, a `core-contracts` breaking change.
2. **Internal package interfaces** (`PolicyEngine`, `CredentialResolver`,
   `RetryEngine`, etc.) — frozen for the remainder of the Engineering
   Milestone in which they were introduced (Engineering Blueprint §6.3),
   but changeable across milestones via the standard ADR process. These
   are consumed only within this monorepo as of v1.0; they do not carry
   the same external-compatibility weight as `core-contracts` or the
   HTTP API, but a breaking change to one still requires an ADR per
   Section 6.3's process, and still bumps that package's major version.

## Compatibility expectations for integrators

If you are calling AI Gateway over its HTTP API (the supported
integration path — see `examples/minimal-node-client`,
`examples/streaming-client`, `examples/pipeline-client`):

- `ExecuteRequest`/`ExecuteResponse`/`GatewayError` shapes are stable
  within a major platform version; a breaking change to any of them
  requires both a `core-contracts` major version bump and an ADR.
  Architecture §24 states this policy directly: "Contract tests...
  ensure `ExecuteRequest`/`ExecuteResponse`/`GatewayError` remain
  backward compatible across releases."
- New optional request fields, new response fields, and new
  `GatewayErrorCode` values may be added in a minor/patch release.
- Do not depend on any package under `packages/` directly — those are
  internal implementation detail of `apps/gateway-server` as of v1.0.
  There is no published/publishable package registry entry for any
  `@ai-gateway/*` package today; every consumer is either inside this
  monorepo or calling the HTTP API.

## ADR process after Version 1.0

The ADR process described in `CONTRIBUTING.md` continues unchanged after
the v1.0.0 tag:

- A breaking change to any frozen interface (`core-contracts`'s exported
  types most strictly; any other package's public interface per Section
  6.3) requires an ADR before the change merges.
- A newly discovered inconsistency between the Architecture
  Specification and the shipped implementation is recorded as a
  proposed/draft ADR (see `docs/adr/README.md`'s legend), not silently
  patched — this applies after v1.0 exactly as it did during EM-0
  through EM-5.
- The ten currently open, proposed/draft ADRs (0004, 0005, 0006, 0007,
  0009, 0010, 0014, 0019, 0020, 0025 — see
  `docs/release/KNOWN_LIMITATIONS.md` §6 and `docs/adr/README.md` for the
  full index) remain open for the Architecture Review Board's decision.
  Resolving one is an architecture-review action, not a release-governance
  one, and is explicitly out of scope for this document.

## Release process

1. Land the intended set of changes on `main`, each with a changeset
   (`pnpm changeset`) where a package's public surface changed.
2. Run `pnpm version-packages` to apply accumulated changesets — this
   bumps affected packages' versions and updates their changelogs.
3. Run the full validation suite (`pnpm build lint typecheck test
test:coverage graph:check format:check`) against the resulting commit.
4. Tag the platform release (e.g. `git tag v1.0.0`) once
   `docs/release/RELEASE_CHECKLIST.md` is fully satisfied.
5. Publish `CHANGELOG.md`/`docs/release/RELEASE_NOTES.md` updates for
   the tagged release.
6. `pnpm release` (`turbo run build && changeset publish`) if/when any
   package is published to a registry — no package is published to a
   public registry as of the v1.0.0 platform tag (see `.changeset/config.json`'s
   `"access": "restricted"`).

## Release cadence

Per Engineering Blueprint §11: weekly canary releases from `main`, with
a stable release tagged at the end of each Engineering Milestone. The
`v1.0.0` tag corresponds to the end of EM-5; `v1.2.0`, the current
platform tag, corresponds to the end of EM-11 — see `CHANGELOG.md` for
every milestone tagged in between.
