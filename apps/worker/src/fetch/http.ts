// Tier 1: plain HTTP GET with SSRF protection on every hop, a total timeout, a size cap and
// transparent decompression. No cookies, no JavaScript.

import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import type { Readable } from 'node:stream';
import { validatePublicUrl } from '@gsb/shared';
import { FetchError, classifyNodeError } from './errors';
import { createSafeLookup, type Resolver } from './safe-lookup';

export interface HttpGetOptions {
  timeoutMs: number;
  maxBytes: number;
  userAgent: string;
  maxRedirects?: number;
  etag?: string | null;
  lastModified?: string | null;
  accept?: string;
  /** Content types accepted for 2xx responses. */
  allowedTypes?: RegExp;
  resolver?: Resolver;
  /** Tests only (local HTTP server). Never set from configuration. */
  unsafeAllowPrivateNetwork?: boolean;
}

export interface HttpResponse {
  url: string;
  finalUrl: string;
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  contentType: string | null;
  durationMs: number;
  redirects: number;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function flatHeaders(h: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) if (v !== undefined) out[k] = Array.isArray(v) ? v.join(', ') : v;
  return out;
}

function decompress(res: http.IncomingMessage): Readable {
  const enc = (res.headers['content-encoding'] ?? '').toLowerCase().trim();
  if (enc === 'gzip' || enc === 'x-gzip') return res.pipe(zlib.createGunzip());
  if (enc === 'deflate') return res.pipe(zlib.createInflate());
  if (enc === 'br') return res.pipe(zlib.createBrotliDecompress());
  return res;
}

function requestOnce(
  url: URL,
  headers: Record<string, string>,
  opts: HttpGetOptions,
  signal: AbortSignal,
): Promise<{ status: number; headers: Record<string, string>; body: Buffer; location: string | null }> {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(
      url,
      { method: 'GET', headers, lookup: opts.unsafeAllowPrivateNetwork ? undefined : (createSafeLookup(opts.resolver) as never), signal, agent: false },
      (res) => {
        const status = res.statusCode ?? 0;
        const h = flatHeaders(res.headers);
        if (REDIRECTS.has(status) && h.location) {
          res.resume();
          resolve({ status, headers: h, body: Buffer.alloc(0), location: h.location });
          return;
        }
        const ctype = (h['content-type'] ?? '').toLowerCase();
        if (status >= 200 && status < 300 && opts.allowedTypes && ctype && !opts.allowedTypes.test(ctype)) {
          res.destroy();
          reject(new FetchError('UNSUPPORTED_CONTENT', `content-type ${ctype}`, false));
          return;
        }
        const len = Number(h['content-length'] ?? 0);
        if (len > opts.maxBytes * 4) {
          res.destroy();
          reject(new FetchError('TOO_LARGE', `content-length ${len}`, false));
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        const stream = decompress(res);
        stream.on('data', (c: Buffer) => {
          total += c.length;
          if (total > opts.maxBytes) {
            stream.destroy();
            res.destroy();
            reject(new FetchError('TOO_LARGE', `body > ${opts.maxBytes} bytes`, false));
            return;
          }
          chunks.push(c);
        });
        stream.on('end', () => resolve({ status, headers: h, body: Buffer.concat(chunks), location: null }));
        stream.on('error', (e) => reject(classifyNodeError(e)));
      },
    );
    req.on('error', (e) => reject(classifyNodeError(e)));
    req.end();
  });
}

export async function httpGet(rawUrl: string, opts: HttpGetOptions): Promise<HttpResponse> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  const headers: Record<string, string> = {
    'user-agent': opts.userAgent,
    accept: opts.accept ?? 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
    'accept-language': 'ja,en;q=0.7',
    'accept-encoding': 'gzip, deflate, br',
  };
  if (opts.etag) headers['if-none-match'] = opts.etag;
  if (opts.lastModified) headers['if-modified-since'] = opts.lastModified;

  let current = rawUrl;
  try {
    for (let hop = 0; hop <= (opts.maxRedirects ?? 5); hop++) {
      const check = opts.unsafeAllowPrivateNetwork ? { ok: true as const, url: new URL(current) } : validatePublicUrl(current);
      if (!check.ok) throw new FetchError(hop === 0 ? 'INVALID_URL' : 'SSRF_BLOCKED', check.reason, false);
      let r;
      try {
        r = await requestOnce(check.url, headers, opts, controller.signal);
      } catch (e) {
        if (controller.signal.aborted) throw new FetchError('TIMEOUT', `timeout after ${opts.timeoutMs} ms`);
        throw classifyNodeError(e);
      }
      if (r.location) {
        current = new URL(r.location, check.url).toString();
        // Conditional headers only apply to the original URL.
        delete headers['if-none-match'];
        delete headers['if-modified-since'];
        continue;
      }
      return {
        url: rawUrl,
        finalUrl: current,
        status: r.status,
        headers: r.headers,
        body: r.body,
        contentType: r.headers['content-type'] ?? null,
        durationMs: Date.now() - started,
        redirects: hop,
      };
    }
    throw new FetchError('TOO_MANY_REDIRECTS', 'too many redirects', false);
  } finally {
    clearTimeout(timer);
  }
}
