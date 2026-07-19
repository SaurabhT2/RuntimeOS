import { describe, expect, it } from "vitest";
import { DefaultHealthMonitor, InMemoryHealthStateStore } from "../src/health-monitor.js";

describe("DefaultHealthMonitor", () => {
  it("reports a fresh, healthy snapshot for a provider never seen before", () => {
    const monitor = new DefaultHealthMonitor();
    const snapshot = monitor.getHealth("groq");
    expect(snapshot).toMatchObject({ providerId: "groq", healthy: true, consecutiveFailures: 0 });
  });

  it("records success: healthy true, consecutiveFailures reset to 0, latency captured", () => {
    const monitor = new DefaultHealthMonitor();
    monitor.reportFailure("groq", { code: "TIMEOUT" });
    monitor.reportFailure("groq", { code: "TIMEOUT" });
    monitor.reportSuccess("groq", { latencyMs: 42 });

    const snapshot = monitor.getHealth("groq");
    expect(snapshot.healthy).toBe(true);
    expect(snapshot.consecutiveFailures).toBe(0);
    expect(snapshot.latencyMs).toBe(42);
  });

  it("flips healthy to false once consecutiveFailures reaches the configured threshold", () => {
    const monitor = new DefaultHealthMonitor({ unhealthyAfterConsecutiveFailures: 2 });
    monitor.reportFailure("groq", { code: "RATE_LIMITED" });
    expect(monitor.getHealth("groq").healthy).toBe(true); // 1 failure, still healthy

    monitor.reportFailure("groq", { code: "RATE_LIMITED" });
    expect(monitor.getHealth("groq").healthy).toBe(false); // 2 failures, threshold reached
  });

  it("carries the failure reason's message (or code, if no message) into the snapshot", () => {
    const monitor = new DefaultHealthMonitor();
    monitor.reportFailure("groq", { code: "TIMEOUT", message: "connect timed out" });
    expect(monitor.getHealth("groq").message).toBe("connect timed out");

    monitor.reportFailure("nvidia-nim", { code: "RATE_LIMITED" });
    expect(monitor.getHealth("nvidia-nim").message).toBe("RATE_LIMITED");
  });

  it("getHealthiestAlternative excludes the given provider IDs", async () => {
    const monitor = new DefaultHealthMonitor();
    monitor.reportSuccess("groq", { latencyMs: 50 });
    monitor.reportSuccess("nvidia-nim", { latencyMs: 80 });

    const alt = await monitor.getHealthiestAlternative("summarization", ["groq"]);
    expect(alt).toBe("nvidia-nim");
  });

  it("getHealthiestAlternative excludes unhealthy providers", async () => {
    const monitor = new DefaultHealthMonitor({ unhealthyAfterConsecutiveFailures: 1 });
    monitor.reportFailure("groq", { code: "TIMEOUT" }); // now unhealthy
    monitor.reportSuccess("nvidia-nim", { latencyMs: 80 });

    const alt = await monitor.getHealthiestAlternative("summarization", []);
    expect(alt).toBe("nvidia-nim");
  });

  it("getHealthiestAlternative prefers fewer consecutive failures, then lower latency", async () => {
    const monitor = new DefaultHealthMonitor({ unhealthyAfterConsecutiveFailures: 100 });
    monitor.reportFailure("groq", { code: "TIMEOUT" }); // 1 consecutive failure, still healthy
    monitor.reportSuccess("nvidia-nim", { latencyMs: 200 }); // 0 failures
    monitor.reportSuccess("azure-openai", { latencyMs: 50 }); // 0 failures, lower latency

    const alt = await monitor.getHealthiestAlternative("summarization", []);
    expect(alt).toBe("azure-openai");
  });

  it("returns null when every candidate is excluded or unhealthy", async () => {
    const monitor = new DefaultHealthMonitor({ unhealthyAfterConsecutiveFailures: 1 });
    monitor.reportFailure("groq", { code: "TIMEOUT" });

    const alt = await monitor.getHealthiestAlternative("summarization", []);
    expect(alt).toBeNull();
  });

  it("accepts a custom HealthStateStore", () => {
    const store = new InMemoryHealthStateStore();
    const monitor = new DefaultHealthMonitor({ store });
    monitor.reportSuccess("groq", { latencyMs: 10 });

    // The store itself reflects the write, proving state lives behind the
    // injected store rather than hidden internal state (Blueprint §13.7).
    expect(store.get("groq")?.healthy).toBe(true);
  });
});
