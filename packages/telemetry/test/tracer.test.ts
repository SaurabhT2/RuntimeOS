import { SpanStatusCode, trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GatewayTracer } from "../src/tracer.js";

describe("GatewayTracer", () => {
  let exporter: InMemorySpanExporter;
  let provider: BasicTracerProvider;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    trace.setGlobalTracerProvider(provider);
  });

  afterEach(async () => {
    exporter.reset();
    trace.disable();
    await provider.shutdown();
  });

  it("returns a Span usable via the standard OTel Span methods", () => {
    const tracer = new GatewayTracer("test");
    const span = tracer.startSpan("do-thing", { foo: "bar" });
    expect(typeof span.setAttribute).toBe("function");
    expect(typeof span.end).toBe("function");
    span.end();

    const [exported] = exporter.getFinishedSpans();
    expect(exported?.name).toBe("do-thing");
    expect(exported?.attributes.foo).toBe("bar");
  });

  it("defaults the span status to OK if the caller never calls setStatus before end()", () => {
    const tracer = new GatewayTracer("test");
    const span = tracer.startSpan("no-explicit-status");
    span.end();

    const [exported] = exporter.getFinishedSpans();
    expect(exported?.status.code).toBe(SpanStatusCode.OK);
  });

  it("does not override a status explicitly set before end()", () => {
    const tracer = new GatewayTracer("test");
    const span = tracer.startSpan("explicit-status");
    span.setStatus({ code: SpanStatusCode.ERROR, message: "failed" });
    span.end();

    const [exported] = exporter.getFinishedSpans();
    expect(exported?.status.code).toBe(SpanStatusCode.ERROR);
    expect(exported?.status.message).toBe("failed");
  });

  it("allows calling recordException before end()", () => {
    const tracer = new GatewayTracer("test");
    const span = tracer.startSpan("with-exception");
    span.recordException(new Error("oops"));
    span.end();

    const [exported] = exporter.getFinishedSpans();
    expect(exported?.events.some((e) => e.name === "exception")).toBe(true);
    // still gets a status even though an exception was recorded but no
    // explicit setStatus call was made
    expect(exported?.status.code).toBe(SpanStatusCode.OK);
  });
});
