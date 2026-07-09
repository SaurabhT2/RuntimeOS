# @ai-gateway/config

**Status:** implemented (EM-1). Zod-validated, hot-reloadable `GatewayConfig`
loader (architecture §10.6; Blueprint §8.2).

## Public API

- `gatewayConfigSchema` — the Zod schema for `GatewayConfig`.
- `DEFAULT_GATEWAY_CONFIG` — sane defaults, fully override-able.
- `loadConfig(source)` — loads and validates a `GatewayConfig` once.
- `watchConfig(source, onChange, onError?)` — loads once, then re-validates
  on every underlying source change, invoking `onChange` only when the
  validated config actually differs from the last-known-good value, and
  `onError` (never a thrown/unhandled rejection) when a reload is invalid.
  Returns a `ConfigWatchHandle` with `.current` and `.close()`.
- `ConfigSource` implementations: `EnvConfigSource` (single JSON env var, no
  hot-reload — env vars are fixed for a process's lifetime), `FileConfigSource`
  (JSON file on disk, hot-reload via `fs.watch`), `InMemoryConfigSource`
  (test/embedding helper, hot-reload via `.set()`).
- `ConfigError` — thrown for unreadable sources or schema-validation failures.

## Usage example

```ts
import { loadConfig, watchConfig, FileConfigSource } from "@ai-gateway/config";

const source = new FileConfigSource("/etc/ai-gateway/config.json");
const config = await loadConfig(source); // one-shot

const handle = await watchConfig(
  source,
  (next) => console.log("config changed", next),
  (err) => console.error("rejected a bad reload", err),
);
// ... later
handle.close();
```

## Extension points

A DB-row-backed `ConfigSource` (or Vault/cloud-secret-manager-backed) is an
additive implementation of the same interface — no change to `loadConfig`,
`watchConfig`, or any consumer required (Blueprint §8.2 "Extension points").
Not built in EM-1: no DB dependency exists yet in the dependency graph
(Section 4.1). `config`'s only internal dependency is
`@ai-gateway/core-contracts` (see "Dependencies" below); it does not depend
on any other internal package.

`GatewayConfig.routing.perTaskOverrides` and the scoring weights it feeds are
read, not interpreted, here — `policy-engine` (Wave 3) is the sole
consumer/interpreter of routing configuration.

## Dependencies

- `@ai-gateway/core-contracts` (for `TaskType`, used only as a key type in
  `perTaskOverrides`)
- `zod`

## Architecture reference

§10.6

## Testing strategy

Schema validation tests for valid/invalid configs (`test/schema.test.ts`);
`ConfigSource` implementation tests including a hot-reload test per source
(`test/sources.test.ts`); a `watchConfig` test asserting the change
notification fires exactly once per actual change, not per underlying
source event, and that invalid reloads surface via `onError` without
corrupting `.current` (`test/loader.test.ts`).
