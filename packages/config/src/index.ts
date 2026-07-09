/**
 * @ai-gateway/config
 *
 * Zod/JSON-schema validated configuration loader (GatewayConfig).
 *
 * STATUS: implemented (Engineering Milestone EM-1, Blueprint §7, §8.2).
 *
 * Architecture reference: §10.6
 */

export {
  gatewayConfigSchema,
  routingOverrideSchema,
  DEFAULT_GATEWAY_CONFIG,
  CREDENTIAL_SCOPES,
  ROUTING_STRATEGIES,
  BACKOFF_STRATEGIES,
  type GatewayConfig,
  type RoutingOverride,
  type CredentialScope,
  type RoutingStrategy,
  type BackoffStrategy,
} from "./schema.js";

export { ConfigError } from "./errors.js";

export {
  EnvConfigSource,
  FileConfigSource,
  InMemoryConfigSource,
  type ConfigSource,
} from "./sources.js";

export { loadConfig, watchConfig, type ConfigWatchHandle } from "./loader.js";
