import { metrics, type Meter, type Histogram } from "@opentelemetry/api";

/**
 * Thin wrapper over `@opentelemetry/api`'s global meter registration
 * (Blueprint §8.3), mirroring {@link GatewayTracer}'s no-SDK-registered-here
 * stance: metric readers/exporters are wired at the composition root, not
 * in this package.
 *
 * A histogram instrument is used uniformly for every metric name recorded
 * through {@link Telemetry.recordMetric} (architecture §21.2's catalogue
 * mixes histograms, counters, and gauges by *name*, but the interface
 * itself is one generic `recordMetric` call — a histogram is the strict
 * superset that lets any consumer derive count/sum/rate/percentiles from
 * it, whichever the metric name conceptually is).
 */
export class GatewayMeter {
  private readonly meter: Meter;
  private readonly histograms = new Map<string, Histogram>();

  constructor(instrumentationName = "@ai-gateway/telemetry") {
    this.meter = metrics.getMeter(instrumentationName);
  }

  recordMetric(name: string, value: number, labels?: Record<string, string>): void {
    let histogram = this.histograms.get(name);
    if (!histogram) {
      histogram = this.meter.createHistogram(name);
      this.histograms.set(name, histogram);
    }
    histogram.record(value, labels);
  }
}
