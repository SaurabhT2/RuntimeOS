import { describe, expect, it } from "vitest";
import type { ExecuteRequest } from "@ai-gateway/core-contracts";
import { classifyTask } from "../src/task-classifier.js";

function baseRequest(overrides: Partial<ExecuteRequest> = {}): ExecuteRequest {
  return {
    task: "summarization",
    input: { text: "hello" },
    tenant: { organizationId: "org-1" },
    ...overrides,
  };
}

describe("classifyTask", () => {
  it("requires JSON mode when constraints.requiredSchema is set", () => {
    const req = baseRequest({ constraints: { requiredSchema: { type: "object" } } });
    expect(classifyTask(req).requiresJsonMode).toBe(true);
  });

  it("requires JSON mode for the json_generation task even without an explicit schema", () => {
    const req = baseRequest({ task: "json_generation" });
    expect(classifyTask(req).requiresJsonMode).toBe(true);
  });

  it("does not require JSON mode for a plain summarization task", () => {
    const req = baseRequest();
    expect(classifyTask(req).requiresJsonMode).toBe(false);
  });

  it("never requires tool calling in EM-3 (no request-level signal exists yet)", () => {
    expect(classifyTask(baseRequest()).requiresToolCalling).toBe(false);
  });

  it("carries through constraints.streaming", () => {
    expect(classifyTask(baseRequest({ constraints: { streaming: true } })).requiresStreaming).toBe(
      true,
    );
    expect(classifyTask(baseRequest()).requiresStreaming).toBe(false);
  });

  it("carries through minContextTokens and maxCostUsd", () => {
    const req = baseRequest({ constraints: { minContextTokens: 50_000, maxCostUsd: 0.5 } });
    const requirement = classifyTask(req);
    expect(requirement.minContextTokens).toBe(50_000);
    expect(requirement.maxCostUsd).toBe(0.5);
  });

  it("gives creative tasks a high creativity affinity and low reasoning affinity", () => {
    const requirement = classifyTask(baseRequest({ task: "creative_writing" }));
    expect(requirement.creativityAffinity).toBeGreaterThan(requirement.reasoningAffinity);
  });

  it("gives complex_reasoning a high reasoning affinity and low creativity affinity", () => {
    const requirement = classifyTask(baseRequest({ task: "complex_reasoning" }));
    expect(requirement.reasoningAffinity).toBeGreaterThan(requirement.creativityAffinity);
  });

  it("gives extraction tasks a low creativity affinity", () => {
    const requirement = classifyTask(baseRequest({ task: "entity_extraction" }));
    expect(requirement.creativityAffinity).toBeLessThan(0.5);
  });

  it("falls back to default affinities for an unknown/custom task type", () => {
    const requirement = classifyTask(baseRequest({ task: "a_custom_deployment_task" }));
    expect(requirement.creativityAffinity).toBe(0.3);
    expect(requirement.reasoningAffinity).toBe(0.3);
  });
});
