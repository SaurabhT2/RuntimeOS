import type { AgentManifest } from "../agent-contract.js";
import { architectureAgent } from "./architecture.js";
import { executionAgent } from "./execution.js";
import { growthAgent } from "./growth.js";
import { leadershipAgent } from "./leadership.js";
import { researchAgent } from "./research.js";
import { strategyAgent } from "./strategy.js";

export const BUILT_IN_AGENTS: readonly AgentManifest[] = [
  strategyAgent,
  leadershipAgent,
  researchAgent,
  architectureAgent,
  growthAgent,
  executionAgent,
];
