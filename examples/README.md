# examples/

Example clients demonstrating AI Gateway's public REST API against a
running `apps/gateway-server` instance (architecture §9). Populated at
EM-5 (per Blueprint §7/§19 step 16), with `pipeline-client/` added during
the v1.2 documentation pass to cover EM-10's `POST /v1/execute/pipeline`
endpoint, which previously had no example client despite being documented
in `apps/gateway-server/README.md`.

- **`minimal-node-client/`** — the smallest possible client: one `fetch`
  call to `POST /v1/execute`, no `@ai-gateway/*` dependency.
- **`streaming-client/`** — reads and parses `POST /v1/execute/stream`'s
  Server-Sent-Events response incrementally, also with no
  `@ai-gateway/*` dependency.
- **`pipeline-client/`** — runs a 2-step `POST /v1/execute/pipeline`
  call, one step's output feeding the next via `inputFrom`, also with no
  `@ai-gateway/*` dependency.

None of the three examples demonstrates the Strategy Layer or Budget
Governance directly — both apply transparently to any request/step
regardless of which endpoint reaches them, and both are operator-side
configuration a client has no visibility into. See
`docs/release/DEPLOYMENT.md`'s "Strategy Layer" and "Budget Governance"
sections for how an operator configures either.

No example imports any workspace package — all three are written exactly
as an external, non-monorepo caller would write them, using only the
public HTTP contract.
