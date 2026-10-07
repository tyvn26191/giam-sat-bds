// One property check: observe → evaluate → (match, screenshot) → commit → notify → log.

import type { AdapterRegistry } from '@gsb/parser';
import {
  CHANGE_SEVERITY,
  withUserDefaults,
  type ChangeRecord,
  type CheckSummary,
  type MonitorTrigger,
  type PropertyDoc,
  type UserSettings,
} from '@gsb/shared';
import { gzipHtml, type ArtifactStore } from '../artifacts';
import type { PageFetcher } from '../fetch';
import type { Logger } from '../log';
import type { HostLimiter } from '../rate-limit';
import type { PropertyRecord, Store } from '../store/types';
import { evaluate, planNotification, PRIORITY, type EvalResult, type Identified } from './evaluate';
import { computeHashes } from './hash';
import { findMatches, mergeMatch } from './matching';
import type { Notifier } from './notify';
import { observe } from './observe';
import { MIN_PRICE_CONFIDENCE } from '@gsb/parser';

export interface EngineConfig {
  logChecks: 'all' | 'changes';
  logRetentionDays: number;
  screenshots: boolean;
  saveHtml: boolean;
}

export interface EngineDeps {
  store: Store;
  fetcher: PageFetcher;
  registry: AdapterRegistry;
  limiter: HostLimiter;
  notifier: Notifier;
  artifacts: ArtifactStore | null;
  log: Logger;
  config: EngineConfig;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  rand?: () => number;
}

export interface CheckOptions {
  trigger: MonitorTrigger;
  runId: string;
  inlineRetry: boolean;
  deadline: number;
  userCache?: Map<string, UserSettings>;
}

const SCREENSHOT_TYPES = new Set(['PRICE_DECREASE', 'PRICE_INCREASE', 'PRICE_ALERT', 'FIELD_CHANGED', 'RESTORED', 'POSSIBLE_RELIST']);

async function userSettings(deps: EngineDeps, ownerId: string, cache?: Map<string, UserSettings>): Promise<UserSettings> {
  const hit = cache?.get(ownerId);
  if (hit) return hit;
  const u = await deps.store.getUser(ownerId);
  const s = withUserDefaults(u?.settings);
  cache?.set(ownerId, s);
  return s;
}

export async function runCheck(rec: PropertyRecord, deps: EngineDeps, opts: CheckOptions): Promise<CheckSummary> {
  const startedAt = deps.now();
  const prev = rec.data;
  const obs = await observe(
    { url: prev.url, monitorMode: prev.monitorMode, selectors: prev.selectors, httpCache: prev.httpCache, needsBrowser: prev.needsBrowser },
    { fetcher: deps.fetcher, registry: deps.registry, limiter: deps.limiter, now: deps.now, sleep: deps.sleep },
    { inlineRetry: opts.inlineRetry, deadline: opts.deadline },
  );

  const settings = await userSettings(deps, prev.ownerId, opts.userCache);

  // Previous text is only needed for a text diff, so it is read only when the content changed.
  let prevText: string | null = null;
  if (obs.outcome === 'OK' && obs.parse && prev.hashes && prev.lastSnapshotId) {
    const confident = obs.parse.price && obs.parse.price.confidence >= MIN_PRICE_CONFIDENCE ? obs.parse.price.value : null;
    if (computeHashes(obs.parse, confident).content !== prev.hashes.content) {
      prevText = (await deps.store.getSnapshot(rec.id, prev.lastSnapshotId).catch(() => null))?.normalizedText ?? null;
    }
  }

  const now = deps.now();
  const ev = evaluate(prev, obs, { now, propertyId: rec.id, settings, newId: () => deps.store.newId(), prevText, rand: deps.rand });

  // Possible re-listing of a property the user already watched (first successful parse, or the
  // fingerprint changed).
  let counterparts: PropertyRecord[] = [];
  const fp = ev.patch.fingerprint;
  if (obs.outcome === 'OK' && fp && (ev.firstSuccess || fp.key !== prev.fingerprint?.key)) {
    try {
      const { matches, records } = await findMatches(deps.store, rec.id, prev.ownerId, fp);
      ev.patch.matches = matches;
      counterparts = records;
      const relisted = matches.find((m) => m.status === 'REMOVED' || m.status === 'NOT_FOUND');
      if (relisted && ev.firstSuccess) addRelist(ev, prev, rec.id, relisted, settings, now);
    } catch (e) {
      deps.log.warn('fingerprint matching failed', { propertyId: rec.id, error: (e as Error).message });
    }
  }

  // Screenshot / HTML only for important changes, and only when configured.
  const important = ev.changes.filter((c) => SCREENSHOT_TYPES.has(c.type));
  let artifactPath: string | null = null;
  if (important.length && deps.artifacts) {
    artifactPath = await captureArtifacts(deps, rec.id, prev.url, ev, obs.html, important).catch((e: Error) => {
      deps.log.warn('artifact capture failed', { propertyId: rec.id, error: e.message });
      return null;
    });
  }

  const committed = await deps.store.commitCheck(rec.id, rec.version, {
    patch: ev.patch,
    changes: ev.changes,
    priceEntry: ev.priceEntry,
    snapshot: ev.snapshot,
  });
  const finishedAt = deps.now();
  if (!committed) {
    deps.log.info('check skipped: property changed concurrently', { propertyId: rec.id });
    return summary(rec.id, prev, ev, obs, startedAt, finishedAt, false, 'SKIPPED');
  }

  const after: PropertyDoc = { ...prev, ...ev.patch };

  for (const other of counterparts) {
    const mine = ev.patch.matches?.find((m) => m.propertyId === other.id);
    if (!mine) continue;
    await deps.store
      .updateProperty(other.id, {
        matches: mergeMatch(other.data.matches ?? [], { ...mine, propertyId: rec.id, url: after.url, title: after.name || after.title, status: after.status, price: after.price }),
      })
      .catch(() => undefined);
  }

  let notificationSent = false;
  if (ev.notification) {
    try {
      const r = await deps.notifier.dispatch(rec.id, after, ev.notification, settings, after.revision, ev.changes.map((c) => c.id));
      notificationSent = r.sent > 0;
      if (r.attempted > 0) {
        await deps.store
          .updateProperty(rec.id, { lastNotification: { type: ev.notification.primary, severity: ev.notification.severity, at: deps.now(), ok: notificationSent } })
          .catch(() => undefined);
      }
    } catch (e) {
      deps.log.error('notification dispatch crashed', { propertyId: rec.id, error: (e as Error).message });
    }
  }
  if (artifactPath) deps.log.debug('artifact stored', { propertyId: rec.id, path: artifactPath });

  const changed = ev.changes.some((c) => c.type !== 'RECOVERED');
  if (deps.config.logChecks === 'all' || changed || obs.outcome !== 'OK') {
    await deps.store
      .addMonitorLog({
        runId: opts.runId,
        propertyId: rec.id,
        ownerId: prev.ownerId,
        trigger: opts.trigger,
        startedAt,
        finishedAt,
        durationMs: finishedAt - startedAt,
        method: obs.method,
        httpStatus: obs.httpStatus,
        parser: obs.parse?.parser ?? null,
        outcome: ev.outcome,
        priceDetected: obs.parse?.price?.value ?? null,
        fieldsDetected: obs.parse ? Object.keys(obs.parse.fields) : [],
        changed,
        changeTypes: ev.changes.map((c) => c.type),
        notificationSent,
        error: obs.error ? { code: obs.error.code, message: obs.error.message.slice(0, 500) } : null,
        expireAt: finishedAt + deps.config.logRetentionDays * 86400_000,
      })
      .catch((e: Error) => deps.log.warn('monitor log write failed', { error: e.message }));
  }

  deps.log.info('check', {
    propertyId: rec.id,
    trigger: opts.trigger,
    outcome: ev.outcome,
    method: obs.method,
    http: obs.httpStatus,
    price: obs.parse?.price?.value ?? null,
    changes: ev.changes.map((c) => c.type),
    notified: notificationSent,
    ms: finishedAt - startedAt,
    error: obs.error?.code,
  });
  return summary(rec.id, prev, ev, obs, startedAt, finishedAt, notificationSent);
}

function addRelist(
  ev: EvalResult,
  prev: PropertyDoc,
  propertyId: string,
  m: { propertyId: string; url: string; title: string | null; confidence: number; price: number | null },
  settings: UserSettings,
  now: number,
): void {
  const revision = (ev.patch.revision ?? prev.revision + 1) as number;
  const status = ev.patch.status ?? prev.status;
  const change: Identified<ChangeRecord> = {
    id: `${propertyId}-relist-${revision}`,
    propertyId,
    ownerId: prev.ownerId,
    at: now,
    type: 'POSSIBLE_RELIST',
    severity: CHANGE_SEVERITY.POSSIBLE_RELIST,
    revision,
    oldPrice: m.price,
    newPrice: ev.patch.price ?? null,
    difference: m.price !== null && ev.patch.price != null ? ev.patch.price - m.price : null,
    percentage: m.price && ev.patch.price != null ? Math.round(((ev.patch.price - m.price) / m.price) * 1_000_000) / 10_000 : null,
    fieldChanges: [],
    textDiff: null,
    statusBefore: prev.status,
    statusAfter: status,
    beforeSnapshotId: null,
    afterSnapshotId: ev.snapshot?.id ?? null,
    message: `Có thể là căn đã gỡ trước đó (${Math.round(m.confidence * 100)}%): ${m.url}`,
    dedupeKey: `${propertyId}:${revision}:POSSIBLE_RELIST`,
    screenshotPath: null,
  };
  ev.changes.push(change);
  const plan = planNotification(prev, ev.changes, settings, {
    status,
    currentPrice: ev.patch.price ?? null,
    alerts: ev.notification?.alerts ?? [],
    price: ev.notification?.price ?? null,
    fieldChanges: ev.notification?.fieldChanges ?? [],
    textDiff: ev.notification?.textDiff ?? null,
    match: { url: m.url, title: m.title, confidence: m.confidence, oldPrice: m.price },
  });
  if (plan) {
    plan.types = PRIORITY.filter((t) => plan.types.includes(t));
    plan.primary = plan.types[0]!;
  }
  ev.notification = plan;
}

async function captureArtifacts(
  deps: EngineDeps,
  propertyId: string,
  url: string,
  ev: EvalResult,
  html: string | null,
  important: Identified<ChangeRecord>[],
): Promise<string | null> {
  const store = deps.artifacts!;
  const stamp = new Date(deps.now()).toISOString().replace(/[:.]/g, '-');
  let shotPath: string | null = null;
  if (deps.config.screenshots && deps.fetcher.browser) {
    // One extra (rate-limited) render, only because an important change was detected.
    const p = await deps.limiter.run(new URL(url).host, () => deps.fetcher.browser!(url, { screenshot: true }));
    if (p.screenshot) shotPath = await store.put(`screenshots/${propertyId}/${stamp}.jpg`, p.screenshot, 'image/jpeg');
  }
  if (deps.config.saveHtml && html && ev.snapshot) {
    ev.snapshot.htmlPath = await store.put(`html/${propertyId}/${stamp}.html.gz`, gzipHtml(html), 'text/html; charset=utf-8', 'gzip');
  }
  if (shotPath) {
    for (const c of important) c.screenshotPath = shotPath;
    if (ev.snapshot) ev.snapshot.screenshotPath = shotPath;
  }
  return shotPath ?? ev.snapshot?.htmlPath ?? null;
}

function summary(
  propertyId: string,
  prev: PropertyDoc,
  ev: EvalResult,
  obs: { method: CheckSummary['method']; error: { code: string; message: string } | null },
  startedAt: number,
  finishedAt: number,
  notificationSent: boolean,
  forced?: 'SKIPPED',
): CheckSummary {
  return {
    propertyId,
    outcome: forced ?? ev.outcome,
    status: ev.patch.status ?? prev.status,
    changed: ev.changes.some((c) => c.type !== 'RECOVERED'),
    changeTypes: ev.changes.map((c) => c.type),
    price: ev.patch.price ?? prev.price,
    priceDisplay: ev.patch.priceDisplay ?? prev.priceDisplay,
    previousPrice: ev.patch.previousPrice ?? prev.previousPrice,
    notificationSent,
    error: obs.error ? { code: obs.error.code, message: obs.error.message } : null,
    checkedAt: finishedAt,
    durationMs: finishedAt - startedAt,
    method: obs.method,
  };
}
