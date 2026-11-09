import type { AgentManifest } from "../agent-contract.js";
export const researchAgent: AgentManifest = {
 id:"research",version:"1.0.0",displayName:"Research Agent",description:"Builds sourced market, competitor, technology and ecosystem intelligence.",
 purpose:"Find, assess and synthesize relevant evidence while making source quality, recency and uncertainty explicit.",
 domains:["research"],capabilities:["market-research","competitive-intelligence","evidence-synthesis"],invocationTriggers:["market research","competitor analysis","industry trends","technology landscape","validate a claim"],
 input:{requiredFields:["researchQuestion"],optionalFields:["geography","timeWindow","targetCompanies","sourcePreferences"],contextKeys:["workspace-knowledge","project-context","market-evidence","technical-constraints"]},
 output:{kind:"research-brief",requiredSections:["research-question","key-findings","evidence-and-sources","implications","unknowns","confidence"],evidenceRules:["Cite material external claims.","Prefer primary and recent sources for current facts.","Label inference separately from sourced fact.","Report conflicting evidence."]},
 toolCapabilities:["web.search","web.open","knowledge.search"],
 autonomy:{autonomousActions:["search-public-sources","summarize-evidence","compare-public-information","draft-research-brief"],approvalRequiredActions:["contact-research-subject","access-paid-data-source","share-research-externally"],prohibitedActions:["bypass-access-controls","present-unsourced-claims-as-verified"]},
 evaluation:{qualityCriteria:["source-authority","recency","coverage","reproducibility","uncertainty-calibration"],acceptanceChecks:["Material claims have sources.","Research date and scope are stated.","Gaps and contradictory evidence are disclosed."]},
};