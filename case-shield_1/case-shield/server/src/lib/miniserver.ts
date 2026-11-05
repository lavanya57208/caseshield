import * as http from "http";
import fs from "fs";
import path from "path";
import { URL } from "url";

/**
 * A tiny, zero-dependency Express-alike used because this project runs with
 * no external npm packages (see README - the sandbox this was authored in
 * could not reach the npm registry). It intentionally mirrors the small
 * slice of the Express API this codebase actually uses: router.use(mw),
 * router.get/post/patch/delete(path, handler), req.params/query/body, and
 * res.status().json(). A real deployment can swap this for Express with no
 * change to route logic - the shapes match on purpose.
 */

export interface Req extends http.IncomingMessage {
  params: Record<string, string>;
  query: Record<string, string>;
  body: any;
  ip: string;
  path: string;
  user?: any;
}

export interface Res extends http.ServerResponse {
  status(code: number): Res;
  json(obj: unknown): void;
  send(body: string): void;
  download(filePath: string, filename: string): void;
}

export type NextFn = (err?: unknown) => void;
export type Handler = (req: Req, res: Res, next: NextFn) => void;

function compilePath(pattern: string): { regex: RegExp; keys: string[] } {
  const keys: string[] = [];
  const escaped = pattern
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) {
        keys.push(segment.slice(1));
        return "([^/]+)";
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { regex: new RegExp(`^${escaped}/?$`), keys };
}

function sendError(res: Res, err: unknown) {
  // eslint-disable-next-line no-console
  console.error(err);
  if (!res.headersSent) res.status(500).json({ error: "An unexpected error occurred." });
}

interface RouteDef {
  method: string;
  regex: RegExp;
  keys: string[];
  handlers: Handler[];
}

function runChain(handlers: Handler[], req: Req, res: Res, onDone: (err?: unknown) => void) {
  let i = 0;
  const next = (err?: unknown) => {
    if (err) return onDone(err);
    if (res.headersSent) return; // a handler already responded without calling next(); stop.
    if (i >= handlers.length) return onDone();
    const h = handlers[i++];
    try {
      h(req, res, next);
    } catch (e) {
      onDone(e);
    }
  };
  next();
}

export class RouterImpl {
  private middlewares: Handler[] = [];
  private routes: RouteDef[] = [];

  use(fn: Handler) {
    this.middlewares.push(fn);
  }
  get(routePath: string, ...handlers: Handler[]) {
    this.add("GET", routePath, handlers);
  }
  post(routePath: string, ...handlers: Handler[]) {
    this.add("POST", routePath, handlers);
  }
  patch(routePath: string, ...handlers: Handler[]) {
    this.add("PATCH", routePath, handlers);
  }
  delete(routePath: string, ...handlers: Handler[]) {
    this.add("DELETE", routePath, handlers);
  }
  private add(method: string, routePath: string, handlers: Handler[]) {
    const { regex, keys } = compilePath(routePath);
    this.routes.push({ method, regex, keys, handlers });
  }

  /** Dispatches a request already stripped of this router's mount prefix. */
  dispatch(req: Req, res: Res, relPath: string, onNoMatch: () => void) {
    let idx = 0;
    const runMiddlewares = () => {
      if (idx < this.middlewares.length) {
        const mw = this.middlewares[idx++];
        try {
          mw(req, res, (err) => (err ? sendError(res, err) : runMiddlewares()));
        } catch (e) {
          sendError(res, e);
        }
      } else {
        matchRoute();
      }
    };
    const matchRoute = () => {
      for (const r of this.routes) {
        if (r.method !== req.method) continue;
        const m = r.regex.exec(relPath);
        if (m) {
          const params: Record<string, string> = {};
          r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
          req.params = params;
          runChain(r.handlers, req, res, (err) => (err ? sendError(res, err) : undefined));
          return;
        }
      }
      onNoMatch();
    };
    runMiddlewares();
  }
}

interface Mount {
  prefix: string;
  router: RouterImpl;
}

export class App {
  private globalMiddlewares: Handler[] = [];
  private mounts: Mount[] = [];
  private directRoutes: RouteDef[] = [];
  private notFoundHandlers: Array<(req: Req, res: Res) => void> = [];
  private errorHandler: ((err: unknown, req: Req, res: Res, next: NextFn) => void) | null = null;

  use(pathOrFn: string | Handler, maybeRouter?: RouterImpl) {
    if (typeof pathOrFn === "function") {
      this.globalMiddlewares.push(pathOrFn);
    } else if (maybeRouter) {
      this.mounts.push({ prefix: pathOrFn.replace(/\/$/, ""), router: maybeRouter });
    }
  }

  get(routePath: string, ...handlers: Handler[]) {
    const { regex, keys } = compilePath(routePath);
    this.directRoutes.push({ method: "GET", regex, keys, handlers });
  }

  /** Registers a 4-arg error-handling middleware, Express-style. */
  useError(fn: (err: unknown, req: Req, res: Res, next: NextFn) => void) {
    this.errorHandler = fn;
  }

  listen(port: number, cb: () => void) {
    const server = http.createServer((rawReq, rawRes) => this.handle(rawReq, rawRes));
    server.listen(port, cb);
    return server;
  }

  private handle(rawReq: http.IncomingMessage, rawRes: http.ServerResponse) {
    const req = rawReq as Req;
    const res = rawRes as Res;

    res.status = function (code: number) {
      this.statusCode = code;
      return this as unknown as Res;
    };
    res.json = function (obj: unknown) {
      const body = JSON.stringify(obj);
      if (!this.getHeader("Content-Type")) this.setHeader("Content-Type", "application/json; charset=utf-8");
      this.end(body);
    };
    res.send = function (body: string) {
      this.end(body);
    };
    res.download = function (filePath: string, filename: string) {
      if (!fs.existsSync(filePath)) {
        this.status(404).json({ error: "File not found." });
        return;
      }
      this.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/"/g, "")}"`);
      const stream = fs.createReadStream(filePath);
      stream.pipe(this);
    };

    const url = new URL(req.url || "/", "http://localhost");
    req.path = url.pathname;
    req.query = Object.fromEntries(url.searchParams.entries());
    req.ip = (req.socket && req.socket.remoteAddress) || "unknown";
    req.params = {};

    // Basic CORS (safe default; same-origin in production since this server
    // also serves the built frontend).
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks);
      const contentType = req.headers["content-type"] || "";
      if (raw.length > 0 && contentType.includes("application/json")) {
        try {
          req.body = JSON.parse(raw.toString("utf-8"));
        } catch {
          res.status(400).json({ error: "Malformed JSON body." });
          return;
        }
      } else {
        req.body = {};
      }

      this.runGlobalMiddlewares(req, res, () => this.route(req, res));
    });
  }

  private runGlobalMiddlewares(req: Req, res: Res, done: () => void) {
    let idx = 0;
    const next = (err?: unknown) => {
      if (err) return this.handleError(err, req, res);
      if (idx < this.globalMiddlewares.length) {
        const mw = this.globalMiddlewares[idx++];
        try {
          mw(req, res, next);
        } catch (e) {
          this.handleError(e, req, res);
        }
      } else {
        done();
      }
    };
    next();
  }

  private route(req: Req, res: Res) {
    for (const r of this.directRoutes) {
      if (r.method !== req.method) continue;
      const m = r.regex.exec(req.path);
      if (m) {
        const params: Record<string, string> = {};
        r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
        req.params = params;
        runChain(r.handlers, req, res, (err) => (err ? this.handleError(err, req, res) : undefined));
        return;
      }
    }

    const mount = this.mounts.find((m) => req.path === m.prefix || req.path.startsWith(m.prefix + "/"));
    if (mount) {
      const relPath = req.path.slice(mount.prefix.length) || "/";
      mount.router.dispatch(req, res, relPath, () => this.notFound(res));
      return;
    }

    this.notFound(res);
  }

  private notFound(res: Res) {
    if (!res.headersSent) res.status(404).json({ error: "Not found." });
  }

  private handleError(err: unknown, req: Req, res: Res) {
    if (this.errorHandler) {
      this.errorHandler(err, req, res, () => sendError(res, err));
    } else {
      sendError(res, err);
    }
  }
}

export function createApp() {
  return new App();
}

/** Express-style factory: `const router = Router();` (no `new`). */
export function Router(): RouterImpl {
  return new RouterImpl();
}
export type Router = RouterImpl;

/** Serves a compiled static frontend directory with SPA fallback to index.html. */
export function serveStatic(rootDir: string): Handler {
  const MIME: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
  };
  return (req, res, next) => {
    if (req.method !== "GET") return next();
    if (req.path.startsWith("/api/")) return next();

    let filePath = path.join(rootDir, decodeURIComponent(req.path));
    if (!filePath.startsWith(rootDir)) return next();
    if (req.path === "/" || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(rootDir, "index.html");
    }
    if (!fs.existsSync(filePath)) return next();

    const ext = path.extname(filePath);
    res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
    fs.createReadStream(filePath).pipe(res);
  };
}
