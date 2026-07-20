# RuntimeOS Reference Playground (`runtime-studio`)

A browser-based reference client for a **running** AI Gateway instance —
the official onboarding surface, integration reference, and engineering
validation tool for RuntimeOS. Every screen talks to a real, deployed
gateway over its public HTTP API; nothing is mocked, hardcoded, or
simulated. Where a capability exists in RuntimeOS but isn't reachable
through the deployment you're pointed at (Budget Governance
configuration, today, on both `apps/gateway-server` and
`apps/vercel-adapter`), the Studio says so plainly instead of pretending
otherwise — see ["What this Studio will and won't
pretend"](#what-this-studio-will-and-wont-pretend), below.

## What this is (and isn't)

This is a **client**, not a third deployment application. It has no
workspace dependency on `@ai-gateway/gateway-runtime` or any platform
package — like `examples/*`, it only ever calls the public REST API
(`POST /v1/execute`, `POST /v1/execute/stream`, `POST /v1/execute/pipeline`,
`GET /v1/health`), exactly as any external integrator would. Point it at
any running gateway — your own `apps/gateway-server`, an
`apps/vercel-adapter` deployment, or a custom composition root — and it
works identically, because it never assumes anything beyond that public
contract.

It is not a load-testing tool, not a production dashboard, and not a
substitute for reading `docs/architecture/architecture-spec.md`. It's a
teaching and validation surface: every panel explains what it does, why
it exists, and when to reach for it, alongside the real request/response
it just sent.

## Why a server-side proxy, not a pure static site

`runtime-studio` ships a small Node/TypeScript server
(`src/server.ts`) alongside its static frontend (`public/`), for one
reason: **the target gateway's API key never reaches the browser.**
`STUDIO_...` requests hit this server, which injects
`Authorization: Bearer $GATEWAY_API_KEY` server-side before forwarding
to `$GATEWAY_URL`, and streams the response straight back — see
`src/proxy.ts`. A pure static site would have to embed the key in
client-side JavaScript, visible to anyone who opens the browser's
network tab. This is the same reasoning `apps/gateway-server` and
`apps/vercel-adapter` apply to *their* upstream provider credentials,
applied one layer further out.

## Architecture

```
┌──────────────┐   /studio-api/*   ┌──────────────────┐   /v1/*  (+ injected      ┌─────────────────┐
│   Browser    │ ─────────────────▶│  runtime-studio   │   Authorization header)  │  Target gateway  │
│ (public/*.js)│                   │   src/server.ts   │ ────────────────────────▶│ (any deployment) │
│              │◀───────────────── │  (proxy + static) │◀──────────────────────── │                  │
└──────────────┘   JSON / SSE      └──────────────────┘   JSON / SSE              └─────────────────┘
```

The four proxy routes (`src/server.ts`'s `PROXY_ROUTES`) map 1:1 onto
the four routes `packages/gateway-runtime/src/dispatch.ts` registers —
nothing else is forwarded, because nothing else exists to forward to.
For the request path *inside* the target gateway once a call reaches
it, see the root repository's own `README.md`, "Platform architecture
at a glance" — this Studio's Architecture panel renders that same,
verified path as an SVG diagram rather than duplicating it as a second,
independently-drifting description.

## Running it locally

```bash
cd apps/runtime-studio
pnpm build
GATEWAY_URL=http://localhost:3000 \
GATEWAY_API_KEY=your-gateway-api-key \
pnpm start
# Studio listening on http://localhost:4000 by default
```

You need a real gateway running first — see the root repository's
`docs/release/DEPLOYMENT.md` (or `DEPLOYMENT-VERCEL.md`) for how to
start one, and `apps/gateway-server/README.md` for how to configure an
API key on it (`GATEWAY_API_KEYS_JSON`, or
`GATEWAY_ALLOW_DEV_DEFAULTS=true` for local development only).

### Environment variables

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `GATEWAY_URL` | Yes | — | The target gateway's base URL, e.g. `http://localhost:3000`. |
| `GATEWAY_API_KEY` | Yes | — | The API key this Studio authenticates to `GATEWAY_URL` with, server-side only. |
| `STUDIO_HOST` | No | `0.0.0.0` | Host this Studio's own server binds to. |
| `STUDIO_PORT` | No | `4000` | Port this Studio's own server listens on. |
| `STUDIO_ACCESS_KEY` | No | unset | If set, every `/studio-api/*` request must send it as `x-studio-key`. See "Deployment and access control," below. |

### Deployment and access control

This Studio has **no authentication of its own by default** — anyone
who can reach `STUDIO_PORT` can use it to call the target gateway with
your `GATEWAY_API_KEY`. That's an appropriate default for local
development (`localhost` only), but **before exposing this anywhere
reachable by anyone other than you, set `STUDIO_ACCESS_KEY`** and put
this behind your own access control (a VPN, an internal load balancer
rule, etc.) — this app doesn't attempt to be a general-purpose
auth/authorization system, only a minimal shared-secret gate.

## Folder structure

```
apps/runtime-studio/
  src/                    the proxy + static server (TypeScript, built with tsc)
    index.ts                process entrypoint — mirrors apps/gateway-server/src/index.ts's shape
    server.ts                route table: /studio-api/* → proxy, everything else → static
    proxy.ts                  the one place this app calls a real gateway (server-side auth injection, SSE passthrough)
    static.ts                  serves public/, path-traversal-safe, falls back to index.html for client routing
    studio-config.ts            environment-variable loader, fails fast on invalid config
  test/                   real tests (vitest) for the two safety-relevant modules — config validation and path-traversal protection
  public/                 the browser client — no build step, no framework, ES modules loaded directly
    index.html               app shell: topbar + sidebar + workspace containers
    styles.css                 the one stylesheet
    app.js                      router (hash-based) + sidebar + health polling
    shared.js                    DOM helpers, the API client every panel uses, request-history persistence
    panels/                    one file per sidebar item — see below
```

### The ten panels (`public/panels/`)

| File | Sidebar item | Real API it calls | Honesty notes |
|---|---|---|---|
| `execute.js` | Execute | `POST /v1/execute` | — |
| `streaming.js` | Streaming | `POST /v1/execute/stream` | No "reconnect" — `StreamChunk` has no resume cursor, so this panel says so instead of faking one. |
| `pipeline.js` | Pipeline | `POST /v1/execute/pipeline` | Correctly distinguishes a failed step's flat `GatewayError` shape from a successful step's `ExecuteResponse` — see `apps/gateway-server/README.md`. |
| `runtime-profiles.js` | Runtime Profiles | *(none — informational only)* | Deliberately non-interactive: there's no per-request field or introspection endpoint for this; it's deployment-wide config. |
| `execution-profiles.js` | Execution Profiles | `POST /v1/execute` (with `preferences.executionProfileOverride`) | States plainly that this field only has any effect when the target has `ENABLE_STRATEGY_LAYER=true`, and that an unresolvable ID fails the request rather than silently falling back. |
| `strategy-layer.js` | Strategy Layer | `POST /v1/execute` (as a probe) | No fake ON/OFF toggle — includes a table of what routing information the API does and doesn't expose (most of what a naive implementation might show — "routing reasoning," "strategy selected" — isn't real). |
| `budget-governance.js` | Budget Governance | `POST /v1/execute` (as a probe) | Leads with the real, current gap: neither deployment app exposes this configuration at all. A `402 BUDGET_EXCEEDED` response, if one ever comes back, is genuinely surfaced — not simulated. |
| `telemetry.js` | Telemetry | *(reads Request History only)* | Explicitly lists the two fields a naive telemetry panel might show that the API doesn't actually return (effective Runtime/Execution Profile, per-middleware timing breakdown). |
| `history.js` | Request History | *(local only — replay re-calls the real API)* | — |
| `architecture.js` | Architecture | *(reads Request History for pacing only)* | The "replay" animation is explicitly labeled as illustrative pacing (one real number spread evenly across stages), not measured per-stage telemetry, because the API doesn't report that. |

## What this Studio will and won't pretend

This section exists because the brief for this application specifically
required it, and because it's the single most important thing to
understand before trusting anything this Studio shows you:

- **It will never show you a capability working that isn't actually
  reachable on your target deployment.** Runtime Profiles and Budget
  Governance are the two clearest examples — see their panels' own
  notices, and `docs/release/RUNTIME_CONFIGURATION_MATRIX.md` in the
  root repository for the full, source-verified picture of what's
  configurable where.
- **It will never invent a response field the API doesn't return.**
  Strategy Layer "routing reasoning," an "effective Execution Profile"
  readout, and per-middleware timing are the clearest examples — each
  panel says explicitly what's real vs. not, rather than silently
  omitting the caveat.
- **It will always show you the real, raw request and response** for
  anything it sends — every result card includes the actual JSON, not a
  formatted summary standing in for it.

## Extension points

This Studio is built to grow alongside RuntimeOS, not to be rewritten
each time:

- **A new capability with a real API surface** (e.g. a future
  `GET /v1/tasks` or `POST|DELETE /v1/credentials`, both currently
  deferred per `apps/gateway-server/README.md`'s "Scope verification")
  → add its path to `src/server.ts`'s `PROXY_ROUTES`, and a new file
  under `public/panels/`, registered in `public/app.js`'s `PANELS`
  array. Every existing panel is a template for the shape (a `render(root)`
  function, the shared `shared.js` API client, a result card showing raw
  JSON).
- **A capability that becomes configurable through a deployment app**
  (e.g. when `docs/backlog/expose-complete-gatewayruntimeconfig-surface.md`
  ships) → the relevant panel (`budget-governance.js`,
  `runtime-profiles.js`) already has the honest "not exposed" framing
  isolated in one `notice(...)` call each; flipping it to a real,
  interactive control is a contained change, not a rewrite.
- **A new provider or model class** requires no Studio change at all —
  every panel already renders `execution.providerId`/`modelClass`
  generically, whatever the target gateway returns.

## What's deliberately not built yet

Honest about the gaps, not silent about them:

- **No automated screenshot/GIF generation** in this repository — the
  brief asked for these as a deliverable; producing them requires
  actually running this Studio against a live gateway with real
  provider credentials, which isn't something this pass could do inside
  a sandboxed environment with no live LLM provider access. The
  end-to-end test suite (see "Testing," below) is this pass's
  substitute evidence that the application genuinely works.
- **No visual regression or component test suite for `public/*.js`** —
  the frontend is tested end-to-end (see below), not unit-by-unit; a
  DOM-testing setup (jsdom + a component-test runner) is a reasonable
  follow-up, not included here to avoid adding a testing dependency
  beyond what the rest of this monorepo already uses.

## Testing

`test/*.test.ts` (vitest) covers the two safety-relevant server modules
directly: `studio-config.ts`'s validation (every required/invalid-input
case) and `static.ts`'s path-traversal protection. Run with `pnpm test`.

Beyond that, this application was validated with a genuine end-to-end
smoke test during development: a real fake-gateway process (mimicking
the actual wire shapes from `core-contracts`) plus a real, spawned
`runtime-studio` server, driven with real `fetch` calls covering static
serving, path-traversal rejection, and all four proxy routes — including
asserting the SSE response actually arrives as three separate frames and
that `GATEWAY_API_KEY` never appears anywhere in a client-visible
response. That script isn't checked into this package (it's a
development-time verification artifact, not a maintained test), but its
coverage is a reasonable template for anyone adding a proper e2e suite
here later.
