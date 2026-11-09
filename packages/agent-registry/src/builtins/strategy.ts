import type { AgentManifest } from "../agent-contract.js";

export const strategyAgent: AgentManifest = {
  id: "strategy",
  version: "1.0.0",
  displayName: "Strategy Agent",
  description: "Frames strategic choices, operating models and decision pathways.",
  purpose:
    "Translate ambiguous business objectives into evidence-aware strategic options, trade-offs and recommended decisions.",
  domains: ["strategy"],
  capabilities: ["strategic-analysis", "decision-support"],
  invocationTriggers: [
    "business strategy",
    "strategic choice",
    "operating model",
    "portfolio priorities",
    "executive decision",
  ],
  input: {
    requiredFields: ["objective", "desiredOutcome"],
    optionalFields: ["timeHorizon", "constraints", "optionsUnderConsideration"],
    contextKeys: ["executive-profile", "active-priorities", "workspace-knowledge", "project-context", "decision-history"],
  },
  output: {
    kind: "decision-brief",
    requiredSections: ["executive-summary", "strategic-context", "options", "trade-offs", "recommendation", "risks", "decision-required"],
    evidenceRules: [
      "Separate verified facts, assumptions and hypotheses.",
      "State material unknowns and confidence.",
      "Do not invent financial or delivery outcomes.",
    ],
  },
  toolCapabilities: ["knowledge.search", "research.search", "artifact.draft"],
  autonomy: {
    autonomousActions: ["analyse-options", "draft-strategy", "prepare-decision-brief", "identify-risks"],
    approvalRequiredActions: ["commit-to-strategy", "communicate-strategy-externally", "change-approved-business-priorities"],
    prohibitedActions: ["make-financial-commitments", "represent-unverified-prospects-as-clients"],
  },
  evaluation: {
    qualityCriteria: ["strategic-coherence", "commercial-realism", "traceable-evidence", "explicit-trade-offs"],
    acceptanceChecks: [
      "Recommendation answers the stated objective.",
      "Assumptions and dependencies are visible.",
      "No external commitment is executed.",
    ],
  },
};