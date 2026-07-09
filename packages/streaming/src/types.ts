import type {
  NormalizedChunk,
  NormalizedInvocation,
  ProviderAdapter,
  ScopedCredential,
} from "@ai-gateway/provider-sdk";

/**
 * architecture §11, `packages/streaming/src/stream-manager.ts`:
 *
 * ```
 * export interface StreamManager {
 *   openStream(plan: ExecutionPlan, cred: ScopedCredential): AsyncIterable<NormalizedChunk>;
 *   cancel(requestId: string): void;
 * }
 * ```
 *
 * Two adaptations from that literal text, both documented here and in
 * this package's README (Engineering Decisions) rather than silently
 * diverging:
 *
 * 1. **`openStream`'s first two parameters are `(adapter, invocation)`,
 *    not `(plan: ExecutionPlan)`.** `ExecutionPlan` is `@ai-gateway/
 *    policy-engine`'s type, and `streaming` has no dependency edge onto
 *    `policy-engine` (Section 4.1's `DEPENDENCY_TABLE`: `streaming` may
 *    depend only on `provider-sdk` + `core-contracts`). An `ExecutionPlan`
 *    also doesn't carry a `ProviderAdapter` *instance* or a built
 *    `NormalizedInvocation` (message list, tools, etc.) in the first
 *    place — resolving `plan.providerId` to a concrete adapter and
 *    building the invocation from the original `ExecuteRequest` is the
 *    orchestrator's job (EM-4, architecture §17), since it's the one
 *    package with a legitimate dependency edge onto both `policy-engine`
 *    and `streaming`. `openStream` therefore accepts exactly what it
 *    needs to call `adapter.invokeStream()` directly — see
 *    ADR-0007.
 * 2. **`openStream` takes an explicit `requestId` parameter.** The
 *    literal signature above has no way to associate a specific
 *    `openStream` call with the `requestId` a later `cancel(requestId)`
 *    call refers to — some value must be threaded through at
 *    `openStream` time for `cancel` to mean anything. See ADR-0007.
 */
export interface StreamManager {
  openStream(
    adapter: ProviderAdapter,
    invocation: NormalizedInvocation,
    cred: ScopedCredential,
    requestId: string,
  ): AsyncIterable<NormalizedChunk>;
  cancel(requestId: string): void;
}
