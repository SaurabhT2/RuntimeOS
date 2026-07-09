# AI Gateway — minimal Node.js client

The smallest possible external client for a deployed AI Gateway instance:
one `fetch` call to `POST /v1/execute`, no `@ai-gateway/*` dependency, no
build step. This is architecture §9's `examples/minimal-node-client` and
this milestone (EM-5)'s own named deliverable — "a minimal example client"
demonstrating "standard execution" against a real, deployed
`apps/gateway-server` instance.

## Running it

```bash
# Start a gateway instance first (see apps/gateway-server's README), then:
GATEWAY_URL=http://localhost:3000 \
GATEWAY_API_KEY=your-key \
node src/index.mjs
```

Or, from the repo root: `pnpm --filter ai-gateway-example-minimal-node-client start`.

## What it demonstrates

- Authenticating with a gateway API key (`Authorization: Bearer <key>`).
- Sending a well-formed `ExecuteRequest` (`task`, `input.text`, `tenant`).
- Reading a successful `ExecuteResponse`'s `output`/`execution`/`usage` fields.
- Handling a non-2xx response as a `GatewayError` JSON body
  (`{ error: { code, message, retryable, details } }`), the same shape
  every gateway error takes regardless of which layer produced it.

## What it deliberately does not demonstrate

- Streaming (`/v1/execute/stream`) — see the sibling `streaming-client`
  example for that.
- Retry/backoff on the client side — a production client would likely
  add its own retry loop around `RATE_LIMITED`/`TIMEOUT` responses using
  the `retry-after` header this gateway returns for `RATE_LIMITED`; this
  example keeps that out to stay minimal, as its name promises.
