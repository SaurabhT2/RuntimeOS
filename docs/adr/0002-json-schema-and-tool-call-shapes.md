# ADR-0002: Concrete shapes for `JSONSchema` and `ToolCall`

**Status:** Accepted
**Date:** 2026-07-04
**Format:** Context / Decision / Consequences / Alternatives

## Context

Architecture §10.3 references a `JSONSchema` type
(`constraints.requiredSchema`) and architecture §10.4 references a
`ToolCall` type (`output.toolCalls`), but neither section spells out the
type's shape — they are used as if already defined elsewhere. `core-contracts`
must ship a compiling, testable package at EM-0, so these two types needed
concrete definitions. This ADR documents that as a deliberate, narrow
engineering decision — not an architectural redesign — consistent with
Implementation Rules ("never introduce new architectural concepts").

## Decision

**`JSONSchema`** is defined as a permissive, structurally-recursive type
(`type`, `properties`, `items`, `required`, `enum`, `const`,
`additionalProperties`, `description`, plus an index signature for
forward-compatible keys) rather than a full JSON-Schema-draft type system.
`core-contracts` only needs to carry a schema opaquely from caller to
Policy Engine to provider adapter (architecture §12.1's structured-output
translation); the provider adapter is what interprets it, so a rich type
system here would be speculative complexity with no consumer yet.

**`ToolCall`** is defined with the conventional three-field envelope
(`id`, `name`, `arguments: string` — JSON-encoded) matching architecture
§12.1's description of `NormalizedResult`: every provider's native tool-call
format is normalized to one shape at the adapter boundary, so
`core-contracts` only needs the normalized shape, not any provider's native
representation.

## Consequences

- Both types are additive-only surface for now: neither Wave 1–4 package
  consumes them yet (`ToolCall` isn't exercised until `providers/groq` /
  `providers/nvidia-nim`, Wave 3; `JSONSchema` isn't interpreted until the
  same wave's structured-output routing work). This is intentional —
  defining the wire shape now means Wave 3 adapters build against a frozen
  contract instead of inventing their own shape independently.
- If a real provider's tool-calling format turns out not to normalize
  cleanly to this shape (discovered during EM-3), that is a contract change
  requiring a new ADR per ADR-0001, not a silent adapter-level workaround.

## Alternatives considered

- **Defer both types until Wave 3**, when a real adapter needs them.
  Rejected: `ExecuteRequest`/`ExecuteResponse` reference them directly, so
  `core-contracts` would not compile as a complete, EM-0-frozen contract
  without them. Deferring would mean re-opening a "frozen" package during
  Wave 3, defeating the purpose of freezing it at EM-0.
- **Use a JSON-Schema npm library's exported type** for `JSONSchema`
  instead of a hand-rolled structural type. Rejected for EM-0: pulling in a
  third-party JSON-Schema type/validator here would give `core-contracts` a
  non-zero, opinionated dependency beyond `zod` (which is already a
  considered, minimal addition for runtime validation) before any consumer
  has a concrete need for full draft compliance. Revisit if/when a provider
  adapter's structured-output support needs draft-level validation.
