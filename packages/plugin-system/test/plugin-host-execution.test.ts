import { MockAdapter } from "@ai-gateway/provider-sdk";
import { describe, expect, it, vi } from "vitest";
import { PluginHost } from "../src/plugin-host.js";
import { request, response } from "./fixtures.js";

describe("PluginHost.runOnRequest — execution", () => {
  it("threads the request through a single plugin's onRequest", async () => {
    const host = new PluginHost();
    host.register({
      name: "tagger",
      async onRequest(req) {
        return { ...req, correlationId: "tagged" };
      },
    });
    const result = await host.runOnRequest(request());
    expect(result.correlationId).toBe("tagged");
  });

  it("threads the request through multiple plugins in registration order", async () => {
    const host = new PluginHost();
    host.register({
      name: "first",
      async onRequest(req) {
        return { ...req, correlationId: `${req.correlationId ?? ""}A` };
      },
    });
    host.register({
      name: "second",
      async onRequest(req) {
        return { ...req, correlationId: `${req.correlationId ?? ""}B` };
      },
    });
    const result = await host.runOnRequest(request());
    expect(result.correlationId).toBe("AB");
  });

  it("skips plugins without an onRequest hook", async () => {
    const host = new PluginHost();
    host.register({ name: "no-op-plugin" });
    const result = await host.runOnRequest(request());
    expect(result).toEqual(request());
  });
});

describe("PluginHost.runOnResponse — execution", () => {
  it("threads the response through a single plugin's onResponse", async () => {
    const host = new PluginHost();
    host.register({
      name: "usage-tagger",
      async onResponse(res) {
        return { ...res, output: { ...res.output, text: `${res.output.text} [tagged]` } };
      },
    });
    const result = await host.runOnResponse(response());
    expect(result.output.text).toBe("a summary [tagged]");
  });
});

describe("PluginHost.runOnResponse — skips plugins without an onResponse hook", () => {
  it("skips a plugin missing onResponse while still running one that has it", async () => {
    const host = new PluginHost();
    host.register({ name: "no-response-hook" });
    host.register({
      name: "has-response-hook",
      async onResponse(res) {
        return { ...res, finishReason: "stop" };
      },
    });
    const result = await host.runOnResponse(response());
    expect(result.finishReason).toBe("stop");
  });
});

describe("PluginHost.notifyProviderRegistered — skips plugins without the hook", () => {
  it("skips a plugin missing onProviderRegistered while still notifying one that has it", () => {
    const host = new PluginHost();
    host.register({ name: "no-provider-hook" });
    let called = false;
    host.register({
      name: "has-provider-hook",
      onProviderRegistered() {
        called = true;
      },
    });
    host.notifyProviderRegistered(new MockAdapter({ id: "groq" }));
    expect(called).toBe(true);
  });
});

describe("PluginHost — isolation", () => {
  it("a throwing onRequest plugin does not prevent the next plugin from running", async () => {
    const host = new PluginHost();
    host.register({
      name: "throws",
      async onRequest() {
        throw new Error("boom");
      },
    });
    host.register({
      name: "still-runs",
      async onRequest(req) {
        return { ...req, correlationId: "survived" };
      },
    });
    const result = await host.runOnRequest(request());
    expect(result.correlationId).toBe("survived");
  });

  it("passes the throwing plugin's pre-throw input unchanged to the next plugin", async () => {
    const host = new PluginHost();
    host.register({
      name: "sets-then-throws",
      async onRequest() {
        throw new Error("boom");
      },
    });
    const observed: unknown[] = [];
    host.register({
      name: "observer",
      async onRequest(req) {
        observed.push(req.correlationId);
        return req;
      },
    });
    await host.runOnRequest(request({ correlationId: "original" }));
    expect(observed).toEqual(["original"]);
  });

  it("reports the failure via onPluginError rather than throwing to the caller", async () => {
    const onPluginError = vi.fn();
    const host = new PluginHost({ onPluginError });
    host.register({
      name: "flaky",
      async onRequest() {
        throw new Error("boom");
      },
    });
    await expect(host.runOnRequest(request())).resolves.toBeDefined();
    expect(onPluginError).toHaveBeenCalledWith(
      expect.objectContaining({ pluginName: "flaky", hook: "onRequest" }),
    );
  });

  it("isolates onResponse failures the same way", async () => {
    const onPluginError = vi.fn();
    const host = new PluginHost({ onPluginError });
    host.register({
      name: "flaky-response",
      async onResponse() {
        throw new Error("boom");
      },
    });
    host.register({
      name: "still-runs",
      async onResponse(res) {
        return { ...res, finishReason: "stop" };
      },
    });
    const result = await host.runOnResponse(response());
    expect(result.finishReason).toBe("stop");
    expect(onPluginError).toHaveBeenCalledWith(
      expect.objectContaining({ pluginName: "flaky-response", hook: "onResponse" }),
    );
  });

  it("isolates onProviderRegistered failures", () => {
    const onPluginError = vi.fn();
    const host = new PluginHost({ onPluginError });
    host.register({
      name: "flaky-provider-hook",
      onProviderRegistered() {
        throw new Error("boom");
      },
    });
    let secondCalled = false;
    host.register({
      name: "second",
      onProviderRegistered() {
        secondCalled = true;
      },
    });
    host.notifyProviderRegistered(new MockAdapter({ id: "groq" }));
    expect(secondCalled).toBe(true);
    expect(onPluginError).toHaveBeenCalledWith(
      expect.objectContaining({ pluginName: "flaky-provider-hook", hook: "onProviderRegistered" }),
    );
  });
});
