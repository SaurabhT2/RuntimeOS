import { describe, expect, it } from "vitest";
import { Router } from "../../src/router.js";

describe("Router", () => {
  it("matches a registered method+path pair", () => {
    const router = new Router();
    const handler = () => {};
    router.register("POST", "/v1/execute", handler);
    expect(router.match("POST", "/v1/execute")).toBe(handler);
  });

  it("is case-insensitive on method", () => {
    const router = new Router();
    const handler = () => {};
    router.register("get", "/v1/health", handler);
    expect(router.match("GET", "/v1/health")).toBe(handler);
  });

  it("returns undefined for an unregistered path", () => {
    const router = new Router();
    router.register("GET", "/v1/health", () => {});
    expect(router.match("GET", "/nope")).toBeUndefined();
  });

  it("returns undefined for the right path but wrong method", () => {
    const router = new Router();
    router.register("GET", "/v1/health", () => {});
    expect(router.match("POST", "/v1/health")).toBeUndefined();
  });

  it("hasPath reports true regardless of method", () => {
    const router = new Router();
    router.register("GET", "/v1/health", () => {});
    expect(router.hasPath("/v1/health")).toBe(true);
    expect(router.hasPath("/nope")).toBe(false);
  });
});
