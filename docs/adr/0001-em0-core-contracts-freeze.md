# ADR-0001: Freeze `core-contracts` and promote it to `1.0.0` at EM-0

**Status:** Accepted
**Date:** 2026-07-04
**Format:** Context / Decision / Consequences / Alternatives (per Engineering
Blueprint §6.3, reusing architecture §28/§39/§46's ADR format)

## Context

Engineering Blueprint §3.7 designates `core-contracts` as the first package
promoted to `1.0.0`, gated on EM-0's acceptance criteria (Blueprint §7),
because every other package and every external SDK consumer depends on it
(architecture §9). Blueprint §2 Philosophy #5 states contracts are "the
expensive thing to change" and should be stabilized earliest and changed
least.

## Decision

`@ai-gateway/core-contracts` v1.0.0 ships at EM-0 containing exactly the
types specified in architecture §10.3–§10.5 (`ExecuteRequest`,
`ExecuteResponse`, `StreamChunk`, `GatewayError`, `GatewayErrorCode`) plus
their supporting types (`ChatMessage`, `TaskType`, `ToolCall`, `JSONSchema`,
`FinishReason`). Every exported type has a companion runtime (Zod) schema.

Any future change to an exported type or schema in this package — adding a
required field, narrowing a union, changing an error code's meaning —
requires a new ADR in this directory, following this same format, per
Blueprint §6.3. Additive, optional changes (a new optional field, a new
`GatewayErrorCode` variant) are the expected/allowed evolution path and do
not by themselves require a major version bump, but still require an ADR
recording why the addition was needed and confirming it's backward
compatible.

## Consequences

- Every downstream package (Waves 1–9) can be built and tested against a
  stable, versioned contract from day one, which is what makes Blueprint
  §5's wave-based parallelization real (Blueprint §6.2).
- The risk named in Blueprint §7 EM-0 — "over-designing the contract before
  real constraints are known" — is accepted and mitigated, not eliminated:
  the contract is amendable via this ADR process, not frozen forever.
- Two types referenced by the architecture spec but not fully defined there
  (`JSONSchema`, `ToolCall`) were given concrete shapes in this package.
  See ADR-0002 for that decision specifically.

## Alternatives considered

- **Leave `core-contracts` at `0.x` alongside every other pre-1.0 package**
  (Blueprint §3.7's default for everything else). Rejected: the whole point
  of promoting it early is to signal contract stability to consumers
  (internal packages and future external SDKs) before the rest of the
  platform is built — waiting until v1.0 MVP (EM-5) would mean every
  downstream package built against a contract that could still change
  without an ADR gate.
