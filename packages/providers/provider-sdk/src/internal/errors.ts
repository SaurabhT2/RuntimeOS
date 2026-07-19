import { GatewayError, type GatewayErrorCode } from "@ai-gateway/core-contracts";

/**
 * architecture §19.1's error taxonomy table, as a lookup: whether a given
 * `GatewayErrorCode` is retryable is a property of the *code*, not a choice
 * an individual call site makes — this keeps every adapter (mock and real)
 * consistent without duplicating the table.
 */
const RETRYABLE_CODES: ReadonlySet<GatewayErrorCode> = new Set(["RATE_LIMITED", "TIMEOUT"]);

/**
 * Constructs a {@link GatewayError} with `retryable` derived from
 * architecture §19.1's taxonomy, so adapter code never has to get that flag
 * wrong or out of sync with the code it's paired with.
 */
export function createGatewayError(
  code: GatewayErrorCode,
  message: string,
  details?: Record<string, unknown>,
): GatewayError {
  return new GatewayError(code, message, RETRYABLE_CODES.has(code), details);
}

/**
 * Races `work` against `timeoutMs`, rejecting with a `GatewayError("TIMEOUT", ...)`
 * if the timer fires first. This is the mechanism every `ProviderAdapter`
 * is expected to use to honor `NormalizedInvocation.timeoutMs` (architecture
 * §18.4/§19.3: "every request has a deadline") — demonstrated here by the
 * Mock Adapter, and enforced across every adapter by
 * {@link runConformanceSuite}'s timeout scenario.
 */
export function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(createGatewayError("TIMEOUT", `Exceeded timeoutMs=${timeoutMs}`));
    }, timeoutMs);
    // Node timers keep the event loop alive; this harness never runs long
    // enough for that to matter, but unref() keeps behavior clean for any
    // consumer running this in a longer-lived process.
    timer.unref?.();
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Resolves after `ms` milliseconds. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}
