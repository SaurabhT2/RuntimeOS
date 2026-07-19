/**
 * @ai-gateway/plugin-system
 *
 * The Gateway Plugin framework (architecture §11): the `GatewayPlugin`
 * contract, registration, lifecycle, discovery, and loading. Not yet
 * integrated into the Orchestrator — that wiring is EM-8's job (Blueprint
 * §7 EM-7 explicitly excludes it).
 *
 * STATUS: implemented (Engineering Milestone EM-7, Blueprint §7, §8.18).
 *
 * Architecture reference: §11
 */

export { type GatewayPlugin } from "./plugin-contract.js";

export { InvalidPluginError, PluginNotFoundError } from "./errors.js";

export {
  type PluginLifecycleState,
  type PluginRecord,
  type PluginExecutionError,
  type PluginHostOptions,
  PluginHost,
} from "./plugin-host.js";

export {
  type PluginSource,
  type DiscoveryFailure,
  type DiscoveryResult,
  discoverPlugins,
} from "./discovery.js";

export { type PluginLoadFailure, type PluginLoadResult, loadPlugins } from "./loader.js";

export { createPassthroughLoggingPlugin } from "./example-plugin.js";
