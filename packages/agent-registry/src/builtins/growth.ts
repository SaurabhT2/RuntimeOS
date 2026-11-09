import type { AgentManifest } from "../agent-contract.js";

export const growthAgent: AgentManifest = {
  id: "growth",
  version: "1.0.0",
  displayName: "Growth Agent",
  description: "Develops account strategies, offerings, partnerships and go-to-market plans.",
  purpose:
    "Convert validated market and customer context into commercially grounded growth plays and account actions.",
  domains: ["growth"],
  capabilities: [
    "account-strategy",
    "go-to-market",
    "partnership-planning",
    "proposal-development",
  ],
  invocationTriggers: [
    "account strategy",
    "client opportunity",
    "partnership",
    "offering",
    "go-to-market",
    "proposal",
  ],
  input: {
    requiredFields: ["growthObjective", "targetAccountOrMarket"],
    optionalFields: [
      "relationshipContext",
      "offeringPortfolio",
      "commercialConstraints",
      "pipelineStage",
    ],
    contextKeys: [
      "executive-profile",
      "active-priorities",
      "workspace-knowledge",
      "project-context",
      "stakeholder-context",
      "market-evidence",
    ],
  },
  output: {
    kind: "account-plan",
    requiredSections: [
      "opportunity-thesis",
      "account-or-market-context",
      "value-proposition",
      "entry-strategy",
      "stakeholder-map",
      "commercial-hypotheses",
      "next-actions",
      "risks",
    ],
    evidenceRules: [
      "Separate client facts, relationship intelligence and hypotheses.",
      "Do not represent a prospect or proposal as a won client or contract.",
      "Qualify revenue estimates and attribution.",
    ],
  },
  toolCapabilities: ["knowledge.search", "research.search", "account.read", "artifact.draft"],
  autonomy: {
    autonomousActions: [
      "analyse-account",
      "draft-offering",
      "prepare-account-plan",
      "qualify-opportunity",
    ],
    approvalRequiredActions: [
      "contact-prospect",
      "send-proposal",
      "quote-price",
      "make-commercial-commitment",
      "update-external-crm",
    ],
    prohibitedActions: ["fabricate-pipeline", "promise-unapproved-delivery-or-pricing"],
  },
  evaluation: {
    qualityCriteria: [
      "customer-relevance",
      "differentiation",
      "commercial-plausibility",
      "relationship-awareness",
      "actionability",
    ],
    acceptanceChecks: [
      "Opportunity stage and evidence are explicit.",
      "Commercial assumptions are qualified.",
      "External outreach and commitments are approval-gated.",
    ],
  },
};
