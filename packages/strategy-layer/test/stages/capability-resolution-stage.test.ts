import { describe, expect, it } from "vitest";
import { CapabilityResolutionStage } from "../../src/stages/capability-resolution-stage.js";
import { baseRequest, seededOptions, tenant } from "../fixtures.js";

describe("CapabilityResolutionStage", () => {
  it("resolves requiredCapabilities for the request's task", async () => {
    const options = seededOptions();
    const stage = new CapabilityResolutionStage(options.capabilityRegistry);
    const result = await stage.run({ request: baseRequest(), tenant: tenant() });
    expect(result.requiredCapabilities).toBeDefined();
  });

  it("does not overwrite fields already present on the context", async () => {
    const options = seededOptions();
    const stage = new CapabilityResolutionStage(options.capabilityRegistry);
    const result = await stage.run({
      request: baseRequest(),
      tenant: tenant(),
      runtimeProfile: undefined,
    });
    expect(result.tenant).toEqual(tenant());
  });

  it("folds in request-level constraints (structuredOutput via requiredSchema)", async () => {
    const options = seededOptions();
    const stage = new CapabilityResolutionStage(options.capabilityRegistry);
    const result = await stage.run({
      request: baseRequest({ constraints: { requiredSchema: { type: "object" } } }),
      tenant: tenant(),
    });
    expect(result.requiredCapabilities?.structuredOutput).toBe(true);
  });

  it("is independently replaceable — any CapabilityRegistry-shaped object works", async () => {
    const stub = {
      resolveCapabilities: async () => ({
        structuredOutput: false,
        toolCalling: false,
        reasoningDepth: "shallow" as const,
        streamingPreferred: false,
        minContextTokens: 100,
      }),
      registerMapping: async () => undefined,
    };
    const stage = new CapabilityResolutionStage(stub);
    const result = await stage.run({ request: baseRequest(), tenant: tenant() });
    expect(result.requiredCapabilities?.reasoningDepth).toBe("shallow");
  });
});
