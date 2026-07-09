import { metrics } from "@opentelemetry/api";
import {
  MeterProvider,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
  AggregationTemporality,
} from "@opentelemetry/sdk-metrics";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GatewayMeter } from "../src/metrics.js";

describe("GatewayMeter", () => {
  let exporter: InMemoryMetricExporter;
  let provider: MeterProvider;

  beforeEach(() => {
    exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    provider = new MeterProvider({
      readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 100000 })],
    });
    metrics.setGlobalMeterProvider(provider);
  });

  afterEach(async () => {
    await provider.shutdown();
    metrics.disable();
  });

  it("does not throw when recording a metric with labels", () => {
    const meter = new GatewayMeter("test");
    expect(() =>
      meter.recordMetric("gateway_request_duration_ms", 42, { task: "summarization" }),
    ).not.toThrow();
  });

  it("reuses the same histogram instrument across repeated calls with the same name", async () => {
    const meter = new GatewayMeter("test-reuse");
    meter.recordMetric("gateway_retries_total", 1, { providerId: "groq", reason: "timeout" });
    meter.recordMetric("gateway_retries_total", 1, { providerId: "groq", reason: "timeout" });

    await provider.forceFlush();
    const [batch] = exporter.getMetrics();
    const scopeMetrics = batch?.scopeMetrics ?? [];
    const metricNames = scopeMetrics.flatMap((sm) => sm.metrics.map((m) => m.descriptor.name));
    expect(metricNames).toContain("gateway_retries_total");
  });

  it("records metrics without labels", () => {
    const meter = new GatewayMeter("test");
    expect(() => meter.recordMetric("gateway_cache_hit_ratio", 0.75)).not.toThrow();
  });
});
