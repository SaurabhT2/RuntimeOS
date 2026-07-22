# Troubleshooting Guide — AI Gateway (through v1.2)

This document is new as of the RR-1 Release Readiness Audit. Before this
pass, no file in this repository collected common build/run/deploy
failures in one place — an engineer following [`README.md`](../../README.md#getting-started),
[`DEPLOYMENT.md`](DEPLOYMENT.md), or [`DEPLOYMENT-VERCEL.md`](DEPLOYMENT-VERCEL.md)
had to reconstruct the fix from source or trial and error. This guide
does not restate configuration reference material already covered
elsewhere — it cross-references it — and it does not repeat
[`KNOWN_LIMITATIONS.md`](KNOWN_LIMITATIONS.md)'s content; a "known
limitation" is intended behavior, while everything below is a failure
mode with a fix.

## Install / build

### `pnpm install --frozen-lockfile` fails: `ERR_PNPM_OUTDATED_LOCKFILE`

This means `pnpm-lock.yaml` is out of date relative to one or more
`package.json` files in the workspace — most commonly after a
workspace member's dependencies changed (a new package added, a
dependency version bumped) without also running a plain `pnpm install`
to refresh the lockfile before committing.

- **If you're a new contributor cloning the repo** and this happens on
  a clean checkout, the checked-in lockfile itself is stale — report it
  (see [`CONTRIBUTING.md`](../../CONTRIBUTING.md)); as a local
  workaround, run `pnpm install` (without `--frozen-lockfile`) once to
  regenerate it, then continue with [`README.md`](../../README.md#getting-started)'s
  remaining steps.
- **If you just changed a `package.json` yourself** (added a
  dependency, bumped a version), run a plain `pnpm install` and commit
  the updated `pnpm-lock.yaml` alongside your `package.json` change.
- **In CI** ([`.github/workflows/ci.yml`](../../.github/workflows/ci.yml))
  and in `apps/vercel-adapter/vercel.json`'s `installCommand`, this
  command is intentionally frozen (no `--frozen-lockfile` fallback) —
  by design, an out-of-date lockfile should fail the build loudly
  rather than silently drift, so the fix is always to update and commit
  the lockfile, not to relax the command.

### `pnpm build` fails with `Cannot find module '@ai-gateway/...'`

This means the failing package's source imports a workspace package
that isn't declared in its own `package.json` `dependencies`. Turbo's
build ordering (`turbo.json`) only guarantees a package's *declared*
workspace dependencies build first — an undeclared import can appear to
work by accident (if the other package happened to build earlier for
unrelated reasons) and then break the moment build order changes.

- Check the failing package's `package.json` `dependencies` against
  every `@ai-gateway/*` import in its `src/`. Add any that are missing,
  then re-run `pnpm install` so the workspace symlinks exist, then
  `pnpm build` again.
- If the imports are coming from a file that doesn't appear anywhere in
  that package's actual entrypoint chain (i.e., nothing under `src/`
  that the package's `main`/`bin` transitively imports actually
  reaches it), it may be dead code left over from a prior refactor —
  confirm with `grep -rl` for the file's own exports across `src/` and
  `test/`, and if genuinely unreferenced, delete it and its tests
  rather than adding it as a dependency. (This exact situation — an
  orphaned pre-EM-5.5 `bootstrap.ts`/`http/**` set in
  `apps/gateway-server`, superseded by `@ai-gateway/gateway-runtime`
  per [ADR-0012](../adr/0012-shared-gateway-runtime-package.md) but
  never deleted — was found and fixed during this RR-1 pass; see the
  RR-1 audit report's "Validation performed" section.)

### `pnpm graph:check` reports a dependency-boundary violation

`dependency-cruiser` (`.dependency-cruiser.cjs`) enforces the
package-boundary rules from the Engineering Blueprint §4.1. A violation
means a package imports another package it isn't allowed to depend on
(e.g., a lower-layer package importing something from a
composition-root app). Fix the import direction rather than
suppressing the rule — see `.dependency-cruiser.cjs`'s own rule
comments for which direction is allowed for the specific packages
involved.

## Runtime — `apps/gateway-server`

### Server exits immediately with "Invalid configuration"

`server-config.ts` validates every environment variable before the
listener opens (`DEPLOYMENT.md`, "Environment variables") and this is
by design — it means a required or malformed value was caught before
any traffic could reach a half-configured process. The logged message
names the specific field; cross-reference it against
[`DEPLOYMENT.md`](DEPLOYMENT.md#environment-variables)'s table. The
most common cause is `GATEWAY_API_KEYS_JSON` being unset with
`GATEWAY_ALLOW_DEV_DEFAULTS` not set to `"true"` — for local
development only, set the latter; never in a reachable deployment.

### `GET /v1/health` returns `"unhealthy"` (503) right after startup

This means every registered provider adapter's `healthCheck` failed —
almost always because no credential is resolvable for any provider
yet. Confirm the environment variable named by
`GROQ_PLATFORM_API_KEY_ENV_VAR` / `NVIDIA_NIM_PLATFORM_API_KEY_ENV_VAR`
(default `GROQ_PLATFORM_API_KEY` / `NVIDIA_NIM_PLATFORM_API_KEY`) is
actually set in the process's environment, not just referenced by name.
`"degraded"` (still HTTP 200) instead of `"unhealthy"` means at least
one provider resolved successfully — see `DEPLOYMENT.md`'s "Health
endpoint" section for the full state meanings.

### `POST /v1/execute` returns `401`/`403`

Check the `Authorization: Bearer <key>` (or `x-api-key`) header against
one of the `apiKey` values in `GATEWAY_API_KEYS_JSON`, and confirm the
request's implied tenant matches a `tenant` entry in that same JSON —
see `apps/gateway-server/README.md`, "Public API," and
`DEPLOYMENT.md`'s `GATEWAY_API_KEYS_JSON` row.

### Budget Governance / a `GATEWAY_CONFIG_PATH` field I set has no effect

`apps/gateway-server`'s published binary cannot construct Budget
Governance from any environment variable or config file — this is not
a bug to work around but a documented gap. See
[`DEPLOYMENT.md`, "Budget Governance"](DEPLOYMENT.md#budget-governance-em-10-v12)
and [`KNOWN_LIMITATIONS.md` §9.3](KNOWN_LIMITATIONS.md#93-neither-deployment-application-has-a-configuration-surface-for-budget-governance)
for why, and for the one supported way to enable it (a custom
composition-root entrypoint).

## Runtime — `apps/vercel-adapter`

### Vercel build fails during install or build step

`vercel.json`'s `installCommand`/`buildCommand` both `cd ../..` to run
against the whole workspace root — if you changed **Root Directory**
away from `apps/vercel-adapter`, or overrode these commands in the
Vercel dashboard, restore them to the versioned `vercel.json` values.
See [`DEPLOYMENT-VERCEL.md`](DEPLOYMENT-VERCEL.md), "Vercel project
setup," steps 2–3. If the failure is specifically
`ERR_PNPM_OUTDATED_LOCKFILE`, see "Install / build" above — it applies
identically here since this command also runs `--frozen-lockfile`.

### Function times out on a long stream

`maxDuration: 60` in `vercel.json` is a placeholder — tune it to your
Vercel plan's limits and your orchestrator's worst-case retry/failover
duration. See `DEPLOYMENT-VERCEL.md`, "Streaming and request
cancellation."

## Runtime Studio (`apps/runtime-studio`)

### Studio starts but every panel shows a connection error

`GATEWAY_URL` must point at an already-running gateway
(`apps/gateway-server` or `apps/vercel-adapter`) — Runtime Studio is a
client, not a third deployment target, and starts up independently of
whether its target is reachable. Start or verify the target gateway
first (`DEPLOYMENT.md` / `DEPLOYMENT-VERCEL.md`), then confirm
`GATEWAY_URL`/`GATEWAY_API_KEY` in the Studio's own environment. See
`apps/runtime-studio/README.md`, "Running it locally."

### A panel says a capability isn't reachable, but I expected it to work

This is very likely correct, not a bug — see
`apps/runtime-studio/README.md`, "What this Studio will and won't
pretend," and `docs/release/RUNTIME_CONFIGURATION_MATRIX.md` for the
full, source-verified picture of what's configurable on which
deployment target.

## Tests

### `pnpm test` hangs or leaves an open handle

Check for a test that starts a real `node:http` listener
(`startTestServer`, `apps/gateway-server/test/test-server.ts`, or
equivalent) without calling its `close()` in an `afterEach`/`afterAll`.
Vitest's own `--reporter` output on a hang usually names the offending
file; if not, `vitest run --reporter=verbose` narrows it down.

### Coverage numbers don't match a package's README

Package READMEs' "Testing strategy" sections state coverage as of the
milestone that last touched that package — a small drift after a later
milestone's changes is expected and not itself a defect. If a package's
actual `pnpm test:coverage` output is *meaningfully* lower than its
README claims, that's a documentation-staleness bug in that README, not
a code defect — file it as a doc fix in that package.

## Where this guide stops

This is a first pass covering the failure modes actually reproduced or
identified during the RR-1 audit — not an exhaustive catalog. It
intentionally does not restate:

- Configuration reference (env vars, defaults) — see `DEPLOYMENT.md`,
  `DEPLOYMENT-VERCEL.md`, and each app's own README.
- Intentional platform limitations — see `KNOWN_LIMITATIONS.md`.
- What's configurable on which deployment target — see
  `RUNTIME_CONFIGURATION_MATRIX.md`.

If you hit a failure not covered here, the fastest path is usually the
relevant package's own README ("Deferred work" / "Engineering
decisions" sections) and its test suite, which is the actual source of
truth for behavior this guide only summarizes.
