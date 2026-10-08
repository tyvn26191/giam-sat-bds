import { describe, expect, it } from 'vitest';
import { runCheck } from '../src/engine/check';
import { runDue } from '../src/engine/runner';
import { FetchError } from '../src/fetch';
import { HostLimiter } from '../src/rate-limit';
import { Clock, SUUMO_URL, addProperty, fixture, makeDeps } from './helpers';

const opts = (clock: Clock) => ({ trigger: 'MANUAL' as const, runId: 'r1', inlineRetry: true, deadline: clock.now() + 600_000 });
const suumoAt = (price: string) => fixture('suumo-example.html').replace(/3190万円/g, price);

async function check(env: ReturnType<typeof makeDeps>, id: string) {
  const rec = (await env.store.getProperty(id))!;
  return runCheck(rec, env.deps, opts(env.clock));
}

describe('monitoring engine — price', () => {
  it('records a baseline on the first check without notifying', async () => {
    const env = makeDeps();
    const id = await addProperty(env.store, env.clock);
    env.fetcher.set(SUUMO_URL, { status: 200, file: 'suumo-example.html' });

    const s = await check(env, id);
    expect(s).toMatchObject({ outcome: 'OK', status: 'ACTIVE', price: 31_900_000, changed: false, notificationSent: false });
    const p = env.store.properties.get(id)!.data;
    expect(p).toMatchObject({ title: '西尾市寺津町 1号棟', address: '愛知県西尾市寺津町三丁目', propertyCode: '76543210', priceDisplay: '3,190万円', site: 'SUUMO', revision: 1 });
    expect(p.priceStats).toMatchObject({ initial: 31_900_000, max: 31_900_000, min: 31_900_000, dropCount: 0 });
    expect(p.hashes).not.toBeNull();
    expect([...env.store.priceHistory.get(id)!.values()]).toEqual([expect.objectContaining({ price: 31_900_000, changeType: 'INITIAL' })]);
    expect(env.store.snapshots.get(id)!.size).toBe(1);
    expect(env.telegram.sent).toHaveLength(0);
    expect(env.store.monitorLogs).toHaveLength(1);
    expect(env.store.monitorLogs[0]).toMatchObject({ outcome: 'OK', priceDetected: 31_900_000, changed: false, method: 'HTTP' });
    expect(p.nextCheckAt).toBe(env.clock.now() + 15 * 60_000);
  });

  it('3,190万円 → 3,090万円: one PRICE_DECREASE, one Telegram message, no repeat', async () => {
    const env = makeDeps();
    const id = await addProperty(env.store, env.clock);
    env.fetcher.set(SUUMO_URL, { status: 200, file: 'suumo-example.html' });
    await check(env, id);

    env.clock.advance(15 * 60_000);
    env.fetcher.set(SUUMO_URL, { status: 200, file: 'suumo-price-down.html' });
    const s = await check(env, id);
    expect(s).toMatchObject({ outcome: 'OK', status: 'PRICE_CHANGED', price: 30_900_000, previousPrice: 31_900_000, changed: true, notificationSent: true });
    expect(s.changeTypes).toContain('PRICE_DECREASE');

    const changes = [...env.store.changes.get(id)!.values()];
    const pc = changes.find((c) => c.type === 'PRICE_DECREASE')!;
    expect(pc).toMatchObject({ oldPrice: 31_900_000, newPrice: 30_900_000, difference: -1_000_000, percentage: -3.1348, severity: 'CRITICAL' });
    // 情報提供日 / 次回更新日 changed too, but only as a LOW minor change
    expect(changes.find((c) => c.type === 'MINOR_CHANGED')?.fieldChanges.map((f) => f.key)).toEqual(['postedDate', 'nextUpdateDate']);

    const p = env.store.properties.get(id)!.data;
    expect(p.lastPriceChange).toMatchObject({ type: 'PRICE_DECREASE', oldPrice: 31_900_000, newPrice: 30_900_000, difference: -1_000_000 });
    expect(p.priceStats).toMatchObject({ initial: 31_900_000, max: 31_900_000, min: 30_900_000, dropCount: 1 });
    expect([...env.store.priceHistory.get(id)!.values()].map((h) => h.price)).toEqual([31_900_000, 30_900_000]);

    expect(env.telegram.sent).toHaveLength(1);
    const msg = env.telegram.sent[0]!.text;
    expect(msg).toContain('🔴 GIÁ NHÀ GIẢM');
    expect(msg).toContain('<b>Giá cũ:</b> 3,190万円');
    expect(msg).toContain('<b>Giá mới:</b> 3,090万円');
    expect(msg).toContain('<b>Giảm:</b> 100万円');
    expect(msg).toContain('<b>Tỷ lệ:</b> -3.13%');
    expect(msg).not.toContain('情報提供日'); // minor changes stay out of the alert
    expect([...env.store.notifications.values()]).toEqual([expect.objectContaining({ status: 'SENT', channel: 'TELEGRAM', type: 'PRICE_DECREASE' })]);

    // Next checks: still 3,090万円 (counters/timestamps differ) → nothing new
    env.clock.advance(15 * 60_000);
    const html = fixture('suumo-price-down.html').replace('現在の閲覧数: 131', '現在の閲覧数: 222').replace('06:29:41', '06:45:12');
    env.fetcher.set(SUUMO_URL, { status: 200, html });
    const again = await check(env, id);
    expect(again).toMatchObject({ changed: false, notificationSent: false, status: 'PRICE_CHANGED' });
    expect(env.telegram.sent).toHaveLength(1);
  });

  it('PRICE_INCREASE is LOW and still notified by default', async () => {
    const env = makeDeps();
    const id = await addProperty(env.store, env.clock);
    env.fetcher.set(SUUMO_URL, { status: 200, file: 'suumo-price-down.html' });
    await check(env, id);
    env.fetcher.set(SUUMO_URL, { status: 200, file: 'suumo-example.html' });
    const s = await check(env, id);
    expect(s.changeTypes).toContain('PRICE_INCREASE');
    expect(env.telegram.sent[0]!.text).toContain('🔺 GIÁ NHÀ TĂNG');
  });

  it('never notifies the same change twice (dedupe by property + revision + channel)', async () => {
    const env = makeDeps();
    const id = await addProperty(env.store, env.clock);
    env.fetcher.set(SUUMO_URL, { status: 200, file: 'suumo-example.html' });
    await check(env, id);
    env.fetcher.set(SUUMO_URL, { status: 200, file: 'suumo-price-down.html' });
    await check(env, id);
    const p = env.store.properties.get(id)!.data;
    const plan = { primary: 'PRICE_DECREASE' as const, types: ['PRICE_DECREASE' as const], severity: 'CRITICAL' as const, price: null, currentPrice: p.price, alerts: [], fieldChanges: [], textDiff: null, status: p.status, error: null, match: null };
    const user = (await env.store.getUser('u1'))!.settings;
    const r = await env.deps.notifier.dispatch(id, p, plan, user, p.revision, []);
    expect(r).toEqual({ attempted: 0, sent: 0 });
    expect(env.telegram.sent).toHaveLength(1);
  });

  it('a concurrent write wins: the stale check is skipped and sends nothing', async () => {
    const env = makeDeps();
    const id = await addProperty(env.store, env.clock);
    env.fetcher.set(SUUMO_URL, { status: 200, file: 'suumo-example.html' });
    await check(env, id);
    const stale = (await env.store.getProperty(id))!;
    env.fetcher.set(SUUMO_URL, { status: 200, file: 'suumo-price-down.html' });
    await check(env, id); // another worker processed it first
    const s = await runCheck(stale, env.deps, opts(env.clock));
    expect(s.outcome).toBe('SKIPPED');
    expect(env.telegram.sent).toHaveLength(1);
  });

  it('price alert fires once when the price reaches the threshold', async () => {
    const env = makeDeps();
    const id = await addProperty(env.store, env.clock, SUUMO_URL, { alerts: { priceAtOrBelow: 30_000_000, dropAmountAtLeast: null, dropPercentAtLeast: null, only: false } });
    env.fetcher.set(SUUMO_URL, { status: 200, html: suumoAt('3190万円') });
    await check(env, id);
    env.fetcher.set(SUUMO_URL, { status: 200, html: suumoAt('3090万円') });
    const s1 = await check(env, id);
    expect(s1.changeTypes).not.toContain('PRICE_ALERT');
    env.fetcher.set(SUUMO_URL, { status: 200, html: suumoAt('2990万円') });
    const s2 = await check(env, id);
    expect(s2.changeTypes).toContain('PRICE_ALERT');
    const last = env.telegram.sent.at(-1)!.text;
    expect(last).toContain('🎯 ĐẠT NGƯỠNG GIÁ');
    expect(last).toContain('Giá ≤ 3,000万円');
    expect(last).toContain('<b>Giá mới:</b> 2,990万円');
    env.fetcher.set(SUUMO_URL, { status: 200, html: suumoAt('2980万円') });
    const s3 = await check(env, id);
    expect(s3.changeTypes).not.toContain('PRICE_ALERT');
  });

  it('alerts.only suppresses price changes that do not hit an alert', async () => {
    const env = makeDeps();
    const id = await addProperty(env.store, env.clock, SUUMO_URL, { alerts: { priceAtOrBelow: null, dropAmountAtLeast: 2_000_000, dropPercentAtLeast: null, only: true } });
    env.fetcher.set(SUUMO_URL, { status: 200, html: suumoAt('3190万円') });
    await check(env, id);
    env.fetcher.set(SUUMO_URL, { status: 200, html: suumoAt('3090万円') });
    expect((await check(env, id)).notificationSent).toBe(false);
    env.fetcher.set(SUUMO_URL, { status: 200, html: suumoAt('2790万円') });
    expect((await check(env, id)).notificationSent).toBe(true);
    expect(env.telegram.sent.at(-1)!.text).toContain('Giảm ≥ 200万円');
  });

  it('low-confidence price → NEEDS_REVIEW and no price change is invented', async () => {
    const env = makeDeps();
    const url = 'https://machi-fudosan.example.jp/p/9';
    const id = await addProperty(env.store, env.clock, url);
    env.fetcher.set(url, { status: 200, file: 'generic-og-only.html' });
    const s = await check(env, id);
    const p = env.store.properties.get(id)!.data;
    expect(s.outcome).toBe('OK');
    expect(p.price).toBeNull();
    expect(p.needsReview).toBe(true);
    expect(p.reviewReasons).toContain('LOW_PRICE_CONFIDENCE');
  });
});

describe('monitoring engine — content', () => {
  it('important field changes → PROPERTY UPDATED with the changed fields', async () => {
    const env = makeDeps();
    const id = await addProperty(env.store, env.clock);
    env.fetcher.set(SUUMO_URL, { status: 200, file: 'suumo-example.html' });
    await check(env, id);
    env.fetcher.set(SUUMO_URL, { status: 200, file: 'suumo-updated.html' });
    const s = await check(env, id);
    expect(s).toMatchObject({ status: 'UPDATED', changed: true, notificationSent: true });
    const c = [...env.store.changes.get(id)!.values()].find((x) => x.type === 'FIELD_CHANGED')!;
    expect(c.severity).toBe('HIGH');
    expect(c.fieldChanges.map((f) => [f.label, f.before, f.after])).toEqual([
      ['引渡時期', '即引渡可', '2026年12月上旬予定'],
      ['備考', '駐車2台可。太陽光発電システム付き。', '駐車2台可。太陽光発電システム付き。外構工事中。'],
    ]);
    expect(c.beforeSnapshotId).not.toBeNull();
    expect(c.afterSnapshotId).not.toBe(c.beforeSnapshotId);
    expect(env.telegram.sent[0]!.text).toContain('🟡 PROPERTY UPDATED');
    expect(env.telegram.sent[0]!.text).toContain('• 引渡時期: 即引渡可 → 2026年12月上旬予定');
  });

  it('FULL mode ignores counters but reports real text changes with a diff', async () => {
    const env = makeDeps();
    const id = await addProperty(env.store, env.clock, SUUMO_URL, { monitorMode: 'FULL' }, { notifyTypes: { ...(await import('@gsb/shared')).DEFAULT_NOTIFY_TYPES, MINOR_CHANGED: true } });
    env.fetcher.set(SUUMO_URL, { status: 200, file: 'suumo-example.html' });
    await check(env, id);
    env.fetcher.set(SUUMO_URL, { status: 200, html: fixture('suumo-example.html').replace('現在の閲覧数: 128', '現在の閲覧数: 300') });
    expect((await check(env, id)).changed).toBe(false);
    env.fetcher.set(SUUMO_URL, { status: 200, html: fixture('suumo-example.html').replace('4LDK / 土地', '4LDK+S / 土地') });
    const s = await check(env, id);
    expect(s.changeTypes).toEqual(['MINOR_CHANGED']);
    const c = [...env.store.changes.get(id)!.values()].find((x) => x.type === 'MINOR_CHANGED')!;
    expect(c.textDiff?.added[0]).toContain('4LDK+S');
    expect(c.textDiff?.removed[0]).toContain('4LDK / 土地');
  });
});

describe('monitoring engine — status', () => {
  it('REMOVED needs two consecutive confirmations, then notifies once', async () => {
    const env = makeDeps();
    const id = await addProperty(env.store, env.clock);
    env.fetcher.set(SUUMO_URL, { status: 200, file: 'suumo-example.html' });
    await check(env, id);

    env.fetcher.set(SUUMO_URL, { status: 404, html: 'not found' });
    const s1 = await check(env, id);
    expect(s1.status).toBe('ACTIVE');
    expect(env.store.properties.get(id)!.data.failure).toMatchObject({ kind: 'REMOVED', count: 1 });
    expect(env.store.properties.get(id)!.data.nextCheckAt).toBe(env.clock.now() + 120_000);

    env.fetcher.set(SUUMO_URL, { status: 200, file: 'suumo-removed.html' });
    const s2 = await check(env, id);
    expect(s2).toMatchObject({ status: 'REMOVED', outcome: 'REMOVED', notificationSent: true });
    expect(env.telegram.sent[0]!.text).toContain('⚠️ PROPERTY REMOVED');

    await check(env, id);
    expect(env.telegram.sent).toHaveLength(1);
    expect(env.store.properties.get(id)!.data.price).toBe(31_900_000); // last known price kept

    env.fetcher.set(SUUMO_URL, { status: 200, file: 'suumo-price-down.html' });
    const back = await check(env, id);
    expect(back.changeTypes).toEqual(expect.arrayContaining(['RESTORED', 'PRICE_DECREASE']));
    expect(env.telegram.sent).toHaveLength(2);
  });

  it('a URL that never worked shows NOT_FOUND / BLOCKED / ERROR at once, without alerts', async () => {
    const env = makeDeps();
    const id = await addProperty(env.store, env.clock);
    expect((await check(env, id)).status).toBe('NOT_FOUND');
    const url = 'https://www.athome.co.jp/kodate/1111111111/';
    const b = await addProperty(env.store, env.clock, url);
    env.fetcher.set(url, { status: 200, file: 'athome-blocked.html' });
    expect((await check(env, b)).status).toBe('BLOCKED');
    const e = await addProperty(env.store, env.clock, 'https://www.example-fudosan.jp/x');
    env.fetcher.set('https://www.example-fudosan.jp/x', { status: 503, html: 'maintenance' });
    expect((await check(env, e)).status).toBe('ERROR');
    expect(env.telegram.sent).toHaveLength(0);
  });

  it('bot protection is BLOCKED, never REMOVED, and is not retried aggressively', async () => {
    const env = makeDeps();
    const url = 'https://www.athome.co.jp/mansion/6981234567/';
    const id = await addProperty(env.store, env.clock, url);
    env.fetcher.set(url, { status: 200, file: 'athome-example.html' });
    await check(env, id);

    env.fetcher.set(url, { status: 200, file: 'athome-blocked.html' });
    const s1 = await check(env, id);
    expect(s1.status).toBe('ACTIVE');
    expect(env.store.properties.get(id)!.data.nextCheckAt).toBe(env.clock.now() + 600_000);
    env.fetcher.set(url, { status: 403, html: 'Forbidden' });
    const s2 = await check(env, id);
    expect(s2).toMatchObject({ status: 'BLOCKED', outcome: 'BLOCKED' });
    expect(env.telegram.sent.at(-1)!.text).toContain('⛔ BỊ CHẶN TRUY CẬP');
    expect(env.store.properties.get(id)!.data.nextCheckAt).toBeGreaterThanOrEqual(env.clock.now() + 60 * 60_000);
    expect(env.fetcher.requests.length).toBe(3); // no retry storm
  });

  it('HTTP 405 JavaScript challenge (at home) is BLOCKED with a clear reason, not ERROR', async () => {
    const env = makeDeps();
    const url = 'https://www.athome.co.jp/kodate/1194102416/';
    const id = await addProperty(env.store, env.clock, url);
    env.fetcher.set(url, { status: 405, file: 'athome-challenge-405.html' });
    const s = await check(env, id);
    expect(s).toMatchObject({ outcome: 'BLOCKED', status: 'BLOCKED' });
    expect(s.error?.code).toBe('BOT_PROTECTION');
    expect(env.fetcher.requests).toHaveLength(1); // no retry, no bypass attempt
  });

  it('robots.txt disallow → BLOCKED immediately, page never fetched', async () => {
    const env = makeDeps();
    const id = await addProperty(env.store, env.clock);
    env.fetcher.robotsAllowed = false;
    const s = await check(env, id);
    expect(s.status).toBe('BLOCKED');
    expect(s.error?.code).toBe('ROBOTS_DISALLOWED');
    expect(env.fetcher.requests).toHaveLength(0);
  });

  it('technical errors retry after 30 s, 2 min, 10 min, then ERROR (no infinite retry)', async () => {
    const env = makeDeps();
    const id = await addProperty(env.store, env.clock);
    env.fetcher.set(SUUMO_URL, { status: 200, file: 'suumo-example.html' });
    await check(env, id);
    env.fetcher.requests = [];
    env.fetcher.set(SUUMO_URL, { error: new FetchError('TIMEOUT', 'timeout after 20000 ms') });

    const t0 = env.clock.now();
    const s1 = await check(env, id);
    expect(env.fetcher.requests).toHaveLength(2); // first try + inline retry 30 s later
    expect(env.clock.now() - t0).toBe(30_000);
    expect(s1.status).toBe('ACTIVE');
    const p1 = env.store.properties.get(id)!.data;
    expect(p1.failure).toMatchObject({ kind: 'ERROR', count: 1, code: 'TIMEOUT' });
    expect(p1.nextCheckAt).toBe(env.clock.now() + 120_000);

    const s2 = await check(env, id);
    expect(s2.status).toBe('ACTIVE');
    expect(env.store.properties.get(id)!.data.nextCheckAt).toBe(env.clock.now() + 600_000);

    const s3 = await check(env, id);
    expect(s3).toMatchObject({ status: 'ERROR', outcome: 'ERROR' });
    expect(env.telegram.sent.at(-1)!.text).toContain('❗ LỖI KIỂM TRA');
    expect(env.store.properties.get(id)!.data.lastError).toMatchObject({ code: 'TIMEOUT' });

    await check(env, id);
    expect(env.telegram.sent).toHaveLength(1); // ERROR notified once
    expect(env.store.properties.get(id)!.data.nextCheckAt).toBeGreaterThan(env.clock.now() + 15 * 60_000);

    env.fetcher.set(SUUMO_URL, { status: 200, file: 'suumo-example.html' });
    const ok = await check(env, id);
    expect(ok).toMatchObject({ status: 'ACTIVE', changeTypes: ['RECOVERED'] });
    expect(env.telegram.sent).toHaveLength(1); // recovery is logged, not pushed
  });

  it('HTTP 429 is retried later, honouring the long cooldown', async () => {
    const env = makeDeps();
    const id = await addProperty(env.store, env.clock);
    env.fetcher.set(SUUMO_URL, { status: 429, html: 'slow down' });
    const s = await check(env, id);
    expect(s.error?.code).toBe('HTTP_429');
    expect(env.fetcher.requests).toHaveLength(1); // no inline retry on 429
    expect(env.store.properties.get(id)!.data.nextCheckAt).toBeGreaterThanOrEqual(env.clock.now() + 30 * 60_000);
  });
});

describe('fingerprint — possible re-listing', () => {
  it('links a new URL to a removed listing and notifies with the old price', async () => {
    const env = makeDeps();
    const a = await addProperty(env.store, env.clock);
    env.fetcher.set(SUUMO_URL, { status: 200, file: 'suumo-example.html' });
    await check(env, a);
    env.fetcher.set(SUUMO_URL, { status: 404, html: '' });
    await check(env, a);
    await check(env, a);
    expect(env.store.properties.get(a)!.data.status).toBe('REMOVED');

    const urlB = 'https://suumo.jp/ikkodate/aichi/sc_nishio/nc_79990001/';
    const b = await addProperty(env.store, env.clock, urlB);
    env.fetcher.set(urlB, { status: 200, file: 'suumo-price-down.html' });
    const s = await check(env, b);
    expect(s.changeTypes).toContain('POSSIBLE_RELIST');
    const pb = env.store.properties.get(b)!.data;
    expect(pb.matches[0]).toMatchObject({ propertyId: a, status: 'REMOVED', price: 31_900_000 });
    expect(pb.matches[0]!.confidence).toBeGreaterThanOrEqual(0.75);
    expect(pb.matches[0]!.confidence).toBeLessThan(1);
    expect(env.store.properties.get(a)!.data.matches[0]).toMatchObject({ propertyId: b });
    const msg = env.telegram.sent.at(-1)!.text;
    expect(msg).toContain('🔁 CÓ THỂ LÀ CĂN CŨ ĐĂNG LẠI');
    expect(msg).toContain('3,190万円 → 3,090万円');
  });
});

describe('scheduler run', () => {
  it('processes due properties once, then is idle; respects pause and the lock', async () => {
    const env = makeDeps();
    const cfg = { budgetMs: 240_000, maxPerRun: 100, lockTtlMs: 300_000, minSpacingMs: 0, jitterMs: 0 };
    const ids = [await addProperty(env.store, env.clock), await addProperty(env.store, env.clock, 'https://www.homes.co.jp/kodate/b-35003710000001/')];
    env.fetcher.set(SUUMO_URL, { status: 200, file: 'suumo-example.html' });
    env.fetcher.set('https://www.homes.co.jp/kodate/b-35003710000001/', { status: 200, file: 'homes-example.html' });

    const r = await runDue(env.deps, cfg);
    expect(r).toMatchObject({ status: 'done', due: 2, processed: 2, errors: 0 });
    expect(env.store.runs.size).toBe(1);
    expect(await runDue(env.deps, cfg)).toEqual({ status: 'idle', due: 0 });

    env.clock.advance(16 * 60_000);
    env.store.config.paused = true;
    expect((await runDue(env.deps, cfg)).status).toBe('paused');
    env.store.config.paused = false;

    await env.store.acquireLock('runDue', 'someone-else', 300_000, env.clock.now());
    expect((await runDue(env.deps, cfg)).status).toBe('busy');
    expect(ids).toHaveLength(2);
  });

  it('skips paused (disabled) properties', async () => {
    const env = makeDeps();
    await addProperty(env.store, env.clock, SUUMO_URL, { enabled: false });
    expect((await runDue(env.deps, { budgetMs: 1, maxPerRun: 10, lockTtlMs: 1, minSpacingMs: 0, jitterMs: 0 })).status).toBe('idle');
  });
});

describe('HostLimiter', () => {
  it('spaces requests to the same host and caps concurrency', async () => {
    const clock = new Clock(0);
    const lim = new HostLimiter({ global: 4, perHost: 1, minSpacingMs: 3000, jitterMs: 0, now: clock.now, sleep: clock.sleep });
    const starts: number[] = [];
    let active = 0;
    let maxActive = 0;
    const task = () =>
      lim.run('suumo.jp', async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        starts.push(clock.now());
        await Promise.resolve();
        active--;
      });
    await Promise.all([task(), task(), task()]);
    expect(maxActive).toBe(1);
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(3000);
    expect(starts[2]! - starts[1]!).toBeGreaterThanOrEqual(3000);
  });
});
