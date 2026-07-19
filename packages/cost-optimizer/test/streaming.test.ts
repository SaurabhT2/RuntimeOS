import { describe, expect, it } from "vitest";
import { computeDisableStreaming } from "../src/streaming.js";
import { capabilities, extractionProfile, reasoningProfile } from "./fixtures.js";

describe("computeDisableStreaming", () => {
  it("recommends disabling streaming for a short, non-streaming-preferred output on a streaming-default profile", () => {
    const profile = reasoningProfile({ inference: { temperature: 0.4, maxOutputTokens: 128 } });
    const result = computeDisableStreaming(profile, capabilities({ streamingPreferred: false }));
    expect(result).toBe(true);
  });

  it("recommends nothing when the profile doesn't default streaming on", () => {
    const result = computeDisableStreaming(extractionProfile(), capabilities());
    expect(result).toBeUndefined();
  });

  it("recommends nothing when the capability set actually prefers streaming", () => {
    const profile = reasoningProfile({ inference: { temperature: 0.4, maxOutputTokens: 64 } });
    const result = computeDisableStreaming(profile, capabilities({ streamingPreferred: true }));
    expect(result).toBeUndefined();
  });

  it("recommends nothing when the output is long enough that streaming still helps", () => {
    const profile = reasoningProfile({ inference: { temperature: 0.4, maxOutputTokens: 4096 } });
    const result = computeDisableStreaming(profile, capabilities({ streamingPreferred: false }));
    expect(result).toBeUndefined();
  });
});
