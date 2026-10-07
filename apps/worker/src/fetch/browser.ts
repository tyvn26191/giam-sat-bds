// Tier 2: headless Chromium (playwright-core) for pages that need JavaScript. Only used when
// tier 1 could not read the property data. Every request the page makes (sub-resources,
// redirects, XHR) is checked against the SSRF rules; images/fonts/media are not downloaded
// unless a screenshot is wanted. No CAPTCHA solving, no stealth plugins, no fingerprint tricks.

import { validatePublicUrl } from '@gsb/shared';
import type { Browser } from 'playwright-core';
import { FetchError } from './errors';
import { resolvePublic, type Resolver } from './safe-lookup';

export interface BrowserPage {
  url: string;
  finalUrl: string;
  status: number;
  html: string;
  durationMs: number;
  screenshot: Buffer | null;
}

export interface BrowserOptions {
  userAgent: string;
  timeoutMs: number;
  maxBytes: number;
  executablePath?: string;
  resolver?: Resolver;
  idleCloseMs?: number;
}

export class BrowserFetcher {
  private browser: Promise<Browser> | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private active = 0;

  constructor(private readonly opts: BrowserOptions) {}

  private async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = import('playwright-core')
        .then((pw) =>
          pw.chromium.launch({
            headless: true,
            executablePath: this.opts.executablePath || undefined,
            args: ['--disable-dev-shm-usage', '--disable-gpu', '--no-first-run', '--mute-audio'],
          }),
        )
        .catch((e: Error) => {
          this.browser = null;
          throw new FetchError('BROWSER_FAILED', `cannot start Chromium: ${e.message.split('\n')[0]}`, false);
        });
    }
    return this.browser;
  }

  async fetch(url: string, { screenshot = false }: { screenshot?: boolean } = {}): Promise<BrowserPage> {
    const check = validatePublicUrl(url);
    if (!check.ok) throw new FetchError('INVALID_URL', check.reason, false);
    await resolvePublic(check.url.hostname, this.opts.resolver);

    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.active++;
    const started = Date.now();
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      userAgent: this.opts.userAgent,
      locale: 'ja-JP',
      timezoneId: 'Asia/Tokyo',
      viewport: { width: 1280, height: 900 },
      serviceWorkers: 'block',
      acceptDownloads: false,
    });
    try {
      const hostChecks = new Map<string, Promise<boolean>>();
      await context.route('**/*', async (route) => {
        const req = route.request();
        const type = req.resourceType();
        if (type === 'media' || type === 'websocket' || type === 'eventsource' || type === 'manifest') return route.abort();
        if (!screenshot && (type === 'image' || type === 'font')) return route.abort();
        const v = validatePublicUrl(req.url());
        if (!v.ok) return route.abort();
        let ok = hostChecks.get(v.url.hostname);
        if (!ok) {
          ok = resolvePublic(v.url.hostname, this.opts.resolver).then(
            () => true,
            () => false,
          );
          hostChecks.set(v.url.hostname, ok);
        }
        return (await ok) ? route.continue() : route.abort();
      });
      const page = await context.newPage();
      let response;
      try {
        response = await page.goto(check.url.toString(), { waitUntil: 'domcontentloaded', timeout: this.opts.timeoutMs });
      } catch (e) {
        const msg = (e as Error).message.split('\n')[0] ?? 'navigation failed';
        throw new FetchError(/timeout/i.test(msg) ? 'TIMEOUT' : 'BROWSER_FAILED', msg.slice(0, 300));
      }
      await page.waitForLoadState('networkidle', { timeout: Math.min(8000, this.opts.timeoutMs) }).catch(() => undefined);
      let html = await page.content();
      if (html.length > this.opts.maxBytes) html = html.slice(0, this.opts.maxBytes);
      const shot = screenshot ? await page.screenshot({ type: 'jpeg', quality: 60, fullPage: false }).catch(() => null) : null;
      return {
        url,
        finalUrl: page.url(),
        status: response?.status() ?? 0,
        html,
        durationMs: Date.now() - started,
        screenshot: shot,
      };
    } finally {
      await context.close().catch(() => undefined);
      this.active--;
      this.scheduleIdleClose();
    }
  }

  /** Free the ~300 MB Chromium uses when nothing needs it for a while. */
  private scheduleIdleClose(): void {
    if (this.active > 0) return;
    this.idleTimer = setTimeout(() => void this.close(), this.opts.idleCloseMs ?? 60_000);
    this.idleTimer.unref();
  }

  async close(): Promise<void> {
    const b = this.browser;
    this.browser = null;
    if (b) await (await b.catch(() => null))?.close().catch(() => undefined);
  }
}
