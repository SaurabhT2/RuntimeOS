import type { Span as OtelSpan } from "@opentelemetry/api";

/**
 * Re-exported as-is from `@opentelemetry/api` (architecture §11: `startSpan`
 * returns `Span`). Every other package in the monorepo interacts with spans
 * only through this type — never by importing `@opentelemetry/api` itself
 * (Blueprint §8.3 "one small interface every other package uses uniformly").
 */
export type Span = OtelSpan;

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * The fixed core fields of every structured log line (architecture §21.4).
 * All optional except `message` — callers attach whichever of these apply
 * to the current operation; anything else passed to {@link Telemetry.log}
 * rides along as additional context fields on the same line.
 */
export interface LogCoreFields {
  requestId?: string;
  traceId?: string;
  tenant?: string;
}

/**
 * architecture §11's `Telemetry` interface, unchanged here (Blueprint §8.3).
 * The one seam every other package depends on for tracing, metrics, and
 * logging — never OTel directly.
 */
export interface Telemetry {
  startSpan(name: string, attrs?: Record<string, unknown>): Span;
  recordMetric(name: string, value: number, labels?: Record<string, string>): void;
  log(level: LogLevel, msg: string, fields?: Record<string, unknown>): void;
}
