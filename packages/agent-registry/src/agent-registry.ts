import type { AgentManifest, AgentSelectionQuery } from "./agent-contract.js";

export class AgentRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentRegistryError";
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

function snapshotManifest(manifest: AgentManifest): AgentManifest {
  return deepFreeze({
    ...manifest,
    domains: [...manifest.domains],
    capabilities: [...manifest.capabilities],
    invocationTriggers: [...manifest.invocationTriggers],
    input: {
      ...manifest.input,
      requiredFields: [...manifest.input.requiredFields],
      optionalFields: [...manifest.input.optionalFields],
      contextKeys: [...manifest.input.contextKeys],
    },
    output: {
      ...manifest.output,
      requiredSections: [...manifest.output.requiredSections],
      evidenceRules: [...manifest.output.evidenceRules],
    },
    toolCapabilities: [...manifest.toolCapabilities],
    autonomy: {
      autonomousActions: [...manifest.autonomy.autonomousActions],
      approvalRequiredActions: [...manifest.autonomy.approvalRequiredActions],
      prohibitedActions: [...manifest.autonomy.prohibitedActions],
    },
    evaluation: {
      qualityCriteria: [...manifest.evaluation.qualityCriteria],
      acceptanceChecks: [...manifest.evaluation.acceptanceChecks],
    },
  });
}

function assertManifest(manifest: AgentManifest): void {
  if (!/^[a-z][a-z0-9-]*$/.test(manifest.id)) {
    throw new AgentRegistryError(
      "Agent id must be a lowercase kebab-case identifier",
    );
  }
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    throw new AgentRegistryError(
      \`Agent \${manifest.id} must use semantic versioning (major.minor.patch)\`,
    );
  }

  const lists = [
    ["domains", manifest.domains],
    ["capabilities", manifest.capabilities],
    ["invocationTriggers", manifest.invocationTriggers],
    ["toolCapabilities", manifest.toolCapabilities],
    ["autonomousActions", manifest.autonomy.autonomousActions],
    ["approvalRequiredActions", manifest.autonomy.approvalRequiredActions],
    ["prohibitedActions", manifest.autonomy.prohibitedActions],
    ["qualityCriteria", manifest.evaluation.qualityCriteria],
    ["acceptanceChecks", manifest.evaluation.acceptanceChecks],
  ] as const;

  for (const [name, values] of lists) {
    if (
      !Array.isArray(values) ||
      values.length === 0 ||
      values.some((value) => typeof value !== "string" || !value.trim())
    ) {
      throw new AgentRegistryError(
        \`Agent \${manifest.id} requires non-empty string entries in \${name}\`,
      );
    }
  }

  const autonomous = new Set(manifest.autonomy.autonomousActions);
  for (const action of [
    ...manifest.autonomy.approvalRequiredActions,
    ...manifest.autonomy.prohibitedActions,
  ]) {
    if (autonomous.has(action)) {
      throw new AgentRegistryError(
        \`Agent \${manifest.id} has conflicting autonomy classification for: \${action}\`,
      );
    }
  }
}

export class InMemoryAgentRegistry {
  private readonly manifests = new Map<string, AgentManifest>();

  register(manifest: AgentManifest): void {
    assertManifest(manifest);
    if (this.manifests.has(manifest.id)) {
      throw new AgentRegistryError(\`Agent already registered: \${manifest.id}\`);
    }
    this.manifests.set(manifest.id, snapshotManifest(manifest));
  }

  get(id: string): AgentManifest | undefined {
    return this.manifests.get(id);
  }

  list(): readonly AgentManifest[] {
    return [...this.manifests.values()].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
  }

  findCandidates(query: AgentSelectionQuery): readonly AgentManifest[] {
    const domains = query.domains ?? [];
    const capabilities = query.capabilities ?? [];
    return this.list().filter(
      (agent) =>
        (domains.length === 0 ||
          domains.some((domain) => agent.domains.includes(domain))) &&
        capabilities.every((capability) =>
          agent.capabilities.includes(capability),
        ),
    );
  }

  has(id: string): boolean {
    return this.manifests.has(id);
  }

  get size(): number {
    return this.manifests.size;
  }
}