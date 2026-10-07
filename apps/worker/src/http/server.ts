// Minimal HTTP layer on node:http: routing, JSON bodies (size-capped), auth guards, per-user
// rate limits, CORS for local development, consistent JSON errors.

import http from 'node:http';
import type { Logger } from '../log';
import type { AuthUser } from './auth';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly extra: Record<string, unknown> = {}) {
    super(message);
  }
}

export type Guard = 'public' | 'user' | 'member' | 'admin' | 'task' | 'dev';

export interface RequestContext {
  req: http.IncomingMessage;
  params: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, unknown>;
  user: AuthUser | null;
}

export interface Route {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  guard: Guard;
  /** Requests per minute per user. */
  rate?: number;
  handler: (ctx: RequestContext) => Promise<unknown>;
}

export interface ServerOptions {
  routes: Route[];
  verifyUser: (authorization: string | undefined) => Promise<AuthUser | null>;
  verifyTask: (authorization: string | undefined) => Promise<boolean>;
  devMode: boolean;
  corsOrigins: string[];
  log: Logger;
  now?: () => number;
}

const MAX_BODY = 64 * 1024;

function compile(path: string): { re: RegExp; keys: string[] } {
  const keys: string[] = [];
  const re = new RegExp(
    `^${path.replace(/:([a-zA-Z]+)/g, (_, k: string) => {
      keys.push(k);
      return '([A-Za-z0-9_-]{1,128})';
    })}$`,
  );
  return { re, keys };
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  if (req.method === 'GET' || req.method === 'DELETE') return {};
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new ApiError(413, 'BODY_TOO_LARGE', 'Request body too large');
    chunks.push(c as Buffer);
  }
  if (size === 0) return {};
  if (!/application\/json/i.test(req.headers['content-type'] ?? '')) throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Expected application/json');
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
    return v as Record<string, unknown>;
  } catch {
    throw new ApiError(400, 'BAD_JSON', 'Invalid JSON body');
  }
}

export function createServer(opts: ServerOptions): http.Server {
  const now = opts.now ?? Date.now;
  const compiled = opts.routes.map((r) => ({ ...r, ...compile(r.path) }));
  const windows = new Map<string, { count: number; resetAt: number }>();

  const rateLimit = (key: string, perMinute: number) => {
    const t = now();
    const w = windows.get(key);
    if (!w || w.resetAt <= t) {
      windows.set(key, { count: 1, resetAt: t + 60_000 });
      if (windows.size > 10_000) for (const [k, v] of windows) if (v.resetAt <= t) windows.delete(k);
      return;
    }
    if (++w.count > perMinute) throw new ApiError(429, 'RATE_LIMITED', 'Quá nhiều yêu cầu, vui lòng thử lại sau một phút');
  };

  return http.createServer(async (req, res) => {
    const started = now();
    const send = (status: number, body: unknown) => {
      if (res.headersSent) return;
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
      res.end(JSON.stringify(body));
    };
    const origin = req.headers.origin;
    if (origin && opts.corsOrigins.includes(origin.toLowerCase())) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'origin');
      res.setHeader('access-control-allow-headers', 'authorization, content-type');
      res.setHeader('access-control-allow-methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', 'http://localhost');
    let route: (typeof compiled)[number] | undefined;
    let params: Record<string, string> = {};
    let pathMatched = false;
    for (const r of compiled) {
      const m = r.re.exec(url.pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== req.method) continue;
      route = r;
      params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]!]));
      break;
    }
    try {
      if (!route) throw new ApiError(pathMatched ? 405 : 404, pathMatched ? 'METHOD_NOT_ALLOWED' : 'NOT_FOUND', 'Not found');
      let user: AuthUser | null = null;
      switch (route.guard) {
        case 'task':
          if (!(await opts.verifyTask(req.headers.authorization))) throw new ApiError(401, 'UNAUTHENTICATED', 'Task token required');
          break;
        case 'dev':
          if (!opts.devMode) throw new ApiError(404, 'NOT_FOUND', 'Not found');
          break;
        case 'public':
          break;
        default:
          user = await opts.verifyUser(req.headers.authorization);
          if (!user) throw new ApiError(401, 'UNAUTHENTICATED', 'Bạn cần đăng nhập');
          if (route.guard === 'member' && user.role !== 'member' && user.role !== 'admin') {
            throw new ApiError(403, 'NOT_APPROVED', 'Tài khoản chưa được admin cấp quyền');
          }
          if (route.guard === 'admin' && user.role !== 'admin') throw new ApiError(403, 'FORBIDDEN', 'Chỉ dành cho admin');
          if (route.rate) rateLimit(`${user.uid}:${route.method}:${route.path}`, route.rate);
      }
      const body = await readJson(req);
      const result = await route.handler({ req, params, query: url.searchParams, body, user });
      send(200, result ?? { ok: true });
    } catch (e) {
      if (e instanceof ApiError) {
        send(e.status, { error: e.code, message: e.message, ...e.extra });
      } else {
        opts.log.error('unhandled API error', { path: url.pathname, error: (e as Error).message, stack: (e as Error).stack?.split('\n').slice(0, 4).join(' | ') });
        send(500, { error: 'INTERNAL', message: 'Lỗi máy chủ' });
      }
    } finally {
      if (url.pathname !== '/healthz') opts.log.debug('http', { method: req.method, path: url.pathname, status: res.statusCode, ms: now() - started });
    }
  });
}
