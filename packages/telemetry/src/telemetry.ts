import { GatewayTracer } from "./tracer.js";
import { GatewayMeter } from "./metrics.js";
import { StructuredLogger, type LogSink } from "./logger.js";
import type { Telemetry, Span, LogLevel } from "./types.js";

export interface CreateTelemetryOptions {
  /** Instrumentation name registered with the OTel tracer/meter. Defaults to `"@ai-gateway"`. */
  instrumentationName?: string;
  /** Where rendered log lines are written. Defaults to a {@link ConsoleLogSink}. */
  logSink?: LogSink;
}

class DefaultTelemetry implements Telemetry {
  private readonly tracer: GatewayTracer;
  private readonly meter: GatewayMeter;
  private readonly logger: StructuredLogger;

  constructor(options: CreateTelemetryOptions = {}) {
    const instrumentationName = options.instrumentationName ?? "@ai-gateway";
    this.tracer = new GatewayTracer(instrumentationName);
    this.meter = new GatewayMeter(instrumentationName);
    this.logger = new StructuredLogger(options.logSink);
  }

  startSpan(name: string, attrs?: Record<string, unknown>): Span {
    return this.tracer.startSpan(name, attrs);
  }

  recordMetric(name: string, value: number, labels?: Record<string, string>): void {
    this.meter.recordMetric(name, value, labels);
  }

  log(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
    this.logger.log(level, msg, fields);
  }
}

/**
 * Constructs the single {@link Telemetry} implementation every other
 * package should depend on (Blueprint §8.3). Does not register any OTel
 * exporter — see {@link GatewayTracer}/{@link GatewayMeter} — so it is safe
 * to construct in any process, including tests, with zero configuration.
 */
export function createTelemetry(options?: CreateTelemetryOptions): Telemetry {
  return new DefaultTelemetry(options);
}
