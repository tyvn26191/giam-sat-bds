// Fetch a property page (HTTP first, browser only when needed) and classify the result.

import { decodeHtml, type AdapterRegistry, type ParseResult, type PageInput } from '@gsb/parser';
import { validatePublicUrl, type CustomSelectors, type FetchMethod, type MonitorMode } from '@gsb/shared';
import { FetchError, type PageFetcher } from '../fetch';
import { classifyNodeError } from '../fetch/errors';
import type { HostLimiter } from '../rate-limit';

export type ObservationOutcome = 'OK' | 'NOT_MODIFIED' | 'REMOVED' | 'BLOCKED' | 'ERROR';

export interface Observation {
  outcome: ObservationOutcome;
  method: FetchMethod | null;
  httpStatus: number | null;
  finalUrl: string;
  parse: ParseResult | null;
  error: { code: string; message: string; transient: boolean } | null;
  usedBrowser: boolean;
  httpCache: { etag: string | null; lastModified: string | null } | null;
  retryAfterMs: number | null;
  durationMs: number;
  html: string | null;
}

export interface ObserveTarget {
  url: string;
  monitorMode: MonitorMode;
  selectors: CustomSelectors | null;
  httpCache: { etag: string | null; lastModified: string | null } | null;
  needsBrowser: boolean;
}

export interface ObserveDeps {
  fetcher: PageFetcher;
  registry: AdapterRegistry;
  limiter: HostLimiter;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

export interface ObserveOptions {
  /** Retry a transient failure once after 30 s inside this call (scheduled runs). */
  inlineRetry: boolean;
  /** Absolute time after which no inline retry is started. */
  deadline: number;
}

export const INLINE_RETRY_MS = 30_000;

function parseRetryAfter(v: string | undefined, now: number): number | null {
  if (!v) return null;
  if (/^\d+$/.test(v.trim())) return Math.min(6 * 3600_000, parseInt(v, 10) * 1000);
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, Math.min(6 * 3600_000, t - now)) : null;
}

export async function observe(target: ObserveTarget, deps: ObserveDeps, opts: ObserveOptions): Promise<Observation> {
  const started = deps.now();
  const base = (o: Partial<Observation>): Observation => ({
    outcome: 'ERROR',
    method: null,
    httpStatus: null,
    finalUrl: target.url,
    parse: null,
    error: null,
    usedBrowser: false,
    httpCache: null,
    retryAfterMs: null,
    html: null,
    ...o,
    durationMs: deps.now() - started,
  });
  const fail = (code: string, message: string, transient: boolean, extra: Partial<Observation> = {}) =>
    base({ outcome: 'ERROR', error: { code, message, transient }, ...extra });

  const v = validatePublicUrl(target.url);
  if (!v.ok) return fail('INVALID_URL', v.reason, false);
  const url = v.url;
  const adapter = deps.registry.forUrl(url);
  const parseOptions = { mode: target.monitorMode, selectors: target.selectors };

  try {
    const decision = await deps.fetcher.robots(url);
    if (decision.crawlDelayMs) deps.limiter.setMinSpacing(url.host, decision.crawlDelayMs);
    if (!decision.allowed) {
      return base({ outcome: 'BLOCKED', error: { code: 'ROBOTS_DISALLOWED', message: 'robots.txt không cho phép truy cập URL này', transient: false } });
    }
  } catch (e) {
    return fail('ROBOTS_UNREACHABLE', (e as Error).message, true);
  }

  const fromPage = (page: PageInput, cache: Observation['httpCache'], usedBrowser: boolean): Observation => {
    let parse: ParseResult;
    try {
      parse = adapter.parse(page, parseOptions);
    } catch (e) {
      return fail('PARSE_FAILED', `parser crashed: ${(e as Error).message}`, false, { method: page.method, httpStatus: page.status, usedBrowser });
    }
    const common = { method: page.method, httpStatus: page.status, finalUrl: page.finalUrl, parse, httpCache: cache, usedBrowser, html: page.html };
    switch (parse.state) {
      case 'OK':
        return base({ outcome: 'OK', ...common });
      case 'REMOVED':
        return base({ outcome: 'REMOVED', ...common, error: { code: 'PAGE_REMOVED', message: parse.stateReason ?? 'listing removed', transient: false } });
      case 'BLOCKED':
        return base({ outcome: 'BLOCKED', ...common, error: { code: 'CAPTCHA', message: `Trang yêu cầu xác minh / chặn bot: ${parse.stateReason ?? ''}`, transient: false } });
      case 'NEEDS_BROWSER':
        return base({ outcome: 'ERROR', ...common, error: { code: 'JS_REQUIRED', message: `Trang cần JavaScript (${parse.stateReason})`, transient: false } });
      default:
        return base({ outcome: 'ERROR', ...common, error: { code: 'PARSE_FAILED', message: parse.stateReason ?? 'no property data', transient: false } });
    }
  };

  const byStatus = (status: number, page: PageInput, cache: Observation['httpCache'], retryAfter: string | undefined, usedBrowser: boolean): Observation => {
    const extra = { method: page.method, httpStatus: status, finalUrl: page.finalUrl, usedBrowser };
    if (status === 304) return base({ outcome: 'NOT_MODIFIED', httpCache: cache, ...extra });
    if (status === 404 || status === 410) return base({ outcome: 'REMOVED', error: { code: `HTTP_${status}`, message: `HTTP ${status}`, transient: false }, ...extra });
    if (status === 401 || status === 403) return base({ outcome: 'BLOCKED', error: { code: `HTTP_${status}`, message: `HTTP ${status} — truy cập bị từ chối`, transient: false }, ...extra });
    if (status === 429) {
      return fail('HTTP_429', 'HTTP 429 Too Many Requests', true, { ...extra, retryAfterMs: parseRetryAfter(retryAfter, deps.now()) ?? 30 * 60_000 });
    }
    if (status >= 500) return fail('HTTP_5XX', `HTTP ${status}`, true, extra);
    if (status < 200 || status >= 300) return fail('HTTP_ERROR', `HTTP ${status}`, false, extra);
    return fromPage(page, cache, usedBrowser);
  };

  const viaHttp = async (): Promise<Observation> => {
    try {
      const res = await deps.limiter.run(url.host, () => deps.fetcher.http(url.toString(), target.httpCache ?? undefined));
      const method: FetchMethod = deps.fetcher.kind === 'MOCK' ? 'MOCK' : 'HTTP';
      const cache = { etag: res.headers.etag ?? null, lastModified: res.headers['last-modified'] ?? null };
      const html = res.status === 304 ? '' : decodeHtml(res.body, res.contentType);
      return byStatus(res.status, { url: url.toString(), finalUrl: res.finalUrl, status: res.status, html, method }, cache, res.headers['retry-after'], false);
    } catch (e) {
      const fe = e instanceof FetchError ? e : classifyNodeError(e);
      return fail(fe.code, fe.message, fe.transient, { method: 'HTTP' });
    }
  };

  const viaBrowser = async (): Promise<Observation> => {
    try {
      const p = await deps.limiter.run(url.host, () => deps.fetcher.browser!(url.toString()));
      return byStatus(p.status, { url: url.toString(), finalUrl: p.finalUrl, status: p.status, html: p.html, method: 'BROWSER' }, null, undefined, true);
    } catch (e) {
      const fe = e instanceof FetchError ? e : classifyNodeError(e);
      return fail(fe.code, `browser: ${fe.message}`, fe.transient, { method: 'BROWSER', usedBrowser: true });
    }
  };

  const once = async (): Promise<Observation> => {
    const browserAvailable = !!deps.fetcher.browser;
    if (browserAvailable && (target.needsBrowser || adapter.prefersBrowser?.(url))) {
      const b = await viaBrowser();
      if (b.outcome !== 'ERROR' || b.error?.code !== 'BROWSER_FAILED') return b;
    }
    const h = await viaHttp();
    const jsLike = h.outcome === 'ERROR' && (h.error?.code === 'JS_REQUIRED' || h.error?.code === 'PARSE_FAILED');
    if (jsLike && browserAvailable) {
      const b = await viaBrowser();
      if (b.outcome === 'OK' || b.outcome === 'REMOVED' || b.outcome === 'BLOCKED') return b;
      return { ...h, error: { ...h.error!, message: `${h.error!.message}; ${b.error?.message ?? 'browser: no data'}` }, usedBrowser: true };
    }
    if (jsLike && h.error?.code === 'JS_REQUIRED') {
      return { ...h, error: { ...h.error!, message: `${h.error!.message}. Tầng Playwright đang tắt (ENABLE_BROWSER=false).` } };
    }
    return h;
  };

  let result = await once();
  if (result.outcome === 'ERROR' && result.error?.transient && result.error.code !== 'HTTP_429' && opts.inlineRetry && deps.now() + INLINE_RETRY_MS + 30_000 < opts.deadline) {
    await deps.sleep(INLINE_RETRY_MS);
    result = await once();
  }
  return { ...result, durationMs: deps.now() - started };
}
