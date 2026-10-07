import type { BrowserFetcher, BrowserPage } from './browser';
import { httpGet, type HttpResponse } from './http';
import type { MockSites } from './mock';
import { RobotsChecker, type RobotsDecision, type RobotsPolicy } from './robots';

export { FetchError, type FetchErrorCode } from './errors';
export type { BrowserPage } from './browser';
export type { HttpResponse } from './http';
export { RobotsUnavailableError } from './robots';

/** What the engine needs from the network. Tests and dev mode plug in fakes. */
export interface PageFetcher {
  readonly kind: 'NETWORK' | 'MOCK' | 'FAKE';
  http(url: string, cache?: { etag?: string | null; lastModified?: string | null }): Promise<HttpResponse>;
  /** Undefined when the browser tier is disabled. */
  browser?: (url: string, opts?: { screenshot?: boolean }) => Promise<BrowserPage>;
  robots(url: URL): Promise<RobotsDecision>;
}

export interface NetworkFetcherOptions {
  userAgent: string;
  agentToken: string;
  httpTimeoutMs: number;
  maxBytes: number;
  browser: BrowserFetcher | null;
  now: () => number;
  loadRobots?: (host: string) => Promise<RobotsPolicy | null>;
  saveRobots?: (host: string, p: RobotsPolicy) => Promise<void>;
}

export function createNetworkFetcher(o: NetworkFetcherOptions): PageFetcher {
  const robots = new RobotsChecker({
    agentToken: o.agentToken,
    now: o.now,
    load: o.loadRobots,
    save: o.saveRobots,
    fetchText: async (url) => {
      const r = await httpGet(url, { timeoutMs: 10_000, maxBytes: 512 * 1024, userAgent: o.userAgent, accept: 'text/plain,*/*;q=0.5' });
      return { status: r.status, body: r.body.toString('utf8') };
    },
  });
  return {
    kind: 'NETWORK',
    http: (url, cache) =>
      httpGet(url, {
        timeoutMs: o.httpTimeoutMs,
        maxBytes: o.maxBytes,
        userAgent: o.userAgent,
        etag: cache?.etag,
        lastModified: cache?.lastModified,
        allowedTypes: /text\/html|application\/xhtml\+xml|text\/plain/,
      }),
    browser: o.browser ? (url, opts) => o.browser!.fetch(url, opts) : undefined,
    robots: (url) => robots.check(url),
  };
}

export function createMockFetcher(sites: MockSites): PageFetcher {
  return {
    kind: 'MOCK',
    http: async (url) => sites.get(url),
    robots: async () => ({ allowed: true, crawlDelayMs: null }),
  };
}
