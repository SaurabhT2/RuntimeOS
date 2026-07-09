import { vi } from "vitest";
import type { Telemetry } from "@ai-gateway/telemetry";

export function fakeTelemetry(): Telemetry {
  return {
    startSpan: vi.fn(() => ({ setStatus: vi.fn(), end: vi.fn() }) as never),
    recordMetric: vi.fn(),
    log: vi.fn(),
  };
}
