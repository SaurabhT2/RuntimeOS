import {
  type ExecuteRequest,
  type ExecuteResponse,
  executeRequestSchema,
  GatewayError,
  type GatewayErrorCode,
  isGatewayError,
  type StreamChunk,
} from "@ai-gateway/core-contracts";
import type { CredentialResolver } from "@ai-gateway/credential-resolver";
import type { ExecutionPlan, PolicyContext, PolicyEngine } from "@ai-gateway/policy-engine";
import {
  type CircuitBreaker,
  type HealthMonitor,
  providerModelClassKey,
  type RetryEngine,
} from "@ai-gateway/reliability";
import type { AIStrategyLayer, StrategyDecision } from "@ai-gateway/strategy-layer";
import { toStreamChunk, type StreamManager } from "@ai-gateway/streaming";
import type { Telemetry } from "@ai-gateway/telemetry";
import { randomUUID } from "node:crypto";
import { SpanStatusCode } from "@opentelemetry/api";
import { buildCacheHitResponse, buildCacheHitStreamChunk } from "./cache-hit-response.js";
import { allProvidersUnavailable, isFailoverEligible } from "./errors.js";
import { buildNormalizedInvocation } from "./invocation-builder.js";
import { buildExecuteResponse, type ExecutionMeta } from "./response-mapper.js";
import type { NormalizedInvocation, ProviderAdapter, ProviderAdapterRegistry } from "./types.js";

/**
 * architecture §11's orchestrator interface, extended with `executeStream`
 * (architecture §12.1's streaming variant, §17's request lifecycle) and
 * `cancel` (a thin passthrough to `StreamManager.cancel`, exposed here so a
 * caller never needs its own reference to the `StreamManager` — the
 * orchestrator is EM-4's one public seam for both the non-streaming and
 * streaming request lifecycles).
 */
export interface ExecutionOrchestrator {
  /** The full non-streaming lifecycle (architecture §17): resolves an `ExecutionPlan`, resolves credentials/an adapter, executes with retry, fails over across `plan.fallbackPlans` on retry-exhaustion, and returns a typed `ExecuteResponse`. Never rejects with anything but a `GatewayError`. */
  execute(req: ExecuteRequest): Promise<ExecuteResponse>;

  /** The streaming variant of the same lifecycle (architecture §12.1, §17): yields `StreamChunk`s as they arrive, failing over to the next plan only if no chunk has yet been yielded for this request. Never rejects with anything but a `GatewayError`. */
  executeStream(req: ExecuteRequest): AsyncGenerator<StreamChunk, void, void>;

  /** Cancels an in-flight `executeStream` call for `requestId`. A no-op if `requestId` has no active stream (mirrors `StreamManager.cancel`'s own idempotent-no-op contract). */
  cancel(requestId: string): void;
}

export interface ExecutionOrchestratorOptions {
  policyEngine: PolicyEngine;
  credentialResolver: CredentialResolver;
  retryEngine: RetryEngine;
  streamManager: StreamManager;
  adapterRegistry: ProviderAdapterRegistry;
  telemetry: Telemetry;
  /**
   * Optional — architecture §18.2's circuit breaker. Omitting it disables
   * the "skip a candidate whose breaker is open" behavior described below
   * (`resolveCandidate`) without otherwise changing the lifecycle; every
   * production composition (EM-5's `bootstrap.ts`) is expected to supply
   * one, but tests exercising only the retry/failover path without circuit
   * state don't have to construct one.
   */
  circuitBreaker?: CircuitBreaker;
  /** Optional — architecture §18.2's health monitor. Same optionality rationale as `circuitBreaker`. */
  healthMonitor?: HealthMonitor;
  /** Injected for deterministic tests. Defaults to `Date.now`. */
  now?: () => number;
  /** Injected for deterministic tests. Defaults to `node:crypto`'s `randomUUID`. */
  generateRequestId?: () => string;
  /**
   * (v1.2, EM-8) Optional — architecture §30's AI Strategy Layer. Omitting
   * it (the default) preserves EM-7 behavior exactly: `execute`/`executeStream`
   * call `policyEngine.selectExecutionPlan` directly, with no
   * `StrategyDecision` in the loop at all. Supplying one makes the
   * orchestrator call `strategyLayer.buildStrategy(req, req.tenant)` first
   * on every request, short-circuiting entirely on a `cacheHit`
   * (architecture §30.3/§33.4) and otherwise threading the resulting
   * `StrategyDecision` into `PolicyContext.strategyDecision` (ADR-0018)
   * before calling the same, unchanged `policyEngine.selectExecutionPlan`.
   * `apps/gateway-server`'s composition root (`gateway-runtime`'s
   * `bootstrap()`) decides whether to supply one based on
   * `GatewayConfig.enableStrategyLayer` (ADR-0017) — this class itself has
   * no feature-flag logic of its own; "the flag is off" and "no
   * `strategyLayer` was injected" are the same state, by design (EM-8's
   * "Thin Orchestrator" constraint: the *decision* to enable lives in
   * configuration/composition, not in this class's own control flow beyond
   * a single presence check).
   */
  strategyLayer?: AIStrategyLayer;
  /**
   * (v1.2, EM-10 Review Finding 1) Optional, generic post-execution hook —
   * fired exactly once per **successful, non-cache-hit** `execute()` call,
   * after the real `ExecuteResponse` (and therefore its real
   * `execution.providerId`/`usage.estimatedCostUsd`) is known, and before
   * `execute()` returns it to its caller. Never fired for a cache-hit
   * short-circuit (no new provider cost was incurred) and never fired on
   * any failure path (a `GatewayError` — architecture §19's error
   * responses carry no cost to record).
   *
   * This exists so `@ai-gateway/budget-governance`'s `BudgetLedger.recordSpend`
   * can be wired to real traffic (the EM-10 Independent Architecture &
   * Engineering Review's Finding 1: `recordSpend` was never invoked by any
   * production path) **without** this package gaining a dependency on
   * `budget-governance` — a package-boundary edge the Blueprint's §4.1
   * dependency table does not authorize. This class knows nothing about
   * budgets, ledgers, or spend; it calls an opaque function of the request
   * and its response, exactly the same "orthogonal, opt-in" shape EM-8's
   * `strategyLayer` field already established for this same options bag.
   * `gateway-runtime`'s composition root (the one package the architecture
   * itself designates as "permitted to import a concrete implementation of
   * every interface simultaneously") is where a real closure over
   * `BudgetLedger.recordSpend` is supplied — see `bootstrap()`.
   *
   * A rejection/throw from this hook is caught and logged
   * (`orchestrator.onExecutionCompleted.failed`) but never propagated —
   * a ledger write failing must not turn an otherwise-successful request
   * into an error response.
   *
   * Not wired into `executeStream()` in this rework — streaming's cost
   * accounting (a stream can be client-cancelled mid-flight, architecture
   * §17) is a genuinely different shape of "successful completion" than
   * the non-streaming path, and EM-10's Finding 1 only requires the
   * non-streaming path (which is the only path `pipeline-orchestrator`
   * ever calls, so pipeline execution already gets full accounting
   * coverage from this alone). Left as an explicitly out-of-scope,
   * documented gap — see `docs/adr/0026-budget-spend-recording-scope.md`
   * — rather than expanded into unrequested territory.
   */
  onExecutionCompleted?: (req: ExecuteRequest, response: ExecuteResponse) => void | Promise<void>;
}

/**
 * Thrown internally by {@link DefaultExecutionOrchestrator.resolveCandidate}
 * / {@link DefaultExecutionOrchestrator.attemptCandidate} to signal "this
 * candidate plan is done for, advance to the next `fallbackPlans` entry" —
 * as opposed to a plain `GatewayError` thrown from the same call stack,
 * which signals "this is architecture §17's terminal `Z4`/`Z6` node: stop,
 * do not try another plan." Never crosses a public method boundary — every
 * public method on {@link DefaultExecutionOrchestrator} unwraps this back
 * to its underlying `GatewayError` before the caller can observe it.
 */
class AdvanceToNextPlan extends Error {
  constructor(
    public readonly providerId: string,
    public readonly gatewayError: GatewayError,
  ) {
    super(gatewayError.message);
    this.name = "AdvanceToNextPlan";
  }
}

interface ResolvedCandidate {
  cred: Awaited<ReturnType<CredentialResolver["resolve"]>>;
  adapter: ProviderAdapter;
  key: string;
}

/** architecture §17's request lifecycle, §12.4's "orchestrator assembles Waves 1–3" role, and ADR-0008's adapter-resolution design — see `types.ts` for the latter's full rationale. */
export class DefaultExecutionOrchestrator implements ExecutionOrchestrator {
  private readonly policyEngine: PolicyEngine;
  private readonly credentialResolver: CredentialResolver;
  private readonly retryEngine: RetryEngine;
  private readonly streamManager: StreamManager;
  private readonly adapterRegistry: ProviderAdapterRegistry;
  private readonly telemetry: Telemetry;
  private readonly circuitBreaker: CircuitBreaker | undefined;
  private readonly healthMonitor: HealthMonitor | undefined;
  private readonly now: () => number;
  private readonly generateRequestId: () => string;
  private readonly strategyLayer: AIStrategyLayer | undefined;
  private readonly onExecutionCompleted:
    | ((req: ExecuteRequest, response: ExecuteResponse) => void | Promise<void>)
    | undefined;

  constructor(options: ExecutionOrchestratorOptions) {
    this.policyEngine = options.policyEngine;
    this.credentialResolver = options.credentialResolver;
    this.retryEngine = options.retryEngine;
    this.streamManager = options.streamManager;
    this.adapterRegistry = options.adapterRegistry;
    this.telemetry = options.telemetry;
    this.circuitBreaker = options.circuitBreaker;
    this.healthMonitor = options.healthMonitor;
    this.now = options.now ?? Date.now;
    this.generateRequestId = options.generateRequestId ?? (() => randomUUID());
    this.strategyLayer = options.strategyLayer;
    this.onExecutionCompleted = options.onExecutionCompleted;
  }

  async execute(req: ExecuteRequest): Promise<ExecuteResponse> {
    const requestId = req.requestId ?? this.generateRequestId();
    this.validate(req);
    const span = this.telemetry.startSpan("orchestrator.execute", {
      requestId,
      task: req.task,
      tenant: req.tenant.organizationId,
    });
    const attempts: Array<{ providerId: string; code: GatewayErrorCode; message: string }> = [];
    try {
      const strategyDecision = await this.buildStrategyDecision(req);
      if (strategyDecision?.cacheHit) {
        const response = buildCacheHitResponse(requestId, strategyDecision.cacheHit);
        this.telemetry.recordMetric("orchestrator.execute.cacheHit", 1, {});
        this.telemetry.log("info", "execute served from Strategy Layer cache hit", { requestId });
        span.setStatus({ code: SpanStatusCode.OK });
        return response;
      }

      const plan = await this.policyEngine.selectExecutionPlan(
        req,
        this.policyContext(strategyDecision),
      );
      const deadlineAt = this.deadlineAt(req);
      const candidates = [plan, ...plan.fallbackPlans];

      for (const [i, candidate] of candidates.entries()) {
        try {
          const { result, meta } = await this.attemptCandidate(
            req,
            candidate,
            requestId,
            i > 0,
            deadlineAt,
            strategyDecision,
          );
          const response = buildExecuteResponse(result, meta);
          this.telemetry.recordMetric("orchestrator.execute.success", 1, {
            providerId: meta.providerId,
          });
          this.telemetry.log("info", "execute completed", {
            requestId,
            providerId: meta.providerId,
            retries: meta.retries,
            failedOver: meta.failedOver,
          });
          await this.runExecutionCompletedHook(req, response, requestId);
          span.setStatus({ code: SpanStatusCode.OK });
          return response;
        } catch (error) {
          if (error instanceof AdvanceToNextPlan) {
            attempts.push({
              providerId: error.providerId,
              code: error.gatewayError.code,
              message: error.gatewayError.message,
            });
            continue;
          }
          throw error;
        }
      }

      throw allProvidersUnavailable(attempts);
    } catch (error) {
      const gwErr = this.toGatewayError(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: gwErr.message });
      this.telemetry.recordMetric("orchestrator.execute.failure", 1, { code: gwErr.code });
      this.telemetry.log("error", "execute failed", {
        requestId,
        code: gwErr.code,
        message: gwErr.message,
      });
      throw gwErr;
    } finally {
      span.end();
    }
  }

  async *executeStream(req: ExecuteRequest): AsyncGenerator<StreamChunk, void, void> {
    const requestId = req.requestId ?? this.generateRequestId();
    this.validate(req);
    const span = this.telemetry.startSpan("orchestrator.executeStream", {
      requestId,
      task: req.task,
      tenant: req.tenant.organizationId,
    });
    const attempts: Array<{ providerId: string; code: GatewayErrorCode; message: string }> = [];
    let yieldedAny = false;
    try {
      const strategyDecision = await this.buildStrategyDecision(req);
      if (strategyDecision?.cacheHit) {
        this.telemetry.recordMetric("orchestrator.executeStream.cacheHit", 1, {});
        this.telemetry.log("info", "executeStream served from Strategy Layer cache hit", {
          requestId,
        });
        span.setStatus({ code: SpanStatusCode.OK });
        yield buildCacheHitStreamChunk(requestId, strategyDecision.cacheHit);
        return;
      }

      const plan = await this.policyEngine.selectExecutionPlan(
        req,
        this.policyContext(strategyDecision),
      );
      const deadlineAt = this.deadlineAt(req);
      const candidates = [plan, ...plan.fallbackPlans];

      for (const candidate of candidates) {
        let resolved: ResolvedCandidate;
        try {
          resolved = await this.resolveCandidate(req, candidate, deadlineAt);
        } catch (error) {
          if (error instanceof AdvanceToNextPlan) {
            attempts.push({
              providerId: error.providerId,
              code: error.gatewayError.code,
              message: error.gatewayError.message,
            });
            continue;
          }
          throw error;
        }

        const invocation = buildNormalizedInvocation(req, candidate, strategyDecision);
        const startedAt = this.now();

        try {
          for await (const chunk of this.streamManager.openStream(
            resolved.adapter,
            invocation,
            resolved.cred,
            requestId,
          )) {
            yieldedAny = true;
            yield toStreamChunk(chunk, requestId);
            if (chunk.done) {
              this.circuitBreaker?.recordSuccess(resolved.key);
              this.healthMonitor?.reportSuccess(candidate.providerId, {
                latencyMs: this.now() - startedAt,
              });
              this.telemetry.recordMetric("orchestrator.executeStream.success", 1, {
                providerId: candidate.providerId,
              });
              span.setStatus({ code: SpanStatusCode.OK });
              return;
            }
          }
          // Contract violation guard (architecture §19.3): every stream
          // must terminate with `done: true`. `streaming`'s own
          // `DefaultStreamManager` never does this today, but this
          // orchestrator does not assume every future `StreamManager`
          // implementation upholds it.
          throw new GatewayError(
            "INTERNAL_ERROR",
            "Provider stream ended without a terminal chunk.",
            false,
            { providerId: candidate.providerId },
          );
        } catch (error) {
          const gwErr = this.toGatewayError(error);
          this.circuitBreaker?.recordFailure(resolved.key);
          this.healthMonitor?.reportFailure(candidate.providerId, {
            code: gwErr.code,
            message: gwErr.message,
          });
          if (yieldedAny) {
            // Partial output has already reached the caller — switching
            // providers now would silently splice two providers' output
            // together. Surface the failure instead (matches `streaming`'s
            // own documented "surfaces already-yielded chunks... before
            // raising" precedent for mid-stream failure).
            throw gwErr;
          }
          const eligibleForFallback = isFailoverEligible(gwErr.code);
          attempts.push({
            providerId: candidate.providerId,
            code: gwErr.code,
            message: gwErr.message,
          });
          if (!eligibleForFallback) {
            throw gwErr;
          }
          continue;
        }
      }

      throw allProvidersUnavailable(attempts);
    } catch (error) {
      const gwErr = this.toGatewayError(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: gwErr.message });
      this.telemetry.recordMetric("orchestrator.executeStream.failure", 1, { code: gwErr.code });
      this.telemetry.log("error", "executeStream failed", {
        requestId,
        code: gwErr.code,
        message: gwErr.message,
      });
      throw gwErr;
    } finally {
      span.end();
    }
  }

  cancel(requestId: string): void {
    this.streamManager.cancel(requestId);
  }

  // ---------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------

  /**
   * Resolves credential + adapter + circuit-breaker gating for one
   * candidate plan. Credential-resolution failure is always terminal
   * (architecture §17's `H -- no --> Z4`, regardless of which candidate
   * index this is — see this package's README, Engineering Decisions, for
   * why that is the literal, non-obvious reading of §17's diagram rather
   * than an invented restriction). Adapter-resolution failure and an open
   * circuit breaker both advance to the next candidate instead (`ADR-0008`
   * / architecture §18.2 — neither is a named node in §17's diagram, since
   * both are new surface this milestone introduces).
   */
  private async resolveCandidate(
    req: ExecuteRequest,
    candidate: ExecutionPlan,
    deadlineAt: number | undefined,
  ): Promise<ResolvedCandidate> {
    const cred = await this.credentialResolver.resolve(candidate.providerId, req.tenant);

    let adapter: ProviderAdapter;
    try {
      adapter = this.adapterRegistry.resolve(candidate.providerId);
    } catch (error) {
      throw new AdvanceToNextPlan(candidate.providerId, this.toGatewayError(error));
    }

    const key = providerModelClassKey(candidate.providerId, candidate.modelClass);
    if (this.circuitBreaker && !this.circuitBreaker.canProceed(key)) {
      throw new AdvanceToNextPlan(
        candidate.providerId,
        new GatewayError(
          "ALL_PROVIDERS_UNAVAILABLE",
          `Circuit breaker is open for provider "${candidate.providerId}" / model class "${candidate.modelClass}".`,
          false,
          { providerId: candidate.providerId, modelClass: candidate.modelClass },
        ),
      );
    }

    if (deadlineAt !== undefined && this.now() >= deadlineAt) {
      throw new AdvanceToNextPlan(
        candidate.providerId,
        new GatewayError(
          "TIMEOUT",
          `Request deadline exceeded before candidate "${candidate.providerId}" could be attempted.`,
          true,
          { providerId: candidate.providerId },
        ),
      );
    }

    return { cred, adapter, key };
  }

  /**
   * Runs one candidate plan's non-streaming attempt end to end: resolve →
   * build invocation → retry-wrapped invoke → success, or an
   * {@link AdvanceToNextPlan} for retryable-exhausted failures, or a plain
   * `GatewayError` for non-retryable ones (architecture §17's `Z6`).
   */
  private async attemptCandidate(
    req: ExecuteRequest,
    candidate: ExecutionPlan,
    requestId: string,
    failedOver: boolean,
    deadlineAt: number | undefined,
    strategyDecision: StrategyDecision | undefined,
  ): Promise<{ result: Awaited<ReturnType<ProviderAdapter["invoke"]>>; meta: ExecutionMeta }> {
    const resolved = await this.resolveCandidate(req, candidate, deadlineAt);
    const invocation = buildNormalizedInvocation(req, candidate, strategyDecision);
    if (deadlineAt !== undefined) {
      invocation.timeoutMs = Math.min(invocation.timeoutMs, Math.max(deadlineAt - this.now(), 0));
    }

    const startedAt = this.now();
    let attemptCount = 0;
    try {
      const result = await this.retryEngine.execute(() => {
        attemptCount++;
        return resolved.adapter.invoke(invocation, resolved.cred);
      }, candidate.retryPolicy);

      const latencyMs = this.now() - startedAt;
      this.circuitBreaker?.recordSuccess(resolved.key);
      this.healthMonitor?.reportSuccess(candidate.providerId, { latencyMs });

      return {
        result,
        meta: {
          requestId,
          providerId: candidate.providerId,
          modelClass: candidate.modelClass,
          latencyMs,
          retries: attemptCount - 1,
          failedOver,
          estimatedCostUsd: resolved.adapter.estimateCost(invocation).estimatedCostUsd,
        },
      };
    } catch (error) {
      const gwErr = this.toGatewayError(error);
      this.circuitBreaker?.recordFailure(resolved.key);
      this.healthMonitor?.reportFailure(candidate.providerId, {
        code: gwErr.code,
        message: gwErr.message,
      });
      const eligibleForFallback = isFailoverEligible(gwErr.code);
      if (eligibleForFallback) {
        throw new AdvanceToNextPlan(candidate.providerId, gwErr);
      }
      throw gwErr;
    }
  }

  /**
   * Architecture §19.2's adapter boundary contract requires every adapter
   * to translate raw exceptions to `GatewayError` before they escape — but
   * this orchestrator does not take that on faith from a `ProviderAdapter`
   * it did not itself construct (it may be a test double, or a future
   * adapter package with a conformance-suite gap). Anything that is not
   * already a `GatewayError` is wrapped as a non-retryable `INTERNAL_ERROR`
   * (architecture §19.3's "never silent failure", applied at this boundary
   * too) rather than propagated as a raw `Error`/`unknown`.
   */
  private toGatewayError(error: unknown): GatewayError {
    if (isGatewayError(error)) {
      return error;
    }
    const message = error instanceof Error ? error.message : String(error);
    return new GatewayError("INTERNAL_ERROR", message, false, {
      original: error instanceof Error ? error.name : typeof error,
    });
  }

  /**
   * `PolicyContext` (architecture §11). `now` remains the only field
   * `PolicyEngine` (EM-3) itself reads for scoring; `strategyDecision`
   * (EM-8, ADR-0018) is threaded through whenever the Strategy Layer ran,
   * making "Policy Engine consumes StrategyDecision" (EM-8 Exit Criterion)
   * true without `policy-engine`'s own scoring logic changing — see
   * ADR-0018.
   */
  private policyContext(strategyDecision?: StrategyDecision): PolicyContext {
    return { now: () => new Date(this.now()), strategyDecision };
  }

  /**
   * Returns `undefined` (not a call) when no `strategyLayer` was injected —
   * this is the entire feature-flag mechanism (see
   * `ExecutionOrchestratorOptions.strategyLayer`'s doc comment): "disabled"
   * and "not supplied" are the same state, by design.
   *
   * Deliberately has no local try/catch: if `buildStrategy` throws while
   * the Strategy Layer *is* enabled, that exception propagates to
   * `execute`/`executeStream`'s outer `try/catch` and is wrapped by
   * `toGatewayError` into a typed, non-retryable `INTERNAL_ERROR` — the
   * whole request fails rather than silently falling back to the EM-7
   * pass-through path. Confirmed architecture-compliant (P6's "typed
   * error" is an explicitly sanctioned failure mode, not a gap) by the
   * EM-8 Independent Architecture & Engineering Review, Finding 5 — see
   * this package's README, Design notes item 7, for the full reasoning.
   * No code change was made for that finding.
   */
  private async buildStrategyDecision(req: ExecuteRequest): Promise<StrategyDecision | undefined> {
    if (!this.strategyLayer) {
      return undefined;
    }
    return this.strategyLayer.buildStrategy(req, req.tenant);
  }

  /**
   * (v1.2, EM-10 Review Finding 1) Invokes `onExecutionCompleted`, if
   * supplied, for a successful non-cache-hit response. Deliberately
   * isolated in its own `try/catch`: this hook's caller (e.g.
   * `gateway-runtime`'s `BudgetLedger.recordSpend` closure) is opaque to
   * this class, and a failure in it (e.g. a ledger write error) must not
   * turn an already-successful `ExecuteResponse` into a thrown
   * `GatewayError` — the request the caller asked for already succeeded.
   */
  private async runExecutionCompletedHook(
    req: ExecuteRequest,
    response: ExecuteResponse,
    requestId: string,
  ): Promise<void> {
    if (!this.onExecutionCompleted) {
      return;
    }
    try {
      await this.onExecutionCompleted(req, response);
    } catch (error) {
      this.telemetry.log("error", "orchestrator.onExecutionCompleted.failed", {
        requestId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private deadlineAt(req: ExecuteRequest): number | undefined {
    return req.constraints?.maxLatencyMs !== undefined
      ? this.now() + req.constraints.maxLatencyMs
      : undefined;
  }

  /**
   * Request-shape validation (architecture §17's implicit precondition —
   * every downstream package, from `policy-engine` onward, assumes a
   * structurally valid `ExecuteRequest`). Zod-validated here, at the one
   * seam every request passes through before any policy/credential/
   * provider work begins, rather than duplicated in each caller.
   */
  private validate(req: ExecuteRequest): void {
    const parsed = executeRequestSchema.safeParse(req);
    if (!parsed.success) {
      throw new GatewayError(
        "INVALID_SCHEMA",
        `Malformed ExecuteRequest: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
        false,
        { issues: parsed.error.issues },
      );
    }
    if (!req.input.text && (!req.input.messages || req.input.messages.length === 0)) {
      throw new GatewayError(
        "INVALID_SCHEMA",
        "ExecuteRequest.input must supply non-empty `text` or `messages`.",
        false,
      );
    }
  }
}

// Re-exported so `invocation-builder.ts`'s `NormalizedInvocation` mutation
// (the `invocation.stream = true` / `invocation.timeoutMs = ...` lines
// above) type-checks without a separate import in this file.
export type { NormalizedInvocation };
