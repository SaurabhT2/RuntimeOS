# AI Gateway — pipeline client

An external client demonstrating AI Gateway's `POST /v1/execute/pipeline`
endpoint (v1.2, EM-10; architecture §41.3): running a sequence of steps
through the gateway in a single call, with a later step consuming an
earlier step's output. Like `examples/minimal-node-client` and
`examples/streaming-client`, this has **no** `@ai-gateway/*` dependency
and no build step — it's exactly what an external, non-monorepo caller
would write against a deployed instance.

## Running it

```bash
# Start a gateway instance first (see apps/gateway-server's README), then:
GATEWAY_URL=http://localhost:3000 \
GATEWAY_API_KEY=your-key \
node src/index.mjs
```

Or, from the repo root: `pnpm --filter ai-gateway-example-pipeline-client start`.

## What it demonstrates

- A 2-step pipeline where step 2's input comes from step 1's output via
  `inputFrom` (rather than a literal `input`, which step 1 uses).
- Reading `PipelineResult`'s `stepResults` map, `totalCostUsd`, and
  `durationMs`.
- How a failed or skipped step actually appears in `stepResults`: a
  serialized `GatewayError` — a flat `{ name, code, message, retryable,
details }` object, **not** nested under an `.error` key the way a
  top-level request failure's response body is. This example's step-result
  handling discriminates on the presence of a `code` field for exactly
  this reason (an `ExecuteResponse` never has one).

## What it deliberately does not demonstrate

- **Budget Governance.** Nothing about this example changes if the
  gateway you're calling has Budget Governance configured — budget
  enforcement, where present, applies transparently per step, the same
  as it would to an equivalent standalone `POST /v1/execute` call. See
  `docs/release/DEPLOYMENT.md`'s "Budget Governance" section for how an
  operator enables it (it is **not** configurable via any environment
  variable on the standard `apps/gateway-server` binary — see
  `docs/release/KNOWN_LIMITATIONS.md` §9.3).
- **The Strategy Layer.** Same story — `ENABLE_STRATEGY_LAYER` is an
  operator-side setting this client has no visibility into or control
  over; each pipeline step is routed exactly as a standalone
  `POST /v1/execute` call to the same `task` would be.
- **Required steps and failure handling beyond the basics.** A step
  defaults to `required: true`; a required step's failure stops the
  pipeline (later steps that would have depended on it are simply
  absent from `stepResults`, not present with an error). This example
  doesn't construct a failing step on purpose — see
  `apps/gateway-server/README.md`'s `POST /v1/execute/pipeline` section
  for the full contract, including `required: false`.
- **The step cap.** Pipelines are capped at `maxPipelineSteps` (20 by
  default) before any step runs — irrelevant at this example's 2-step
  scale, but worth knowing if you extend it.
