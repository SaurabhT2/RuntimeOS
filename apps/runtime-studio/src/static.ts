import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/**
 * Serves static files from `publicDir`. Deliberately minimal — no
 * directory listing, no range requests, no caching headers beyond the
 * defaults (this is a reference/development tool, not a CDN-fronted
 * production asset server). Resolves every request path against
 * `publicDir` and rejects anything that would escape it (`..`
 * traversal), falling back to `index.html` for any path with no file
 * extension so the Studio's single-page client-side routing (see
 * `public/app.js`) works on a hard refresh of a deep link like
 * `/pipeline`.
 */
export function serveStatic(req: IncomingMessage, res: ServerResponse, publicDir: string): void {
  const urlPath = (req.url ?? "/").split("?")[0] ?? "/";
  const hasExtension = extname(urlPath) !== "";
  const requestedPath = hasExtension ? urlPath : "/index.html";

  const resolvedPublicDir = resolve(publicDir);
  const candidate = resolve(join(resolvedPublicDir, normalize(requestedPath)));

  if (!candidate.startsWith(resolvedPublicDir)) {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("Bad request path.");
    return;
  }

  if (!existsSync(candidate) || !statSync(candidate).isFile()) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found.");
    return;
  }

  const contentType = CONTENT_TYPES[extname(candidate)] ?? "application/octet-stream";
  res.writeHead(200, { "content-type": contentType });
  createReadStream(candidate).pipe(res);
}
