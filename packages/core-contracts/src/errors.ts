import { z } from "zod";

/**
 * Every error the gateway can surface to a caller. Provider-independent by
 * design (architecture §10.1): a raw `GroqApiError` or `NimHttpError` must
 * never escape the provider adapter layer — enforced by the adapter
 * conformance test suite (`tools/adapter-conformance-tests`, architecture
 * §19.2).
 */
export const GATEWAY_ERROR_CODES = [
  "INVALID_TASK",
  "INVALID_SCHEMA",
  "CREDENTIAL_NOT_FOUND",
  "CREDENTIAL_INVALID",
  "ALL_PROVIDERS_UNAVAILABLE",
  "RATE_LIMITED",
  "TIMEOUT",
  "CANCELLED",
  "CONTENT_FILTERED",
  "INTERNAL_ERROR",
] as const;

export type GatewayErrorCode = (typeof GATEWAY_ERROR_CODES)[number];

export const gatewayErrorCodeSchema = z.enum(GATEWAY_ERROR_CODES);

/**
 * architecture §10.5. Callers only ever see this type. `retryable` lets the
 * Retry Engine (Wave 2, `reliability` package, architecture §18) distinguish
 * transient failures from terminal ones without string-matching on `code`.
 */
export class GatewayError extends Error {
  public override readonly name = "GatewayError";

  constructor(
    public readonly code: GatewayErrorCode,
    message: string,
    public readonly retryable: boolean,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    // Restore the prototype chain — required for `instanceof` to work
    // correctly when this class is compiled to target ES2022 and consumed
    // across a compiled package boundary.
    Object.setPrototypeOf(this, GatewayError.prototype);
  }

  /** Serializes to a plain object safe to send over the wire or log. */
  toJSON(): {
    name: string;
    code: GatewayErrorCode;
    message: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  } {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      details: this.details,
    };
  }
}

/** Runtime type guard, useful at adapter/middleware boundaries. */
export function isGatewayError(value: unknown): value is GatewayError {
  return value instanceof GatewayError;
}

/** Schema for the wire/serialized form of a {@link GatewayError} (its `toJSON()` output). */
export const gatewayErrorPayloadSchema = z.object({
  name: z.literal("GatewayError"),
  code: gatewayErrorCodeSchema,
  message: z.string(),
  retryable: z.boolean(),
  details: z.record(z.unknown()).optional(),
});
