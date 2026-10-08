// Route handlers. Every handler re-checks ownership server-side; nothing relies on the UI.

import { isValidChatId, isValidEmail } from '@gsb/notifications';
import {
  SITE_LABELS,
  normalizeUrl,
  validatePublicUrl,
  withUserDefaults,
  type CheckSummary,
  type CreatePropertyResponse,
  type MeResponse,
  type NotificationChannelId,
  type PropertySettings,
  type Role,
  type TestNotificationResponse,
  type UrlPreview,
} from '@gsb/shared';
import type { ArtifactStore } from '../artifacts';
import { emailListed, type WorkerConfig } from '../config';
import { runCheck, type EngineDeps } from '../engine/check';
import { observe } from '../engine/observe';
import { newPropertyDoc, resetForNewUrl, sanitizeSettings } from '../engine/property';
import { runDue, runForOwner, type RunnerConfig } from '../engine/runner';
import type { MockSites } from '../fetch/mock';
import type { PropertyRecord, Store } from '../store/types';
import type { AuthUser } from './auth';
import { ApiError, type Route } from './server';

export interface ApiDeps {
  cfg: WorkerConfig;
  engine: EngineDeps;
  store: Store;
  runner: RunnerConfig;
  setRole: (uid: string, claims: Record<string, unknown>, role: Role | null) => Promise<void>;
  artifacts: ArtifactStore | null;
  mock: MockSites | null;
  now: () => number;
}

const API_BUDGET_MS = 40_000; // Firebase Hosting → Cloud Run rewrites time out at 60 s
const MANUAL_MIN_INTERVAL_MS = 60_000;

function requireUrl(raw: unknown): string {
  if (typeof raw !== 'string') throw new ApiError(400, 'INVALID_URL', 'Thiếu URL');
  const v = validatePublicUrl(raw);
  if (!v.ok) throw new ApiError(400, 'INVALID_URL', v.reason);
  return normalizeUrl(v.url);
}

async function ownProperty(store: Store, user: AuthUser, id: string): Promise<PropertyRecord> {
  const rec = await store.getProperty(id);
  if (!rec || (rec.data.ownerId !== user.uid && user.role !== 'admin')) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy property');
  return rec;
}

export function buildRoutes(d: ApiDeps): Route[] {
  const deadline = () => d.now() + API_BUDGET_MS;

  const me = async (user: AuthUser): Promise<MeResponse> => {
    let role = user.role;
    if (user.email && user.emailVerified) {
      if (emailListed(d.cfg.adminEmails, user.email)) role = 'admin';
      else if (!role && emailListed(d.cfg.memberEmails, user.email)) role = 'member';
    }
    const claimsUpdated = role !== user.role;
    if (claimsUpdated) await d.setRole(user.uid, user.claims, role);
    if (role) await d.store.ensureUser(user.uid, user.email, d.now());
    const notifier = d.engine.notifier;
    return {
      uid: user.uid,
      email: user.email,
      emailVerified: user.emailVerified,
      role,
      claimsUpdated,
      features: {
        browser: !!d.engine.fetcher.browser,
        screenshots: d.cfg.screenshots && !!d.artifacts && !!d.engine.fetcher.browser,
        telegram: notifier.isConfigured('TELEGRAM'),
        email: notifier.isConfigured('EMAIL'),
      },
    };
  };

  const preview = async (user: AuthUser, body: Record<string, unknown>): Promise<UrlPreview> => {
    const url = requireUrl(body.url);
    const sel = sanitizeSettings({ selectors: body.selectors as PropertySettings['selectors'] }, 15).selectors;
    const adapter = d.engine.registry.forUrl(url);
    const obs = await observe(
      { url, monitorMode: 'IMPORTANT', selectors: sel, httpCache: null, needsBrowser: false },
      { fetcher: d.engine.fetcher, registry: d.engine.registry, limiter: d.engine.limiter, now: d.now, sleep: d.engine.sleep },
      { inlineRetry: false, deadline: deadline() },
    );
    const p = obs.parse;
    const dup = await d.store.findByUrl(user.uid, url);
    return {
      url,
      finalUrl: obs.finalUrl,
      site: p?.site ?? adapter.id,
      siteLabel: SITE_LABELS[p?.site ?? adapter.id],
      parser: p?.parser ?? `${adapter.id.toLowerCase()}@${adapter.version}`,
      method: obs.method,
      httpStatus: obs.httpStatus,
      outcome: obs.outcome === 'NOT_MODIFIED' ? 'OK' : obs.outcome,
      errorCode: obs.error?.code ?? null,
      errorMessage: obs.error?.message ?? null,
      title: p?.title?.value ?? null,
      price: p?.price?.value ?? null,
      priceDisplay: p?.price?.display ?? null,
      priceRaw: p?.price?.raw ?? null,
      address: p?.address?.value ?? null,
      propertyCode: p?.propertyCode ?? null,
      imageUrl: p?.imageUrl ?? null,
      fields: p?.fields ?? {},
      confidence: p?.confidence ?? { price: 0, title: 0, address: 0, overall: 0 },
      needsReview: p?.needsReview ?? false,
      reviewReasons: p?.reviewReasons ?? [],
      durationMs: obs.durationMs,
      duplicateOf: dup ? { propertyId: dup.id } : null,
    };
  };

  const check = (rec: PropertyRecord, trigger: 'MANUAL' | 'CREATE'): Promise<CheckSummary> =>
    runCheck(rec, d.engine, { trigger, runId: `${trigger.toLowerCase()}_${rec.id}_${d.now()}`, inlineRetry: false, deadline: deadline() });

  return [
    // Cloud Run reserves /healthz at its front end; /health is the reachable one.
    { method: 'GET', path: '/health', guard: 'public', handler: async () => ({ ok: true }) },
    { method: 'GET', path: '/healthz', guard: 'public', handler: async () => ({ ok: true }) },

    { method: 'GET', path: '/api/me', guard: 'user', rate: 30, handler: async ({ user }) => me(user!) },

    { method: 'POST', path: '/api/test-url', guard: 'member', rate: 10, handler: async ({ user, body }) => preview(user!, body) },

    {
      method: 'POST',
      path: '/api/properties',
      guard: 'member',
      rate: 20,
      handler: async ({ user, body }): Promise<CreatePropertyResponse> => {
        const url = requireUrl(body.url);
        const dup = await d.store.findByUrl(user!.uid, url);
        if (dup) throw new ApiError(409, 'DUPLICATE', 'URL này đã được theo dõi', { propertyId: dup.id });
        if ((await d.store.countByOwner(user!.uid)) >= d.cfg.maxPropertiesPerUser) {
          throw new ApiError(403, 'LIMIT', `Tối đa ${d.cfg.maxPropertiesPerUser} property mỗi người`);
        }
        const settings = withUserDefaults((await d.store.getUser(user!.uid))?.settings);
        const id = d.store.newId();
        const now = d.now();
        const doc = newPropertyDoc({ ownerId: user!.uid, url, settings: sanitizeSettings(body.settings as Partial<PropertySettings>, settings.defaultIntervalMin), now });
        await d.store.createProperty(id, doc);
        const rec = await d.store.getProperty(id);
        const summary = rec && doc.enabled ? await check(rec, 'CREATE').catch(() => null) : null;
        return { id, check: summary };
      },
    },

    {
      method: 'PATCH',
      path: '/api/properties/:id/url',
      guard: 'member',
      rate: 20,
      handler: async ({ user, params, body }) => {
        const rec = await ownProperty(d.store, user!, params.id!);
        const url = requireUrl(body.url);
        if (url === rec.data.url) return { id: rec.id, check: null };
        const dup = await d.store.findByUrl(rec.data.ownerId, url);
        if (dup && dup.id !== rec.id) throw new ApiError(409, 'DUPLICATE', 'URL này đã được theo dõi', { propertyId: dup.id });
        await d.store.updateProperty(rec.id, resetForNewUrl(url, d.now()));
        const fresh = await d.store.getProperty(rec.id);
        return { id: rec.id, check: fresh && fresh.data.enabled ? await check(fresh, 'MANUAL') : null };
      },
    },

    {
      method: 'DELETE',
      path: '/api/properties/:id',
      guard: 'member',
      rate: 30,
      handler: async ({ user, params }) => {
        const rec = await ownProperty(d.store, user!, params.id!);
        await d.store.deleteProperty(rec.id);
        for (const m of rec.data.matches ?? []) {
          const other = await d.store.getProperty(m.propertyId);
          if (other) await d.store.updateProperty(other.id, { matches: other.data.matches.filter((x) => x.propertyId !== rec.id) }).catch(() => undefined);
        }
        return { ok: true };
      },
    },

    {
      method: 'POST',
      path: '/api/properties/:id/check',
      guard: 'member',
      rate: 6,
      handler: async ({ user, params }) => {
        const rec = await ownProperty(d.store, user!, params.id!);
        const last = rec.data.lastCheckedAt;
        if (last && d.now() - last < MANUAL_MIN_INTERVAL_MS) {
          throw new ApiError(429, 'TOO_SOON', 'Vừa kiểm tra xong, hãy thử lại sau 1 phút (tránh gây tải cho website)');
        }
        return check(rec, 'MANUAL');
      },
    },

    {
      method: 'GET',
      path: '/api/properties/:id/artifact',
      guard: 'member',
      rate: 30,
      handler: async ({ user, params, query }) => {
        const rec = await ownProperty(d.store, user!, params.id!);
        const path = query.get('path') ?? '';
        if (!d.artifacts) throw new ApiError(404, 'NO_ARTIFACTS', 'Chưa cấu hình lưu ảnh chụp');
        if (!new RegExp(`^(screenshots|html)/${rec.id}/[\\w.-]+$`).test(path)) throw new ApiError(400, 'BAD_PATH', 'Đường dẫn không hợp lệ');
        return { url: await d.artifacts.signedUrl(path, 10 * 60_000) };
      },
    },

    { method: 'POST', path: '/api/run-now', guard: 'member', rate: 2, handler: async ({ user }) => runForOwner(d.engine, user!.uid, API_BUDGET_MS) },

    {
      method: 'POST',
      path: '/api/pause-all',
      guard: 'member',
      rate: 6,
      handler: async ({ user, body }) => {
        const pause = body.paused === true;
        const mine = await d.store.queryByOwner(user!.uid);
        let changed = 0;
        for (const rec of mine) {
          if (pause && rec.data.enabled) {
            await d.store.updateProperty(rec.id, { enabled: false, pausedByAll: true, updatedAt: d.now() });
            changed++;
          } else if (!pause && !rec.data.enabled && rec.data.pausedByAll) {
            await d.store.updateProperty(rec.id, { enabled: true, pausedByAll: false, updatedAt: d.now() });
            changed++;
          }
        }
        return { changed };
      },
    },

    {
      method: 'POST',
      path: '/api/test-notification',
      guard: 'member',
      rate: 5,
      handler: async ({ user, body }): Promise<TestNotificationResponse> => {
        const channel = body.channel === 'EMAIL' ? 'EMAIL' : ('TELEGRAM' as NotificationChannelId);
        const s = withUserDefaults((await d.store.getUser(user!.uid))?.settings);
        const recipient = channel === 'TELEGRAM' ? s.telegram.chatId : s.email.to;
        if (channel === 'TELEGRAM' && !isValidChatId(recipient)) throw new ApiError(400, 'NO_RECIPIENT', 'Hãy lưu Telegram Chat ID hợp lệ trước');
        if (channel === 'EMAIL' && !isValidEmail(recipient)) throw new ApiError(400, 'NO_RECIPIENT', 'Hãy lưu địa chỉ email hợp lệ trước');
        const r = await d.engine.notifier.channel(channel).sendTest(recipient!);
        return r.ok
          ? { success: true, channel, messageId: r.messageId, error: null }
          : { success: false, channel, messageId: null, error: r.error };
      },
    },

    // Cloud Scheduler (OIDC)
    { method: 'POST', path: '/tasks/run-due', guard: 'task', handler: async () => runDue(d.engine, d.runner) },
    {
      method: 'POST',
      path: '/tasks/cleanup',
      guard: 'task',
      handler: async () => {
        const sys = await d.store.getSystemConfig();
        return d.store.cleanup(d.now() - sys.retentionDays * 86400_000, 1);
      },
    },

    // Local development helpers (MOCK_FETCH_DIR): switch what a fake URL returns.
    { method: 'GET', path: '/dev/mock', guard: 'dev', handler: async () => d.mock?.list() ?? {} },
    {
      method: 'POST',
      path: '/dev/mock',
      guard: 'dev',
      handler: async ({ body }) => {
        if (!d.mock) throw new ApiError(400, 'NO_MOCK', 'MOCK_FETCH_DIR not set');
        d.mock.set(String(body.url), { file: body.file ? String(body.file) : null, status: Number(body.status ?? 200) });
        return d.mock.list();
      },
    },
    { method: 'POST', path: '/dev/run-due', guard: 'dev', handler: async () => runDue(d.engine, d.runner) },
  ];
}
