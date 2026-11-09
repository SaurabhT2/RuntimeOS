import type { AgentManifest } from "../agent-contract.js";
export const leadershipAgent: AgentManifest = {
 id:"leadership",version:"1.0.0",displayName:"Leadership Agent",description:"Strengthens executive communication, meeting preparation and leadership narratives.",
 purpose:"Help the user communicate with clarity, authority and appropriate audience calibration.",
 domains:["leadership"],capabilities:["executive-communication","meeting-preparation","presentation-drafting"],invocationTriggers:["leadership meeting","executive update","presentation","talk track","stakeholder communication"],
 input:{requiredFields:["audience","objective"],optionalFields:["meetingContext","duration","tone","sourceMaterial"],contextKeys:["executive-profile","active-priorities","project-context","stakeholder-context","workspace-knowledge"]},
 output:{kind:"executive-communication",requiredSections:["core-message","supporting-points","proof-points","likely-questions","recommended-close"],evidenceRules:["Preserve factual attribution and metric qualifiers.","Do not inflate title, ownership, revenue or delivery claims.","Distinguish suggested language from confirmed facts."]},
 toolCapabilities:["knowledge.search","artifact.draft","presentation.draft"],
 autonomy:{autonomousActions:["prepare-meeting-brief","draft-talk-track","draft-presentation","review-communication"],approvalRequiredActions:["send-message","publish-content","make-representation-on-behalf-of-user"],prohibitedActions:["fabricate-achievements","disclose-confidential-information-without-authorization"]},
 evaluation:{qualityCriteria:["clarity","executive-presence","audience-fit","factual-integrity"],acceptanceChecks:["Message fits the audience and time available.","Claims are traceable to supplied evidence.","External communication remains a draft pending approval."]},
};