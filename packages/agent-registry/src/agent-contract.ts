/**
 * Versioned, declarative contract for a specialist agent.
 * A manifest describes an agent's scope; it is not an executable prompt,
 * tool implementation, or authorization grant.
 */
export type AgentDomain =
  | "strategy"
  | "leadership"
  | "research"
  | "architecture"
  | "growth"
  | "execution";

export type AgentCapability =
  | "strategic-analysis"
  | "decision-support"
  | "executive-communication"
  | "meeting-preparation"
  | "presentation-drafting"
  | "market-research"
  | "competitive-intelligence"
  | "evidence-synthesis"
  | "solution-architecture"
  | "technical-due-diligence"
  | "security-review"
  | "account-strategy"
  | "go-to-market"
  | "partnership-planning"
  | "proposal-development"
  | "project-planning"
  | "task-coordination"
  | "progress-reporting";

export type AgentContextKey =
  | "executive-profile"
  | "active-priorities"
  | "workspace-knowledge"
  | "project-context"
  | "stakeholder-context"
  | "market-evidence"
  | "technical-constraints"
  | "decision-history"
  | "delivery-state";

export type AgentOutputKind =
  | "analysis"
  | "decision-brief"
  | "executive-communication"
  | "research-brief"
  | "architecture-design"
  | "account-plan"
  | "execution-plan";

export interface AgentInputContract {
  readonly requiredFields: readonly string[];
  readonly optionalFields: readonly string[];
  readonly contextKeys: readonly AgentContextKey[];
}

export interface AgentOutputContract {
  readonly kind: AgentOutputKind;
  readonly requiredSections: readonly string[];
  readonly evidenceRules: readonly string[];
}

export interface AgentAutonomyPolicy {
  readonly autonomousActions: readonly string[];
  readonly approvalRequiredActions: readonly string[];
  readonly prohibitedActions: readonly string[];
}

export interface AgentEvaluationContract {
  readonly qualityCriteria: readonly string[];
  readonly acceptanceChecks: readonly string[];
}

export interface AgentManifest {
  readonly id: string;
  readonly version: string;
  readonly displayName: string;
  readonly description: string;
  readonly purpose: string;
  readonly domains: readonly AgentDomain[];
  readonly capabilities: readonly AgentCapability[];
  readonly invocationTriggers: readonly string[];
  readonly input: AgentInputContract;
  readonly output: AgentOutputContract;
  /** Named capability requirements, not credentials or direct tool handles. */
  readonly toolCapabilities: readonly string[];
  readonly autonomy: AgentAutonomyPolicy;
  readonly evaluation: AgentEvaluationContract;
}

export interface AgentSelectionQuery {
  /** If supplied, an agent must match at least one requested domain. */
  readonly domains?: readonly AgentDomain[];
  /** If supplied, an agent must provide every requested capability. */
  readonly capabilities?: readonly AgentCapability[];
}