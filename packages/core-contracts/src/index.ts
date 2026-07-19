/**
 * @ai-gateway/core-contracts
 *
 * Public request/response/error contracts shared by every AI Gateway
 * package and by external SDK consumers. Zero internal dependencies
 * (architecture §9). This is the first package promoted to `1.0.0`,
 * gated on EM-0's acceptance criteria (Blueprint §3.7, §7).
 *
 * Changes to any exported type here require ADR discipline (Blueprint
 * §6.3; architecture §28/§39/§46) — see docs/adr/0001-core-contracts-versioning.md.
 */

export * from "./task.js";
export * from "./json-schema.js";
export * from "./request.js";
export * from "./response.js";
export * from "./streaming.js";
export * from "./errors.js";
