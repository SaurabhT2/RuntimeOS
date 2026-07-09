/**
 * @ai-gateway/telemetry
 *
 * OpenTelemetry tracer/metrics/logger wrapper — the Telemetry interface
 * every other package depends on.
 *
 * STATUS: implemented (Engineering Milestone EM-1, Blueprint §7, §8.3).
 *
 * Architecture reference: §21, §11
 */

export type { Telemetry, Span, LogLevel, LogCoreFields } from "./types.js";
export { LOG_LEVELS } from "./types.js";

export { createTelemetry, type CreateTelemetryOptions } from "./telemetry.js";

export { GatewayTracer } from "./tracer.js";
export { GatewayMeter } from "./metrics.js";
export { StructuredLogger, ConsoleLogSink, renderLogLine, type LogSink } from "./logger.js";
