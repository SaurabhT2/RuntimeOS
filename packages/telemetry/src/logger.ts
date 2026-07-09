import type { LogLevel } from "./types.js";

/** Where a rendered log line is written. Swappable for tests and for non-stdout sinks. */
export interface LogSink {
  write(line: string): void;
}

/** Default sink: one JSON line per `console.log` call (architecture §21.4: "one event per line"). */
export class ConsoleLogSink implements LogSink {
  write(line: string): void {
    console.log(line);
  }
}

const CORE_FIELD_KEYS = ["requestId", "traceId", "tenant"] as const;

/**
 * Renders one structured log line matching the fixed core schema
 * (architecture §21.4): `timestamp`, `level`, `requestId`, `traceId`,
 * `tenant`, `message`, then any remaining fields spread as additional
 * context. `requestId`/`traceId`/`tenant` are always present as explicit
 * keys (possibly `undefined`... omitted, see below) rather than buried in
 * context, so every log pipeline can rely on a single, fixed top-level
 * shape regardless of which fields a given call site provided.
 */
export function renderLogLine(
  level: LogLevel,
  message: string,
  fields?: Record<string, unknown>,
): string {
  const { requestId, traceId, tenant, ...context } = fields ?? {};
  const line: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };
  for (const key of CORE_FIELD_KEYS) {
    const value = { requestId, traceId, tenant }[key];
    if (value !== undefined) line[key] = value;
  }
  if (Object.keys(context).length > 0) {
    Object.assign(line, context);
  }
  return JSON.stringify(line);
}

/**
 * A minimal structured logger over a {@link LogSink}. Not exported as part
 * of the public `Telemetry` surface directly — {@link createTelemetry}
 * composes this internally; exported here for standalone unit testing of
 * the log-line schema (Blueprint §8.3 testing strategy).
 */
export class StructuredLogger {
  constructor(private readonly sink: LogSink = new ConsoleLogSink()) {}

  log(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
    this.sink.write(renderLogLine(level, message, fields));
  }
}
