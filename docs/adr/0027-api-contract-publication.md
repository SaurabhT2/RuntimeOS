# ADR-0027: API Contract Publication — generate OpenAPI from `core-contracts`' Zod schemas, don't hand-write it

**Status:** Proposed (roadmap recommendation — raised during the v1.2 documentation-completion pass; not yet decided by the Architecture Review Board, and not itself an implementation)
**Date:** 2026-07-19
**Format:** Context / Decision / Consequences / Alternatives

> **Note on this draft:** unlike most other Proposed ADRs in this
> directory, this one was not raised by an engineering milestone
> discovering a spec-vs-implementation inconsistency — it's a
> forward-looking recommendation, raised because Phase 6 of the v1.2
> documentation-completion pass repeatedly found that "no OpenAPI schema
> exists" is the single most common adoption-friction item newcomers
> would hit (see `README.md`'s Roadmap and
> `docs/release/KNOWN_LIMITATIONS.md`), and a recommendation with no
> record of *how* it should be built, if undertaken, risks becoming a
> hand-maintained artifact that drifts from `core-contracts` the same
> way this pass found several other documents had drifted from source.
> Filed as an ADR rather than left as a bare roadmap bullet so that,
> whenever this work is picked up, the "generate, don't hand-write"
> constraint below is already on record rather than re-litigated.

## Context

Architecture §10 does not mandate an OpenAPI schema for v1.0, and no
milestone through EM-11 has picked it up — `apps/gateway-server`'s
Public API is fully specified only in prose (that app's own README) and
in the `core-contracts` types/Zod schemas every request and response is
validated against. This is a real, disclosed adoption-friction gap (see
`README.md`'s Product Readiness discussion): a newcomer wanting
generated client code, API-explorer tooling (e.g. Swagger UI), or
contract-testing integration currently has nothing to point such tooling
at.

`core-contracts` is the right foundation for this, not a reason to defer
it further: every public type (`ExecuteRequest`, `ExecuteResponse`,
`GatewayError`, and, as of v1.2, the pipeline request/response shapes in
`packages/gateway-runtime/src/http/validate-pipeline-request.ts`) already
has a companion Zod schema used for real request/response validation at
the trust boundary (this repository's own architecture principle — see
`core-contracts`' own README). Zod schemas can be mechanically converted
to JSON Schema (and from there, an OpenAPI document) by existing,
widely-used tooling (e.g. `zod-to-json-schema` or Zod 4's native
`z.toJSONSchema()`) — this ADR does not mandate a specific library, that
choice is implementation detail for whoever picks this up, but it does
mandate the *shape* of the pipeline: generation from an existing,
already-validated source of truth, not a hand-authored parallel document.

## Decision

**If and when this work is undertaken, OpenAPI publication must follow
this pipeline:**

```
Core Contracts (packages/core-contracts' TypeScript types)
    ↓
Zod Schemas (the same schemas already used for request/response
             validation at the trust boundary — not a second,
             OpenAPI-specific schema definition)
    ↓
Generated OpenAPI (produced by a build step, committed or published
                    as a build artifact — never edited by hand)
```

**The OpenAPI document must never become a manually maintained
artifact.** Specifically:

- No hand-written `.yaml`/`.json` OpenAPI file should ever be committed
  as the source of truth. If a generation step produces a file that is
  then committed (for consumers who want a static artifact rather than a
  build step), that file must be regenerated and diffed in CI on every
  change to `core-contracts` or `gateway-runtime`'s HTTP routes, the same
  discipline `.dependency-cruiser.cjs` already applies to the package
  dependency graph.
- The generation step should cover every route registered in
  `packages/gateway-runtime/src/dispatch.ts` (`POST /v1/execute`,
  `POST /v1/execute/stream`, `POST /v1/execute/pipeline`,
  `GET /v1/health`) plus the deferred routes named in
  `apps/gateway-server/README.md`'s "Scope verification" section, marked
  absent rather than guessed at.
- Streaming (`POST /v1/execute/stream`'s Server-Sent-Events response) is
  a known OpenAPI-representation gap industry-wide (OpenAPI 3.x has no
  first-class SSE construct) — whoever implements this should document
  how that endpoint is represented (e.g. as a `text/event-stream`
  response with a documented event-shape comment) rather than silently
  omitting it or misrepresenting it as a normal JSON response.

This ADR does not pick a specific tool, CI wiring, or output location —
that remains an implementation decision for whoever picks up the work,
consistent with this ADR's own scope (a roadmap recommendation, not an
implementation).

## Consequences

- Closes a real, named product-readiness gap (see `README.md`'s Roadmap,
  "near-term" section) without introducing a second, independently
  drifting description of the API — the exact failure mode this v1.2
  documentation pass spent most of its effort correcting elsewhere
  (`CHANGELOG.md`, `RELEASE_NOTES.md`, and `KNOWN_LIMITATIONS.md` all
  describing Budget Governance's actual default incorrectly, discovered
  and fixed during this same pass). A generated artifact cannot drift
  from `core-contracts` in the way a hand-written one already has for
  the plain-English API documentation in `apps/gateway-server/README.md`
  (which this pass found was simply missing the pipeline endpoint
  entirely until corrected).
- Adds a new CI-gated build step, following the pattern
  `pnpm graph:check`/`pnpm typecheck`/`pnpm lint` already establish for
  "verify a derived artifact stays in sync with its source" checks.
- Unblocks SDK generation (see `README.md`'s Roadmap, "TypeScript and
  Python SDK support") — a generated OpenAPI document is the natural
  input for standard client-generator tooling, rather than either
  language's SDK needing its own hand-maintained request/response
  shapes.

## Alternatives considered

- **Hand-write an OpenAPI document now, as a documentation-only
  deliverable, without waiting for a generation pipeline.** Rejected:
  this is exactly the anti-pattern this ADR exists to prevent — a
  hand-written OpenAPI document has no mechanism keeping it in sync with
  `core-contracts`, and this pass found multiple examples elsewhere in
  this repository of hand-maintained descriptions of the API silently
  falling behind the implementation (the pipeline endpoint missing from
  `apps/gateway-server/README.md`'s Public API section until this pass;
  three release documents overstating Budget Governance's actual
  default). A hand-written OpenAPI document is a higher-stakes version of
  the same risk, since it would likely be consumed by automated tooling
  (client generators, API explorers) rather than only read by a human who
  might independently notice a discrepancy.
- **Defer this entirely and treat "no OpenAPI" as a permanent,
  acceptable limitation, since architecture §10 never mandated one for
  v1.0.** Rejected as the default going forward, though it remains the
  status quo until this ADR is acted on: the absence is a real,
  named adoption-friction cost (see `README.md`'s Product Readiness
  discussion), and the API surface (four endpoints as of v1.2, up from
  three at v1.0) is stable enough that a generation pipeline built now is
  unlikely to be immediately obsoleted by further growth.
- **Build a from-scratch OpenAPI generator specific to this repository's
  types, rather than adopting an existing Zod-to-JSON-Schema library.**
  Rejected as the default recommendation: existing, maintained tooling
  for this exact conversion already exists and is widely used elsewhere;
  a from-scratch generator would be new engineering surface to maintain
  for a well-solved problem, with no RuntimeOS-specific reason to need
  one. Whoever implements this should still evaluate current tooling at
  that time rather than treat this ADR's non-specific recommendation as
  binding on tool choice.
