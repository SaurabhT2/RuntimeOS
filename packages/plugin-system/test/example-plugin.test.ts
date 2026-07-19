import { describe, expect, it } from "vitest";
import { createPassthroughLoggingPlugin } from "../src/example-plugin.js";
import { PluginHost } from "../src/plugin-host.js";
import { request, response } from "./fixtures.js";

describe("createPassthroughLoggingPlugin", () => {
  it("has a default name and is a valid, registerable plugin", () => {
    const host = new PluginHost();
    const plugin = createPassthroughLoggingPlugin();
    expect(() => host.register(plugin)).not.toThrow();
    expect(plugin.name).toBe("passthrough-logger");
  });

  it("accepts a custom name", () => {
    const plugin = createPassthroughLoggingPlugin("my-custom-logger");
    expect(plugin.name).toBe("my-custom-logger");
  });

  it("onRequest passes the request through unchanged", async () => {
    const plugin = createPassthroughLoggingPlugin();
    const req = request();
    const result = await plugin.onRequest!(req);
    expect(result).toEqual(req);
  });

  it("onResponse passes the response through unchanged", async () => {
    const plugin = createPassthroughLoggingPlugin();
    const res = response();
    const result = await plugin.onResponse!(res);
    expect(result).toEqual(res);
  });

  it("calls the sink for both hooks when wired into a PluginHost end-to-end", async () => {
    const events: Array<{ hook: string; requestId?: string }> = [];
    const plugin = createPassthroughLoggingPlugin("logger", (e) => events.push(e));
    const host = new PluginHost();
    host.register(plugin);

    await host.runOnRequest(request());
    await host.runOnResponse(response());

    expect(events.map((e) => e.hook)).toEqual(["onRequest", "onResponse"]);
  });
});
