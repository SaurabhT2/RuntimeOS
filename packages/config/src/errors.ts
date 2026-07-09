/**
 * Raised whenever a configuration source produces a value that fails
 * {@link gatewayConfigSchema} validation, or when a configured source
 * cannot be read at all (missing file, malformed JSON). Deliberately not a
 * `GatewayError` (`@ai-gateway/core-contracts`): `GatewayError` models
 * request-time failures a caller can see; a bad deployment config is a
 * startup/operator-facing failure, so it gets its own, more specific type.
 */
export class ConfigError extends Error {
  public override readonly name = "ConfigError";

  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    Object.setPrototypeOf(this, ConfigError.prototype);
  }
}
