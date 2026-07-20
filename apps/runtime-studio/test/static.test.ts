import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serveStatic } from "../src/static.js";

describe("serveStatic", () => {
  let publicDir: string;
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    publicDir = mkdtempSync(join(tmpdir(), "runtime-studio-public-"));
    writeFileSync(join(publicDir, "index.html"), "<html>studio</html>");
    writeFileSync(join(publicDir, "app.js"), "console.log('hi');");

    server = createServer((req, res) => serveStatic(req, res, publicDir));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected a bound AddressInfo");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(publicDir, { recursive: true, force: true });
  });

  it("serves a real file with the correct content type", async () => {
    const res = await fetch(`${baseUrl}/app.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/javascript");
    expect(await res.text()).toBe("console.log('hi');");
  });

  it("falls back to index.html for extension-less paths (client-side routing)", async () => {
    const res = await fetch(`${baseUrl}/pipeline`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>studio</html>");
  });

  it("returns 404 for a real path that doesn't exist", async () => {
    const res = await fetch(`${baseUrl}/does-not-exist.css`);
    expect(res.status).toBe(404);
  });

  it("rejects path traversal attempts rather than escaping publicDir", async () => {
    const res = await fetch(`${baseUrl}/..%2f..%2f..%2fetc%2fpasswd`);
    expect([400, 404]).toContain(res.status);
  });
});
