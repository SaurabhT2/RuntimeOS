# examples/

Example clients demonstrating AI Gateway's public REST API against a
running `apps/gateway-server` instance (architecture §9). Populated at
EM-5, per Blueprint §7/§19 step 16.

- **`minimal-node-client/`** — the smallest possible client: one `fetch`
  call to `POST /v1/execute`, no `@ai-gateway/*` dependency.
- **`streaming-client/`** — reads and parses `POST /v1/execute/stream`'s
  Server-Sent-Events response incrementally, also with no
  `@ai-gateway/*` dependency.

Neither example imports any workspace package — both are written exactly
as an external, non-monorepo caller would write them, using only the
public HTTP contract.
