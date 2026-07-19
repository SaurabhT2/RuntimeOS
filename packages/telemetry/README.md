# @ai-gateway/telemetry

**Status:** implemented (EM-1). Wraps OpenTelemetry (tracing, metrics) and
structured logging behind the single `Telemetry` interface every other
package depends on (architecture §21, §11; Blueprint §8.3).

## Public API

- `Telemetry` — `startSpan(name, attrs?)`, `recordMetric(name, value, labels?)`,
  `log(level, msg, fields?)` (architecture §11, unchanged).
- `createTelemetry(options?)` — constructs the default `Telemetry`
  implementation. `options.instrumentationName` names the OTel
  tracer/meter; `options.logSink` overrides where log lines are written
  (defaults to stdout via `ConsoleLogSink`).
- `Span` — re-exported from `@opentelemetry/api`; every span returned by
  `startSpan` is guaranteed to close with an explicit status (`OK` by
  default if the caller never calls `setStatus`) once `end()` is called.
- `renderLogLine(level, message, fields?)` — pure function producing one
  JSON log line matching the fixed core schema (`timestamp`, `level`,
  `requestId`, `traceId`, `tenant`, `message`, `...context`).

## Design notes

This package does **not** register an OTel `TracerProvider`/`MeterProvider`
or any exporter. `@opentelemetry/api`'s global-registration pattern means
every span/metric produced here is a correct, inert no-op until a real SDK
provider is registered — and that registration is the composition root's
job (`apps/gateway-server/src/bootstrap.ts`, Blueprint §6.4, built in EM-5),
never this package's. This is what makes exporters "swappable via OTel's
own exporter configuration, never via code changes in this package"
(Blueprint §8.3) literally true, and keeps this package fully testable and
usable standalone today.

## Usage example

```ts
import { createTelemetry } from "@ai-gateway/telemetry";

const telemetry = createTelemetry({ instrumentationName: "@ai-gateway/orchestrator" });

const span = telemetry.startSpan("execute-request", { task: "summarization" });
try {
  telemetry.log("info", "request accepted", { requestId: "req-1" });
  telemetry.recordMetric("gateway_request_duration_ms", 87, { task: "summarization" });
} finally {
  span.end(); // closes with status OK unless setStatus was called first
}
```

## Dependencies

- `@ai-gateway/core-contracts`
- `@opentelemetry/api`

## Architecture reference

§21

## Testing strategy

Unit tests assert every span closes with a status (verified against a real
in-memory OTel span exporter registered only in tests — `test/tracer.test.ts`),
every metric call is forwarded to a real OTel histogram instrument without
throwing (`test/metrics.test.ts`), and every log line conforms to the fixed
schema (`test/logger.test.ts`). No assertions are made on exporter/backend
behavior itself — that is OTel's own tested responsibility (Blueprint §8.3).
