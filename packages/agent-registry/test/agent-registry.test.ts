import { describe, expect, it } from "vitest";
import {
  AgentRegistryError,
  BUILT_IN_AGENTS,
  InMemoryAgentRegistry,
} from "../src/index.js";

describe("InMemoryAgentRegistry", () => {
  it("registers six built-in contracts", () => {
    const registry = new InMemoryAgentRegistry();
    for (const agent of BUILT_IN_AGENTS) registry.register(agent);

    expect(registry.size).toBe(6);
    expect(registry.list().map((agent) => agent.id)).toEqual([
      "architecture",
      "execution",
      "growth",
      "leadership",
      "research",
      "strategy",
    ]);
  });

  it("rejects duplicate identifiers", () => {
    const registry = new InMemoryAgentRegistry();
    registry.register(BUILT_IN_AGENTS[0]!);

    expect(() => registry.register(BUILT_IN_AGENTS[0]!)).toThrow(
      AgentRegistryError,
    );
  });

  it("returns undefined for unknown agents", () => {
    expect(new InMemoryAgentRegistry().get("missing")).toBeUndefined();
  });

  it("filters by domain and all requested capabilities", () => {
    const registry = new InMemoryAgentRegistry();
    for (const agent of BUILT_IN_AGENTS) registry.register(agent);

    expect(
      registry.findCandidates({ domains: ["growth"] }).map((agent) => agent.id),
    ).toEqual(["growth"]);
    expect(
      registry
        .findCandidates({
          capabilities: ["market-research", "evidence-synthesis"],
        })
        .map((agent) => agent.id),
    ).toEqual(["research"]);
    expect(
      registry.findCandidates({
        domains: ["growth"],
        capabilities: ["security-review"],
      }),
    ).toEqual([]);
  });

  it("returns immutable snapshots", () => {
    const registry = new InMemoryAgentRegistry();
    registry.register(BUILT_IN_AGENTS[0]!);
    const stored = registry.get("strategy")!;

    expect(Object.isFrozen(stored)).toBe(true);
    expect(Object.isFrozen(stored.capabilities)).toBe(true);
    expect(() =>
      (stored.capabilities as string[]).push("unexpected"),
    ).toThrow();
  });

  it("rejects conflicting autonomy classifications", () => {
    const source = BUILT_IN_AGENTS[0]!;
    const invalid = {
      ...source,
      autonomy: {
        ...source.autonomy,
        approvalRequiredActions: [
          ...source.autonomy.approvalRequiredActions,
          "analyse-options",
        ],
      },
    };

    expect(() => new InMemoryAgentRegistry().register(invalid)).toThrow(
      /conflicting autonomy classification/,
    );
  });
});