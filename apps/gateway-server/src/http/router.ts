import type { IncomingMessage, ServerResponse } from "node:http";

export type RouteHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

interface Route {
  method: string;
  path: string;
  handler: RouteHandler;
}

/**
 * A deliberately tiny method+exact-path router. This milestone's REST
 * surface (Blueprint §7 EM-5's "Features delivered" line: `/v1/execute`,
 * `/v1/execute/stream`) plus `/v1/health` (this milestone's own Health &
 * Operational Endpoints requirement) is three fixed routes with no path
 * parameters — a routing library (Express/Fastify/etc.) would add a new
 * dependency and a new layer of indirection for a problem three `if`
 * branches already solve exactly as well. No framework is named anywhere
 * in the architecture spec or Engineering Blueprint for this package, so
 * this is a designed-here choice, following the same "smallest thing that
 * satisfies the named scope" precedent set throughout this codebase (e.g.
 * `orchestrator`'s hand-rolled candidate loop over a state-machine
 * library). A future milestone adding path parameters or many more routes
 * (`/v1/tasks`, `/v1/usage`, `/v1/credentials` — architecture §10.2, not
 * named in this milestone's own scope; see this package's README, Scope
 * Verification) is a reasonable point to reconsider this, additively —
 * not a redesign of what exists today.
 */
export class Router {
  private readonly routes: Route[] = [];

  register(method: string, path: string, handler: RouteHandler): void {
    this.routes.push({ method: method.toUpperCase(), path, handler });
  }

  /** Returns the matching handler, or `undefined` if nothing matches this exact method+path pair. Distinguishing "no path matches" from "path matches, wrong method" is the caller's job (`server.ts`), so this only reports a clean hit or miss. */
  match(method: string, path: string): RouteHandler | undefined {
    const found = this.routes.find((r) => r.method === method.toUpperCase() && r.path === path);
    return found?.handler;
  }

  /** Whether `path` matches any registered route regardless of method — used to distinguish 404 from 405. */
  hasPath(path: string): boolean {
    return this.routes.some((r) => r.path === path);
  }
}
