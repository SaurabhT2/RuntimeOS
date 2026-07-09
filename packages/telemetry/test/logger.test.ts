import { describe, expect, it } from "vitest";
import { renderLogLine, StructuredLogger, type LogSink } from "../src/logger.js";

describe("renderLogLine", () => {
  it("always includes timestamp, level, and message", () => {
    const line = JSON.parse(renderLogLine("info", "hello"));
    expect(line).toMatchObject({ level: "info", message: "hello" });
    expect(typeof line.timestamp).toBe("string");
    expect(new Date(line.timestamp).toISOString()).toBe(line.timestamp);
  });

  it("promotes requestId, traceId, and tenant to top-level fields", () => {
    const line = JSON.parse(
      renderLogLine("error", "boom", {
        requestId: "req-1",
        traceId: "trace-1",
        tenant: "org-1",
      }),
    );
    expect(line.requestId).toBe("req-1");
    expect(line.traceId).toBe("trace-1");
    expect(line.tenant).toBe("org-1");
  });

  it("omits core fields entirely when not provided, rather than emitting undefined", () => {
    const line = JSON.parse(renderLogLine("debug", "no context"));
    expect("requestId" in line).toBe(false);
    expect("traceId" in line).toBe(false);
    expect("tenant" in line).toBe(false);
  });

  it("spreads arbitrary extra fields as additional context alongside the core schema", () => {
    const line = JSON.parse(
      renderLogLine("warn", "custom context", { providerId: "groq", attempt: 2 }),
    );
    expect(line.providerId).toBe("groq");
    expect(line.attempt).toBe(2);
  });

  it("produces valid single-line JSON for every log level", () => {
    for (const level of ["debug", "info", "warn", "error"] as const) {
      expect(() => JSON.parse(renderLogLine(level, "msg"))).not.toThrow();
    }
  });
});

describe("StructuredLogger", () => {
  it("writes exactly one rendered line per log() call to its sink", () => {
    const lines: string[] = [];
    const sink: LogSink = { write: (line) => lines.push(line) };
    const logger = new StructuredLogger(sink);

    logger.log("info", "first");
    logger.log("error", "second", { requestId: "r1" });

    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({ level: "info", message: "first" });
    expect(JSON.parse(lines[1]!)).toMatchObject({
      level: "error",
      message: "second",
      requestId: "r1",
    });
  });
});
