import type { AddressInfo } from 'node:net';
import type http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { buildRoutes } from '../src/http/api';
import type { AuthUser } from '../src/http/auth';
import { createServer } from '../src/http/server';
import { silentLogger } from '../src/log';
import { SUUMO_URL, makeDeps } from './helpers';

const users: Record<string, AuthUser> = {
  alice: { uid: 'alice', email: 'alice@example.com', emailVerified: true, role: 'member', claims: { role: 'member' } },
  bob: { uid: 'bob', email: 'bob@example.com', emailVerified: true, role: 'member', claims: { role: 'member' } },
  newbie: { uid: 'newbie', email: 'newbie@example.com', emailVerified: true, role: null, claims: {} },
  boss: { uid: 'boss', email: 'owner@example.com', emailVerified: true, role: null, claims: {} },
};

describe('HTTP API', () => {
  const env = makeDeps();
  env.fetcher.set(SUUMO_URL, { status: 200, file: 'suumo-example.html' });
  const roles: Record<string, string | null> = {};
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    const cfg = { ...loadConfig({ ADMIN_EMAILS: 'owner@example.com' }), maxPropertiesPerUser: 2 };
    server = createServer({
      routes: buildRoutes({
        cfg,
        engine: env.deps,
        store: env.store,
        runner: { budgetMs: 60_000, maxPerRun: 50, lockTtlMs: 60_000, minSpacingMs: 0, jitterMs: 0 },
        setRole: async (uid, _c, role) => {
          roles[uid] = role;
        },
        artifacts: null,
        mock: null,
        now: env.clock.now,
      }),
      verifyUser: async (h) => users[(h ?? '').replace('Bearer ', '')] ?? null,
      verifyTask: async (h) => h === 'Bearer scheduler',
      devMode: false,
      corsOrigins: [],
      log: silentLogger,
      now: env.clock.now,
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const call = async (method: string, path: string, who?: string, body?: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { ...(who ? { authorization: `Bearer ${who}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: (await res.json()) as Record<string, any> };
  };

  it('requires sign-in and an approved role', async () => {
    expect((await call('POST', '/api/test-url', undefined, { url: SUUMO_URL })).status).toBe(401);
    expect((await call('POST', '/api/test-url', 'newbie', { url: SUUMO_URL })).json.error).toBe('NOT_APPROVED');
    expect((await call('GET', '/healthz')).status).toBe(200);
  });

  it('/api/me grants admin to ADMIN_EMAILS (verified) and creates the settings doc', async () => {
    const r = await call('GET', '/api/me', 'boss');
    expect(r.json).toMatchObject({ role: 'admin', claimsUpdated: true });
    expect(roles.boss).toBe('admin');
    expect(env.store.users.has('boss')).toBe(true);
    expect((await call('GET', '/api/me', 'newbie')).json).toMatchObject({ role: null, claimsUpdated: false });
  });

  it('Test URL previews the detected data without saving', async () => {
    const r = await call('POST', '/api/test-url', 'alice', { url: SUUMO_URL });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ site: 'SUUMO', siteLabel: 'SUUMO', price: 31_900_000, priceDisplay: '3,190万円', address: '愛知県西尾市寺津町三丁目', propertyCode: '76543210', outcome: 'OK', duplicateOf: null });
    expect(env.store.properties.size).toBe(0);
  });

  it('rejects internal URLs (SSRF)', async () => {
    for (const url of ['http://169.254.169.254/latest/meta-data/', 'http://localhost:8080/', 'http://10.0.0.1/', 'file:///etc/passwd']) {
      const r = await call('POST', '/api/properties', 'alice', { url });
      expect(r.status).toBe(400);
      expect(r.json.error).toBe('INVALID_URL');
    }
  });

  it('creates a property, runs the first check, refuses duplicates and enforces the limit', async () => {
    const r = await call('POST', '/api/properties', 'alice', { url: `${SUUMO_URL}#gallery`, settings: { name: '本命', groups: ['西尾市', '本命'], intervalMin: 30, alerts: { priceAtOrBelow: 30_000_000 } } });
    expect(r.status).toBe(200);
    expect(r.json.check).toMatchObject({ outcome: 'OK', price: 31_900_000 });
    const p = env.store.properties.get(r.json.id)!.data;
    expect(p).toMatchObject({ ownerId: 'alice', url: SUUMO_URL, name: '本命', groups: ['西尾市', '本命'], intervalMin: 30, status: 'ACTIVE' });
    expect(p.alerts.priceAtOrBelow).toBe(30_000_000);

    const dup = await call('POST', '/api/properties', 'alice', { url: SUUMO_URL });
    expect(dup.status).toBe(409);
    expect(dup.json.propertyId).toBe(r.json.id);

    env.fetcher.set('https://www.homes.co.jp/kodate/b-35003710000001/', { status: 200, file: 'homes-example.html' });
    expect((await call('POST', '/api/properties', 'alice', { url: 'https://www.homes.co.jp/kodate/b-35003710000001/' })).status).toBe(200);
    expect((await call('POST', '/api/properties', 'alice', { url: 'https://www.athome.co.jp/kodate/1234567890/' })).json.error).toBe('LIMIT');
  });

  it('only the owner can check or delete; manual checks are throttled', async () => {
    const id = [...env.store.properties.keys()][0]!;
    expect((await call('POST', `/api/properties/${id}/check`, 'bob')).status).toBe(404);
    expect((await call('DELETE', `/api/properties/${id}`, 'bob')).status).toBe(404);
    expect((await call('POST', `/api/properties/${id}/check`, 'alice')).json.error).toBe('TOO_SOON');
    env.clock.advance(61_000);
    const ok = await call('POST', `/api/properties/${id}/check`, 'alice');
    expect(ok.json).toMatchObject({ outcome: 'OK', changed: false });
  });

  it('pause all / resume all only touches what it paused', async () => {
    const ids = [...env.store.properties.keys()];
    await env.store.updateProperty(ids[1]!, { enabled: false });
    expect((await call('POST', '/api/pause-all', 'alice', { paused: true })).json.changed).toBe(1);
    expect((await call('POST', '/api/pause-all', 'alice', { paused: false })).json.changed).toBe(1);
    expect(env.store.properties.get(ids[0]!)!.data.enabled).toBe(true);
    expect(env.store.properties.get(ids[1]!)!.data.enabled).toBe(false);
  });

  it('test notification needs a saved recipient', async () => {
    const r = await call('POST', '/api/test-notification', 'bob', { channel: 'TELEGRAM' });
    expect(r.json.error).toBe('NO_RECIPIENT');
    await env.store.ensureUser('bob', 'bob@example.com', 0);
    env.store.users.get('bob')!.settings.telegram.chatId = '987654';
    expect((await call('POST', '/api/test-notification', 'bob', { channel: 'TELEGRAM' })).json).toMatchObject({ success: true, channel: 'TELEGRAM' });
  });

  it('scheduler endpoints need the scheduler token; dev endpoints are off', async () => {
    expect((await call('POST', '/tasks/run-due', 'alice')).status).toBe(401);
    expect((await call('POST', '/tasks/run-due', 'scheduler')).status).toBe(200);
    expect((await call('POST', '/dev/mock', undefined, { url: 'x' })).status).toBe(404);
  });

  it('rate-limits per user', async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await call('POST', '/api/test-url', 'bob', { url: SUUMO_URL })).status;
    expect(last).toBe(429);
  });

  it('deletes the property and its history', async () => {
    const id = [...env.store.properties.keys()][0]!;
    expect((await call('DELETE', `/api/properties/${id}`, 'alice')).status).toBe(200);
    expect(env.store.properties.has(id)).toBe(false);
    expect(env.store.priceHistory.has(id)).toBe(false);
  });
});

describe('config', () => {
  it('refuses insecure settings on Cloud Run', () => {
    expect(() => loadConfig({ K_SERVICE: 'w', TASKS_AUTH: 'none' })).toThrow();
    expect(() => loadConfig({ K_SERVICE: 'w', TASKS_AUDIENCE: 'https://x', SCHEDULER_SA_EMAIL: 'a@b', MOCK_FETCH_DIR: 'x' })).toThrow();
    expect(loadConfig({ K_SERVICE: 'w', TASKS_AUDIENCE: 'https://x', SCHEDULER_SA_EMAIL: 'a@b' }).logJson).toBe(true);
  });
});
