import type { ExecuteRequest, ExecuteResponse } from "@ai-gateway/core-contracts";
import type { ProviderAdapter } from "@ai-gateway/provider-sdk";
import { InvalidPluginError, PluginNotFoundError } from "./errors.js";
import type { GatewayPlugin } from "./plugin-contract.js";

/** architecture §11's `GatewayPlugin` has no explicit lifecycle field — this is this package's own bookkeeping, not part of the frozen contract. */
export type PluginLifecycleState = "registered" | "unregistered";

export interface PluginRecord {
  plugin: GatewayPlugin;
  state: PluginLifecycleState;
}

/**
 * Raised (never thrown) when an individual plugin's hook fails during
 * `PluginHost.runOnRequest`/`runOnResponse`/`notifyProviderRegistered` —
 * one plugin's failure must never prevent the others from running
 * (Blueprint §7 EM-7's "isolation" testing requirement). Passed to the
 * `onPluginError` constructor option.
 *
 * Independent Engineering Review of EM-7, Issue #5 (Minor): this package's
 * first draft cited architecture §19.3's "Never-Silent-Failure Principle"
 * to justify this design, but §19.3 is specifically about request-deadline
 * and outer-catch-all exception handling in the middleware pipeline — a
 * different mechanism from per-plugin hook isolation, and citing it here
 * overstated what it actually supports. Stated plainly instead: if the
 * caller does not supply `onPluginError`, a plugin hook failure is
 * genuinely silent — no throw, no log (this package has no `telemetry`
 * dependency edge to log through, Blueprint §4.1's table), nothing
 * observable anywhere. This is a deliberate default favoring availability
 * (one plugin's bug must never break the request), but it is a real
 * debuggability gap, not a solved one — any EM-8 composition root that
 * wires this class into `orchestrator` should supply `onPluginError`
 * wired to `telemetry` (available at that layer, unlike here), or plugin
 * failures will be invisible in production.
 */
export interface PluginExecutionError {
  pluginName: string;
  hook: "onRequest" | "onResponse" | "onProviderRegistered";
  error: unknown;
}

export interface PluginHostOptions {
  /** Called for every individual plugin-hook failure. Defaults to a no-op — errors are isolated, never rethrown, per this milestone's "isolation" requirement. */
  onPluginError?: (err: PluginExecutionError) => void;
}

/**
 * architecture §11's `plugin-host.ts`. Registration, lifecycle, and
 * (self-contained, non-Orchestrator) hook execution for `GatewayPlugin`
 * implementations. Deliberately **not** wired into `orchestrator` —
 * Blueprint §7 EM-7: "Do NOT integrate plugins into the Orchestrator yet.
 * That occurs during EM-8." `runOnRequest`/`runOnResponse` exist so this
 * package's own "execution"/"isolation" test requirements (Blueprint §7)
 * can be verified against a real, working pipeline — a future
 * `orchestrator` integration (EM-8) is expected to either reuse this class
 * directly or call an equivalent seam at the appropriate point in the
 * request lifecycle (architecture §17).
 */
export class PluginHost {
  private readonly plugins = new Map<string, PluginRecord>();
  private readonly onPluginError: (err: PluginExecutionError) => void;

  constructor(options: PluginHostOptions = {}) {
    this.onPluginError = options.onPluginError ?? (() => undefined);
  }

  /**
   * Validates and registers a plugin. Throws `InvalidPluginError` for:
   * a missing/empty `name`, a duplicate `name` already registered, or any
   * present hook field that isn't actually a function (Blueprint §7 EM-7's
   * "invalid plugin rejection" testing requirement).
   */
  register(plugin: GatewayPlugin): void {
    if (typeof plugin.name !== "string" || plugin.name.trim().length === 0) {
      throw new InvalidPluginError("plugin.name must be a non-empty string");
    }
    if (this.plugins.get(plugin.name)?.state === "registered") {
      throw new InvalidPluginError("a plugin with this name is already registered", plugin.name);
    }
    for (const hookName of ["onRequest", "onResponse", "onProviderRegistered"] as const) {
      const hook = plugin[hookName];
      if (hook !== undefined && typeof hook !== "function") {
        throw new InvalidPluginError(`${hookName}, if present, must be a function`, plugin.name);
      }
    }
    this.plugins.set(plugin.name, { plugin, state: "registered" });
  }

  /**
   * Marks a plugin unregistered. Its hooks are no longer invoked by
   * `runOnRequest`/`runOnResponse`/`notifyProviderRegistered`. Throws
   * `PluginNotFoundError` for an unknown name.
   *
   * Note: the underlying record is kept (state flips to `"unregistered"`,
   * not deleted) so `getState()` can distinguish "never registered" from
   * "was registered, then unregistered" — useful for diagnostics, at the
   * cost of unbounded growth for a long-lived host with heavy
   * register/unregister churn under the same names repeatedly (Independent
   * Engineering Review of EM-7, Issue #11 — Suggestion, not fixed here: no
   * real deployment exercises this pattern at this milestone's scale).
   */
  unregister(name: string): void {
    const record = this.plugins.get(name);
    if (!record) {
      throw new PluginNotFoundError(name);
    }
    record.state = "unregistered";
  }

  /** All currently-registered (not unregistered) plugins, in registration order. */
  list(): GatewayPlugin[] {
    return [...this.plugins.values()].filter((r) => r.state === "registered").map((r) => r.plugin);
  }

  get(name: string): GatewayPlugin | undefined {
    const record = this.plugins.get(name);
    return record?.state === "registered" ? record.plugin : undefined;
  }

  getState(name: string): PluginLifecycleState | undefined {
    return this.plugins.get(name)?.state;
  }

  /**
   * Threads `req` through every registered plugin's `onRequest` hook, in
   * registration order. A plugin without `onRequest` is skipped. A plugin
   * whose `onRequest` throws (or rejects) is isolated: its failure is
   * reported via `onPluginError` and the *input* it received is passed
   * unchanged to the next plugin, rather than aborting the whole chain.
   */
  async runOnRequest(req: ExecuteRequest): Promise<ExecuteRequest> {
    let current = req;
    for (const plugin of this.list()) {
      if (!plugin.onRequest) {
        continue;
      }
      try {
        current = await plugin.onRequest(current);
      } catch (error) {
        this.onPluginError({ pluginName: plugin.name, hook: "onRequest", error });
      }
    }
    return current;
  }

  /** Symmetric to `runOnRequest`, for the response side. */
  async runOnResponse(res: ExecuteResponse): Promise<ExecuteResponse> {
    let current = res;
    for (const plugin of this.list()) {
      if (!plugin.onResponse) {
        continue;
      }
      try {
        current = await plugin.onResponse(current);
      } catch (error) {
        this.onPluginError({ pluginName: plugin.name, hook: "onResponse", error });
      }
    }
    return current;
  }

  /** Notifies every registered plugin's `onProviderRegistered`, isolating failures the same way as the request/response hooks. */
  notifyProviderRegistered(adapter: ProviderAdapter): void {
    for (const plugin of this.list()) {
      if (!plugin.onProviderRegistered) {
        continue;
      }
      try {
        plugin.onProviderRegistered(adapter);
      } catch (error) {
        this.onPluginError({ pluginName: plugin.name, hook: "onProviderRegistered", error });
      }
    }
  }
}
