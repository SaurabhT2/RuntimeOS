# AI Gateway — streaming Node.js client

A minimal external client for `/v1/execute/stream`, AI Gateway's
Server-Sent-Events endpoint (architecture §9's `examples/streaming-client`).
No `@ai-gateway/*` dependency, no SSE library — this parses the
`data: {json}\n\n` wire format directly, the same format any HTTP client or
browser `EventSource` would receive.

## Running it

```bash
GATEWAY_URL=http://localhost:3000 \
GATEWAY_API_KEY=your-key \
node src/index.mjs
```

Or, from the repo root: `pnpm --filter ai-gateway-example-streaming-client start`.

## What it demonstrates

- Reading a chunked SSE response body incrementally (`response.body.getReader()`),
  never buffering the whole response before printing anything.
- Splitting on the SSE frame delimiter (`\n\n`) across chunk boundaries —
  a single `data:` frame can arrive split across more than one network read.
- Distinguishing a normal `StreamChunk` (`{ requestId, delta, done, finishReason? }`)
  from the one case where the stream ends in an error frame
  (`{ error: GatewayError }`) instead — this only happens if the failure
  occurs _after_ the SSE response has already started (headers already
  sent), per `apps/gateway-server`'s own documented behavior.
