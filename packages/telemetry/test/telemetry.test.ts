import { describe, expect, it } from "vitest";
import { createTelemetry } from "../src/telemetry.js";
import type { LogSink } from "../src/logger.js";

describe("createTelemetry", () => {
  it("implements the full Telemetry interface", () => {
    const telemetry = createTelemetry();
    expect(typeof telemetry.startSpan).toBe("function");
    expect(typeof telemetry.recordMetric).toBe("function");
    expect(typeof telemetry.log).toBe("function");
  });

  it("startSpan returns a usable span that can be ended without throwing", () => {
    const telemetry = createTelemetry({ instrumentationName: "test" });
    const span = telemetry.startSpan("op", { attempt: 1 });
    expect(() => span.end()).not.toThrow();
  });

  it("recordMetric does not throw for typical catalogue-shaped calls", () => {
    const telemetry = createTelemetry({ instrumentationName: "test" });
    expect(() =>
      telemetry.recordMetric("gateway_provider_latency_ms", 120, {
        providerId: "groq",
        modelClass: "fast-extraction",
      }),
    ).not.toThrow();
  });

  it("log writes through to the configured sink using the fixed schema", () => {
    const lines: string[] = [];
    const sink: LogSink = { write: (line) => lines.push(line) };
    const telemetry = createTelemetry({ logSink: sink });

    telemetry.log("info", "handled request", { requestId: "req-42", providerId: "groq" });

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed).toMatchObject({
      level: "info",
      message: "handled request",
      requestId: "req-42",
      providerId: "groq",
    });
  });
});
