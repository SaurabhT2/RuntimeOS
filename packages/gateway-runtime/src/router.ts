import type { IncomingMessage, ServerResponse } from "node:http";

export type RouteHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

interface Route {
  method: string;
  path: string;
  handler: RouteHandler;
}

/** A deliberately tiny method+exact-path router — the gateway's four fixed routes (architecture §10.2, §41.3), no path parameters, no framework dependency. Hosting-lifecycle-agnostic: works identically whether the caller is a real `http.Server`'s request listener or a Vercel Function handler. */
export class Router {
  private readonly routes: Route[] = [];

  register(method: string, path: string, handler: RouteHandler): void {
    this.routes.push({ method: method.toUpperCase(), path, handler });
  }

  /** Returns the matching handler, or `undefined` if nothing matches this exact method+path pair. Distinguishing "no path matches" from "path matches, wrong method" is the caller's job (`dispatchGatewayRequest`), so this only reports a clean hit or miss. */
  match(method: string, path: string): RouteHandler | undefined {
    const found = this.routes.find((r) => r.method === method.toUpperCase() && r.path === path);
    return found?.handler;
  }

  /** Whether `path` matches any registered route regardless of method — used to distinguish 404 from 405. */
  hasPath(path: string): boolean {
    return this.routes.some((r) => r.path === path);
  }
}
