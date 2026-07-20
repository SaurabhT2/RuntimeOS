import { describe, expect, it } from "vitest";
import { StudioConfigError, loadStudioConfigFromEnv } from "../src/studio-config.js";

const VALID_ENV: NodeJS.ProcessEnv = {
  GATEWAY_URL: "http://localhost:3000",
  GATEWAY_API_KEY: "test-key",
};

describe("loadStudioConfigFromEnv", () => {
  it("applies documented defaults when only the required fields are set", () => {
    const config = loadStudioConfigFromEnv(VALID_ENV);
    expect(config.http).toEqual({ host: "0.0.0.0", port: 4000 });
    expect(config.gatewayUrl).toBe("http://localhost:3000");
    expect(config.gatewayApiKey).toBe("test-key");
    expect(config.studioAccessKey).toBeUndefined();
  });

  it("strips a trailing slash from GATEWAY_URL so proxied paths never double up", () => {
    const config = loadStudioConfigFromEnv({ ...VALID_ENV, GATEWAY_URL: "http://localhost:3000/" });
    expect(config.gatewayUrl).toBe("http://localhost:3000");
  });

  it("reads every overridable field from the environment", () => {
    const config = loadStudioConfigFromEnv({
      ...VALID_ENV,
      STUDIO_HOST: "127.0.0.1",
      STUDIO_PORT: "8080",
      STUDIO_ACCESS_KEY: "shh",
    });
    expect(config.http).toEqual({ host: "127.0.0.1", port: 8080 });
    expect(config.studioAccessKey).toBe("shh");
  });

  it("throws StudioConfigError when GATEWAY_URL is missing", () => {
    const env = { ...VALID_ENV };
    delete env.GATEWAY_URL;
    expect(() => loadStudioConfigFromEnv(env)).toThrow(StudioConfigError);
  });

  it("throws StudioConfigError when GATEWAY_URL is not a valid URL", () => {
    expect(() => loadStudioConfigFromEnv({ ...VALID_ENV, GATEWAY_URL: "not-a-url" })).toThrow(
      StudioConfigError,
    );
  });

  it("throws StudioConfigError when GATEWAY_API_KEY is missing", () => {
    const env = { ...VALID_ENV };
    delete env.GATEWAY_API_KEY;
    expect(() => loadStudioConfigFromEnv(env)).toThrow(StudioConfigError);
  });

  it("throws StudioConfigError when STUDIO_PORT is not a valid port", () => {
    expect(() => loadStudioConfigFromEnv({ ...VALID_ENV, STUDIO_PORT: "not-a-number" })).toThrow(
      StudioConfigError,
    );
    expect(() => loadStudioConfigFromEnv({ ...VALID_ENV, STUDIO_PORT: "99999" })).toThrow(
      StudioConfigError,
    );
  });
});
