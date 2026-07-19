# @ai-gateway/core-contracts

Public request/response/error contracts for AI Gateway. **Zero internal
dependencies** — this is the one package every other package, and every
external SDK consumer, depends on (architecture §9).

Status: **`1.0.0`**, frozen per EM-0's acceptance criteria (Engineering
Blueprint §3.7, §7). Changes to any exported type require an ADR
(`docs/adr/`), following the same process used for architecture-level
contract changes (Blueprint §6.3; architecture §28/§39/§46).

## What's here

| File             | Exports                                                                           | Architecture reference |
| ---------------- | --------------------------------------------------------------------------------- | ---------------------- |
| `task.ts`        | `TaskType`, `KNOWN_TASK_TYPES`, `isKnownTaskType`, `taskTypeSchema`               | §10.3                  |
| `json-schema.ts` | `JSONSchema`, `jsonSchemaSchema`                                                  | §10.3, §12.2           |
| `request.ts`     | `ExecuteRequest`, `ChatMessage`, `executeRequestSchema`, `chatMessageSchema`      | §10.3                  |
| `response.ts`    | `ExecuteResponse`, `ToolCall`, `FinishReason`, and their schemas                  | §10.4                  |
| `streaming.ts`   | `StreamChunk`, `streamChunkSchema`                                                | §10.4, §12.1           |
| `errors.ts`      | `GatewayError`, `GatewayErrorCode`, `isGatewayError`, `gatewayErrorPayloadSchema` | §10.5, §19             |

Every type has a companion [Zod](https://zod.dev) schema so callers — and,
critically, the test suite here — can validate a value at a trust boundary
(an incoming HTTP request body, a provider adapter's translated response)
rather than trusting a TypeScript type that erases at runtime.

## Design notes worth knowing before you extend this package

- **No field ever accepts a provider or model name from the caller**
  (architecture §10.1). If you're tempted to add one, it belongs in
  `model-registry` or `policy-engine`, not here.
- **`TaskType` is intentionally not a closed enum.** `KNOWN_TASK_TYPES` lists
  the task types the gateway ships routing support for, but the wire type
  accepts any non-empty string, because deployments can register custom task
  types via `GatewayConfig` (architecture §10.6) without a `core-contracts`
  release. `isKnownTaskType` returning `false` is not an error signal.
- **`JSONSchema` is deliberately a permissive structural type**, not a full
  JSON-Schema-draft implementation. `core-contracts` only carries the schema
  from caller → Policy Engine → provider adapter; interpreting it is the
  provider adapter's job (architecture §12.1).
- **`GatewayError` is the only error type callers ever see.** A raw
  provider SDK error must never escape the adapter boundary — this is
  enforced by `tools/adapter-conformance-tests`, not by this package, but
  this package is what makes that enforcement possible by giving every
  adapter one shape to translate into.

## Usage

```ts
import {
  executeRequestSchema,
  GatewayError,
  type ExecuteRequest,
} from "@ai-gateway/core-contracts";

function handleIncomingRequest(body: unknown): ExecuteRequest {
  const result = executeRequestSchema.safeParse(body);
  if (!result.success) {
    throw new GatewayError("INVALID_SCHEMA", "request body failed validation", false, {
      issues: result.error.issues,
    });
  }
  return result.data;
}
```

## Scripts

```bash
pnpm --filter @ai-gateway/core-contracts build       # tsc -> dist/
pnpm --filter @ai-gateway/core-contracts typecheck
pnpm --filter @ai-gateway/core-contracts test         # vitest run
pnpm --filter @ai-gateway/core-contracts test:coverage
```

## Testing strategy

Per EM-0's acceptance criteria: **every exported schema is validated against
at least one hand-written (not schema-generated) JSON fixture**, plus
negative cases proving the schema actually rejects malformed input rather
than accepting everything. See `test/em0-acceptance.test.ts` for the single
place that ties every exported wire schema to its fixture, and
`test/fixtures/*.json` for the fixtures themselves.
