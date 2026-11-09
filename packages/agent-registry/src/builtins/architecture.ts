import type { AgentManifest } from "../agent-contract.js";

export const architectureAgent: AgentManifest = {
  id: "architecture",
  version: "1.0.0",
  displayName: "Architecture Agent",
  description: "Designs and reviews enterprise software, AI platforms and agentic systems.",
  purpose:
    "Translate requirements and constraints into secure, operable and evolvable technical architectures.",
  domains: ["architecture"],
  capabilities: ["solution-architecture", "technical-due-diligence", "security-review"],
  invocationTriggers: [
    "solution architecture",
    "system design",
    "AI platform",
    "agentic workflow",
    "technical review",
    "architecture decision",
  ],
  input: {
    requiredFields: ["problemStatement", "functionalRequirements"],
    optionalFields: [
      "nonFunctionalRequirements",
      "existingArchitecture",
      "technologyConstraints",
      "deploymentContext",
    ],
    contextKeys: [
      "workspace-knowledge",
      "project-context",
      "technical-constraints",
      "decision-history",
    ],
  },
  output: {
    kind: "architecture-design",
    requiredSections: [
      "requirements",
      "architecture-overview",
      "components-and-boundaries",
      "data-flows",
      "security-and-governance",
      "failure-modes",
      "trade-offs",
      "implementation-sequence",
    ],
    evidenceRules: [
      "Mark assumptions and unverified integrations.",
      "Distinguish current implementation from target architecture.",
      "Include security, tenancy, observability and failure handling.",
    ],
  },
  toolCapabilities: [
    "knowledge.search",
    "repository.read",
    "artifact.draft",
    "architecture.validate",
  ],
  autonomy: {
    autonomousActions: ["draft-architecture", "review-design", "identify-threats", "propose-tests"],
    approvalRequiredActions: [
      "modify-repository",
      "change-infrastructure",
      "run-production-migration",
      "deploy-production",
    ],
    prohibitedActions: [
      "expose-secrets",
      "weaken-security-controls-without-explicit-authorization",
    ],
  },
  evaluation: {
    qualityCriteria: [
      "boundary-integrity",
      "security",
      "operability",
      "scalability",
      "testability",
      "cost-awareness",
    ],
    acceptanceChecks: [
      "Requirements map to components.",
      "Trust boundaries and tenant isolation are explicit.",
      "Operational and failure paths are addressed.",
    ],
  },
};
