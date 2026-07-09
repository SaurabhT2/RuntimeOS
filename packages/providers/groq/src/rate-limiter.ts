import { createGatewayError } from "@ai-gateway/provider-sdk";

/**
 * architecture §12.3: "adapter-level token-bucket limiter that respects
 * Groq's per-model RPM/TPM headers, proactively throttling before Groq
 * returns a 429 rather than just reacting to one." Two independent
 * buckets — one for request count, one for token count — since Groq's
 * free tier caps both dimensions separately.
 *
 * "Proactive" here means: if there is enough headroom, `acquire()`
 * resolves immediately; if not, it waits for the bucket to refill *as
 * long as that wait still fits inside the caller's `timeoutMs` budget*.
 * If the wait would not fit, it fails fast with a `RATE_LIMITED`
 * `GatewayError` immediately, rather than waiting out the clock and then
 * failing with a `TIMEOUT` anyway — a wasted round-trip either way, but
 * the immediate failure at least reports the *true* cause (this package's
 * README, Engineering Decisions).
 */
export interface TokenBucketOptions {
  requestsPerMinute?: number;
  tokensPerMinute?: number;
  /** Injectable clock (ms since epoch), test seam only. Defaults to `Date.now`. */
  now?: () => number;
  /** Injectable delay function, test seam only. Defaults to a real `setTimeout`-based delay. */
  sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

class Bucket {
  private tokens: number;
  private lastRefillAt: number;

  constructor(
    private readonly capacityPerMinute: number,
    private readonly now: () => number,
  ) {
    this.tokens = capacityPerMinute;
    this.lastRefillAt = now();
  }

  private refill(): void {
    const elapsedMs = this.now() - this.lastRefillAt;
    if (elapsedMs <= 0) return;
    const refillAmount = (elapsedMs / 60_000) * this.capacityPerMinute;
    this.tokens = Math.min(this.capacityPerMinute, this.tokens + refillAmount);
    this.lastRefillAt = this.now();
  }

  /** Milliseconds until at least `amount` capacity is available; `0` if available now. */
  msUntilAvailable(amount: number): number {
    this.refill();
    if (this.tokens >= amount) return 0;
    const deficit = amount - this.tokens;
    return Math.ceil((deficit / this.capacityPerMinute) * 60_000);
  }

  consume(amount: number): void {
    this.refill();
    this.tokens = Math.max(0, this.tokens - amount);
  }
}

/**
 * Tracks headroom against Groq's advertised per-minute request/token
 * limits and proactively delays (or fast-fails) calls that would exceed
 * them, rather than firing the request and reacting to Groq's own 429.
 */
export class TokenBucketRateLimiter {
  private readonly requestBucket: Bucket | undefined;
  private readonly tokenBucket: Bucket | undefined;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: TokenBucketOptions = {}) {
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
    this.requestBucket =
      options.requestsPerMinute !== undefined
        ? new Bucket(options.requestsPerMinute, this.now)
        : undefined;
    this.tokenBucket =
      options.tokensPerMinute !== undefined
        ? new Bucket(options.tokensPerMinute, this.now)
        : undefined;
  }

  /**
   * Waits until there is headroom for one request and `estimatedTokens`
   * tokens, then reserves that capacity. Rejects with a `RATE_LIMITED`
   * `GatewayError` (never resolves past the deadline) if the required
   * wait would exceed `timeoutMs`.
   */
  async acquire(estimatedTokens: number, timeoutMs: number): Promise<void> {
    const waitMs = Math.max(
      this.requestBucket?.msUntilAvailable(1) ?? 0,
      this.tokenBucket?.msUntilAvailable(estimatedTokens) ?? 0,
    );

    if (waitMs > 0) {
      if (waitMs >= timeoutMs) {
        throw createGatewayError(
          "RATE_LIMITED",
          `Proactive rate limiting: would need to wait ${waitMs}ms for headroom, exceeding timeoutMs=${timeoutMs}.`,
          { waitMs, timeoutMs },
        );
      }
      await this.sleep(waitMs);
    }

    this.requestBucket?.consume(1);
    this.tokenBucket?.consume(estimatedTokens);
  }
}
