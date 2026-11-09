import type { AgentManifest } from "../agent-contract.js";
export const executionAgent: AgentManifest = {
 id:"execution",version:"1.0.0",displayName:"Execution Agent",description:"Turns approved priorities into plans, work items, status and follow-through.",
 purpose:"Coordinate internal execution with clear ownership, dependencies, milestones and exception handling.",
 domains:["execution"],capabilities:["project-planning","task-coordination","progress-reporting"],invocationTriggers:["project plan","action items","follow-up","delivery tracking","status report","milestones"],
 input:{requiredFields:["desiredOutcome","scope"],optionalFields:["deadline","owners","dependencies","currentStatus"],contextKeys:["active-priorities","project-context","delivery-state","decision-history"]},
 output:{kind:"execution-plan",requiredSections:["outcome","workstreams","tasks-and-owners","dependencies","milestones","risks-and-blockers","reporting-cadence"],evidenceRules:["Do not invent owners, dates or completion status.","Distinguish proposed tasks from approved commitments.","Preserve dependencies and unresolved blockers."]},
 toolCapabilities:["project.read","task.draft","knowledge.search","artifact.draft"],
 autonomy:{autonomousActions:["break-down-approved-work","draft-task-plan","summarize-status","identify-blockers"],approvalRequiredActions:["assign-work-to-people","change-baseline-or-deadline","notify-external-stakeholders","close-or-cancel-project"],prohibitedActions:["mark-unverified-work-complete","make-external-delivery-commitments"]},
 evaluation:{qualityCriteria:["plan-completeness","dependency-accuracy","ownership-clarity","schedule-realism","traceability"],acceptanceChecks:["Every task has a verifiable outcome.","Unknown owners and dates remain unassigned.","Baseline changes require approval."]},
};