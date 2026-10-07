import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ConsoleChannel } from '@gsb/notifications';
import { createDefaultRegistry } from '@gsb/parser';
import { DEFAULT_PROPERTY_SETTINGS, DEFAULT_USER_SETTINGS, type PropertySettings, type UserSettings } from '@gsb/shared';
import type { EngineDeps } from '../src/engine/check';
import { Notifier } from '../src/engine/notify';
import { newPropertyDoc, sanitizeSettings } from '../src/engine/property';
import { FetchError, type PageFetcher } from '../src/fetch';
import type { HttpResponse } from '../src/fetch/http';
import { silentLogger } from '../src/log';
import { HostLimiter } from '../src/rate-limit';
import { MemoryStore } from '../src/store/memory';

export const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../../packages/parser/fixtures/${name}`, import.meta.url)), 'utf8');

export const SUUMO_URL = 'https://suumo.jp/ikkodate/aichi/sc_nishio/nc_76543210/';

export type Route = { status: number; file?: string; html?: string } | { error: FetchError };

/** Scriptable fake network: set what a URL returns, count requests. */
export class FakeFetcher implements PageFetcher {
  readonly kind = 'FAKE' as const;
  routes = new Map<string, Route>();
  requests: string[] = [];
  robotsAllowed = true;
  browser?: PageFetcher['browser'];

  set(url: string, route: Route) {
    this.routes.set(url, route);
  }

  async http(url: string): Promise<HttpResponse> {
    this.requests.push(url);
    const r = this.routes.get(url) ?? { status: 404, html: '<html><body>Not Found</body></html>' };
    if ('error' in r) throw r.error;
    const html = r.html ?? (r.file ? fixture(r.file) : '');
    return {
      url,
      finalUrl: url,
      status: r.status,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: Buffer.from(html),
      contentType: 'text/html; charset=utf-8',
      durationMs: 1,
      redirects: 0,
    };
  }

  async robots() {
    return { allowed: this.robotsAllowed, crawlDelayMs: null };
  }
}

export class Clock {
  constructor(public t = Date.UTC(2026, 9, 7, 21, 0)) {}
  now = () => this.t;
  advance(ms: number) {
    this.t += ms;
  }
  sleep = async (ms: number) => {
    this.t += ms;
  };
}

export function makeDeps(opts: { store?: MemoryStore; fetcher?: FakeFetcher; clock?: Clock } = {}) {
  const store = opts.store ?? new MemoryStore();
  const fetcher = opts.fetcher ?? new FakeFetcher();
  const clock = opts.clock ?? new Clock();
  const telegram = new ConsoleChannel('TELEGRAM', () => {});
  const email = new ConsoleChannel('EMAIL', () => {});
  const notifier = new Notifier({
    store,
    channels: { TELEGRAM: telegram, EMAIL: email },
    dryRun: false,
    appUrl: 'https://watch.example.web.app',
    now: clock.now,
    logRetentionDays: 14,
    log: silentLogger,
  });
  const deps: EngineDeps = {
    store,
    fetcher,
    registry: createDefaultRegistry(),
    limiter: new HostLimiter({ global: 4, perHost: 1, minSpacingMs: 0, jitterMs: 0, now: clock.now, sleep: clock.sleep }),
    notifier,
    artifacts: null,
    log: silentLogger,
    config: { logChecks: 'all', logRetentionDays: 14, screenshots: false, saveHtml: false },
    now: clock.now,
    sleep: clock.sleep,
    rand: () => 0.5,
  };
  return { deps, store, fetcher, clock, telegram, email };
}

export async function addProperty(
  store: MemoryStore,
  clock: Clock,
  url = SUUMO_URL,
  settings: Partial<PropertySettings> = {},
  user: Partial<UserSettings> = {},
  ownerId = 'u1',
  id = `p_${store.properties.size + 1}`,
) {
  store.users.set(ownerId, {
    email: 'me@example.com',
    displayName: null,
    settings: { ...DEFAULT_USER_SETTINGS, telegram: { enabled: true, chatId: '123456' }, ...user },
    createdAt: 0,
    updatedAt: 0,
  });
  const doc = newPropertyDoc({ ownerId, url, settings: sanitizeSettings({ ...DEFAULT_PROPERTY_SETTINGS, ...settings }, 15), now: clock.now() });
  await store.createProperty(id, doc);
  return id;
}
