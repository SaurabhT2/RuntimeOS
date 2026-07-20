# Release Checklist

Use this checklist for every tagged platform release, starting with
`v1.0.0`. Copy it into the release PR/issue description and check off
each item before tagging.

## 1. Repository

- [ ] `main` is green: the full CI workflow (`.github/workflows/ci.yml`)
      passed on the exact commit being released.
- [ ] No uncommitted changesets remain for packages whose public surface
      changed since the last release (`pnpm changeset status`).
- [ ] `pnpm-lock.yaml` is up to date and committed (CI's
      `--frozen-lockfile` install would otherwise fail).
- [ ] Working tree is clean — `git status` shows nothing outstanding.

## 2. Documentation

- [ ] `CHANGELOG.md` has an entry for this release (or, for `v1.0.0`,
      the initial entry is accurate and complete).
- [ ] `docs/release/RELEASE_NOTES.md` reflects what is actually shipping
      — not what's planned for a future milestone.
- [ ] `docs/release/KNOWN_LIMITATIONS.md` is current: cross-check every
      package's "Deferred Work"/"Scope Verification" section and
      `docs/adr/README.md`'s open-ADR list against it; add anything
      newly deferred, remove anything since resolved.
- [ ] Every package README whose public interface changed was updated
      in the same PR as the code change (per `CONTRIBUTING.md`'s
      documentation expectations) — spot-check rather than re-reading
      every README from scratch.
- [ ] Root `README.md`'s "Engineering milestones" table and any
      "Status" line are consistent with what this release actually
      contains.
- [ ] Cross-references between release documents resolve (no broken
      relative links between `CHANGELOG.md`, `docs/release/*.md`,
      `docs/adr/*.md`, `docs/architecture/*.md`).
- [ ] Every environment variable or config field a new feature reads is
      actually documented in `docs/release/DEPLOYMENT.md`'s environment
      variable table or a dedicated section — and, just as importantly,
      if a feature's config is **not** reachable via `apps/gateway-server`
      (env var or `GATEWAY_CONFIG_PATH`), that gap itself is stated
      explicitly rather than left for a reader to discover on their own.
      (Added for v1.2 after this exact gap — Budget Governance's missing
      config surface — was found undocumented across `README.md`,
      `CHANGELOG.md`, `RELEASE_NOTES.md`, and `DEPLOYMENT.md`
      simultaneously; see `KNOWN_LIMITATIONS.md` §9.3.)
- [ ] Any claim that a feature is "enabled/enforced by default" is
      checked against the actual default in source (e.g. the relevant
      `bootstrap()` option's `??` fallback), not against what an earlier
      draft of the release notes assumed — this exact category of
      overstatement (claiming a stricter default than the code ships)
      was found and corrected in three v1.2 documents simultaneously.

## 3. Validation

- [ ] `pnpm build` — succeeds for every package, in dependency order.
- [ ] `pnpm lint` — zero violations, including the package-boundary rule.
- [ ] `pnpm typecheck` — zero errors.
- [ ] `pnpm graph:check` — zero dependency cycles; every edge matches
      Architecture §4.1's `DEPENDENCY_TABLE`.
- [ ] `pnpm format:check` — clean.
- [ ] No new ADR is required and unfiled for any interface change in
      this release (check `docs/adr/README.md` against the diff).

## 4. Testing

- [ ] `pnpm test` — full suite passes.
- [ ] `pnpm test:coverage` — every package meets its tier's coverage bar
      (`CONTRIBUTING.md`'s coverage table); any pre-existing, documented
      exception is still the same exception (not a new regression).
- [ ] Cross-tenant isolation tests
      (`packages/credential-resolver/test/isolation.test.ts`) pass —
      this suite is a hard merge gate, not a nice-to-have.
- [ ] `tools/orchestrator-integration-tests` — end-to-end and chaos
      (failover) tests pass.
- [ ] `tools/adapter-conformance-tests` — every provider adapter
      (`groq`, `nvidia-nim`, and the Mock Adapter) passes the shared
      conformance suite at 100%.
- [ ] **Required once `enableStrategyLayer` defaults to (or is being
      flipped to) `true` for a release — still not required as of v1.2
      (it still defaults to `false`; see `README.md`'s "What v1.2
      delivers"):** the Engineering Blueprint's EM-8 A/B replay of EM-5's
      load-test traffic and gateway latency budget validation has been
      run against a real staging deployment — see
      [`KNOWN_LIMITATIONS.md` §10.1](KNOWN_LIMITATIONS.md#101-ab-replay-of-em-5-load-test-traffic-and-gateway-latency-budget-validation-cannot-be-performed-within-this-repository)
      for why this cannot be satisfied by any suite in this repository
      alone. (This item previously cited `KNOWN_LIMITATIONS.md` §9.1 —
      a broken cross-reference; the content it describes is at §10.1.
      Fixed during the v1.2 documentation pass.)

## 5. Deployment

- [ ] A clean-checkout build (`pnpm install --frozen-lockfile && pnpm
      build`) succeeds on a fresh machine/container, not just an
      incrementally-cached CI runner.
- [ ] `node apps/gateway-server/dist/index.js` starts successfully with
      a representative environment-variable configuration (see
      `docs/release/DEPLOYMENT.md`), and fails fast (non-zero exit,
      clear error) when a required variable is missing.
- [ ] `GATEWAY_ALLOW_DEV_DEFAULTS` is **not** set in whatever environment
      configuration will actually be deployed.

## 6. Smoke tests

- [ ] `GET /v1/health` against a running instance returns `200` with
      `status: "ok"` (or an explainable `"degraded"` if a provider
      credential intentionally isn't configured in the smoke-test
      environment).
- [ ] `POST /v1/execute` against a running instance, with a real
      configured API key, returns a `200` with a well-formed
      `ExecuteResponse`.
- [ ] `POST /v1/execute/stream` against a running instance returns a
      `text/event-stream` response terminating in a `done: true` chunk.
- [ ] `POST /v1/execute/pipeline` against a running instance, with a
      real configured API key and a 2-step pipeline, returns a `200`
      with a well-formed `PipelineResult` (added for v1.2 — see
      `apps/gateway-server/README.md`'s Public API section).
- [ ] A request with a missing/invalid API key returns the expected
      `401`/`CREDENTIAL_INVALID` error shape, not an unhandled exception.
- [ ] `examples/minimal-node-client`, `examples/streaming-client`, and
      `examples/pipeline-client` all run successfully against the
      deployed instance (this is Engineering Blueprint EM-5's own
      acceptance criterion, extended to the v1.2 pipeline endpoint:
      "external example client completes a real request against a
      deployed instance").

## 7. Tagging

- [ ] Version numbers for any package that changed are bumped via
      `pnpm version-packages` and committed.
- [ ] The platform release is tagged: `git tag -a vX.Y.Z -m "..."` (an
      annotated tag, not a lightweight one).
- [ ] The tag is pushed: `git push origin vX.Y.Z`.

## 8. Release notes

- [ ] A GitHub Release (or equivalent) is published against the tag,
      linking `CHANGELOG.md`'s entry for this version.
- [ ] `docs/release/RELEASE_NOTES.md` is linked from that release for
      the narrative, user-facing description.

## 9. Version verification

- [ ] `apps/gateway-server`'s deployed `/v1/health` response (or a
      dedicated version field, once one exists) is checked against the
      tag actually deployed — confirm you deployed what you tagged, not
      an intermediate commit.
- [ ] The deployed instance's environment variables match
      `docs/release/DEPLOYMENT.md`'s current table (no stale variable
      names left over from a prior release's server-config shape).

---

*This checklist is itself a release-governance artifact — update it
whenever a validation step, endpoint, or environment variable it
references changes, so the next release's checklist stays accurate.*
