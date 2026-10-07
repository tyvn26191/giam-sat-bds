// Pure decision logic: previous state + new observation → what to store and what to notify.
// No I/O here, so every rule (price change, REMOVED confirmation, BLOCKED vs REMOVED, retries,
// dedupe, alerts) is unit-tested directly.

import { MIN_PRICE_CONFIDENCE, textDiff } from '@gsb/parser';
import {
  CHANGE_SEVERITY,
  FIELD_KEYS,
  RETRY_DELAYS_MS,
  SEVERITY_RANK,
  backoffTime,
  comparePrices,
  fieldImportance,
  fieldLabel,
  formatManYen,
  formatPercent,
  maxSeverity,
  nextCheckTime,
  type ChangeRecord,
  type ChangeType,
  type CheckOutcome,
  type FailureKind,
  type FieldChange,
  type FieldKey,
  type NotifyType,
  type PriceChangeInfo,
  type PriceHistoryEntry,
  type PriceStats,
  type PropertyDoc,
  type PropertyStatus,
  type Severity,
  type SnapshotRecord,
  type TextDiff,
  type UserSettings,
} from '@gsb/shared';
import { computeHashes } from './hash';
import type { Observation } from './observe';

export const REMOVED_CONFIRMATIONS = 2;
export const BLOCKED_CONFIRMATIONS = 2;
export const ERROR_THRESHOLD = 3;
export const RECENT_CHANGE_MS = 24 * 3600_000;
const IMMEDIATE_ERROR_CODES = new Set(['INVALID_URL', 'SSRF_BLOCKED', 'JS_REQUIRED', 'UNSUPPORTED_CONTENT', 'TOO_LARGE']);
const MAX_SNAPSHOT_TEXT = 30_000;

export interface EvalContext {
  now: number;
  propertyId: string;
  settings: UserSettings;
  newId: () => string;
  /** normalizedText of the previous snapshot, for text diffs (only loaded when the content changed). */
  prevText: string | null;
  rand?: () => number;
}

export interface NotifyPlan {
  primary: ChangeType;
  types: ChangeType[];
  severity: Severity;
  price: { oldPrice: number; newPrice: number; difference: number; percentage: number | null } | null;
  currentPrice: number | null;
  alerts: string[];
  fieldChanges: FieldChange[];
  textDiff: TextDiff | null;
  status: PropertyStatus;
  error: { code: string; message: string } | null;
  match: { url: string; title: string | null; confidence: number; oldPrice: number | null } | null;
}

export type Identified<T> = T & { id: string };

export interface EvalResult {
  patch: Partial<PropertyDoc>;
  changes: Identified<ChangeRecord>[];
  priceEntry: Identified<PriceHistoryEntry> | null;
  snapshot: Identified<SnapshotRecord> | null;
  notification: NotifyPlan | null;
  outcome: CheckOutcome;
  firstSuccess: boolean;
}

/** Order used to pick the headline when one check produced several changes. */
export const PRIORITY: ChangeType[] = [
  'PRICE_ALERT',
  'PRICE_DECREASE',
  'REMOVED',
  'POSSIBLE_RELIST',
  'FIELD_CHANGED',
  'RESTORED',
  'PRICE_INCREASE',
  'BLOCKED',
  'ERROR',
  'IMAGE_CHANGED',
  'MINOR_CHANGED',
  'RECOVERED',
];

const norm = (v: string | null | undefined) => (v ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();

export function evaluate(prev: PropertyDoc, obs: Observation, ctx: EvalContext): EvalResult {
  const revision = prev.revision + 1;
  const common: Partial<PropertyDoc> = {
    lastCheckedAt: ctx.now,
    updatedAt: ctx.now,
    revision,
    httpStatus: obs.httpStatus,
    method: obs.method ?? prev.method,
  };
  if (obs.outcome === 'OK' || obs.outcome === 'NOT_MODIFIED') {
    if (obs.outcome === 'NOT_MODIFIED' || !obs.parse) return unchanged(prev, obs, ctx, common);
    return evaluateOk(prev, obs, ctx, common, revision);
  }
  const kind: FailureKind = obs.outcome === 'REMOVED' ? 'REMOVED' : obs.outcome === 'BLOCKED' ? 'BLOCKED' : 'ERROR';
  return evaluateFailure(prev, obs, ctx, common, revision, kind);
}

function decayStatus(prev: PropertyDoc, now: number): PropertyStatus {
  if ((prev.status === 'PRICE_CHANGED' || prev.status === 'UPDATED') && prev.lastChangedAt && now - prev.lastChangedAt < RECENT_CHANGE_MS) {
    return prev.status;
  }
  return 'ACTIVE';
}

function unchanged(prev: PropertyDoc, obs: Observation, ctx: EvalContext, common: Partial<PropertyDoc>): EvalResult {
  const wasFailing = prev.status === 'ERROR' || prev.status === 'BLOCKED' || prev.status === 'REMOVED' || prev.status === 'NOT_FOUND';
  return {
    patch: {
      ...common,
      status: wasFailing ? 'ACTIVE' : decayStatus(prev, ctx.now),
      failure: null,
      lastSuccessAt: ctx.now,
      nextCheckAt: nextCheckTime(ctx.now, prev.intervalMin, ctx.rand),
      httpCache: obs.httpCache ?? prev.httpCache,
    },
    changes: [],
    priceEntry: null,
    snapshot: null,
    notification: null,
    outcome: 'NOT_MODIFIED',
    firstSuccess: false,
  };
}

function makeChange(
  prev: PropertyDoc,
  ctx: EvalContext,
  revision: number,
  type: ChangeType,
  statusAfter: PropertyStatus,
  extra: Partial<ChangeRecord> = {},
): Identified<ChangeRecord> {
  return {
    id: ctx.newId(),
    propertyId: ctx.propertyId,
    ownerId: prev.ownerId,
    at: ctx.now,
    type,
    severity: CHANGE_SEVERITY[type],
    revision,
    oldPrice: null,
    newPrice: null,
    difference: null,
    percentage: null,
    fieldChanges: [],
    textDiff: null,
    statusBefore: prev.status,
    statusAfter,
    beforeSnapshotId: prev.lastSnapshotId,
    afterSnapshotId: null,
    message: null,
    dedupeKey: `${ctx.propertyId}:${revision}:${type}`,
    screenshotPath: null,
    ...extra,
  };
}

// ---------------------------------------------------------------- failures

function evaluateFailure(
  prev: PropertyDoc,
  obs: Observation,
  ctx: EvalContext,
  common: Partial<PropertyDoc>,
  revision: number,
  kind: FailureKind,
): EvalResult {
  const now = ctx.now;
  const code = obs.error?.code ?? kind;
  const message = obs.error?.message ?? kind;
  const same = prev.failure?.kind === kind;
  const count = same ? prev.failure!.count + 1 : 1;
  const failure = { kind, count, code, message, sinceAt: same ? prev.failure!.sinceAt : now };
  const everSucceeded = prev.lastSuccessAt !== null;
  const interval = prev.intervalMin;

  let status: PropertyStatus = prev.status;
  let nextCheckAt: number;
  let changeType: ChangeType | null = null;

  if (kind === 'REMOVED') {
    if (!everSucceeded) {
      status = 'NOT_FOUND';
      nextCheckAt = backoffTime(now, interval, count);
    } else if (count >= REMOVED_CONFIRMATIONS) {
      status = 'REMOVED';
      if (prev.status !== 'REMOVED') changeType = 'REMOVED';
      // Keep watching at a slower pace: listings sometimes come back.
      nextCheckAt = backoffTime(now, Math.max(interval, 60), count - REMOVED_CONFIRMATIONS);
    } else {
      nextCheckAt = now + RETRY_DELAYS_MS[1]; // confirm soon
    }
  } else if (kind === 'BLOCKED') {
    if (count >= BLOCKED_CONFIRMATIONS || code === 'ROBOTS_DISALLOWED') {
      status = 'BLOCKED';
      if (prev.status !== 'BLOCKED') changeType = 'BLOCKED';
      nextCheckAt = backoffTime(now, Math.max(interval, 60), Math.max(0, count - BLOCKED_CONFIRMATIONS));
    } else {
      nextCheckAt = now + RETRY_DELAYS_MS[2]; // back off 10 min before trying again
    }
  } else {
    const immediate = IMMEDIATE_ERROR_CODES.has(code);
    if (count >= ERROR_THRESHOLD || immediate) {
      status = 'ERROR';
      if (prev.status !== 'ERROR') changeType = 'ERROR';
      nextCheckAt = backoffTime(now, interval, Math.max(0, count - ERROR_THRESHOLD) + (immediate ? 2 : 0));
    } else {
      // count 1 → 2 min, count 2 → 10 min (the 30 s retry already happened inline)
      nextCheckAt = now + RETRY_DELAYS_MS[Math.min(count, RETRY_DELAYS_MS.length - 1)]!;
    }
    if (code === 'HTTP_429' && obs.retryAfterMs) nextCheckAt = Math.max(nextCheckAt, now + obs.retryAfterMs);
  }

  const changes = changeType
    ? [makeChange(prev, ctx, revision, changeType, status, { message: `${code}: ${message}`.slice(0, 500), oldPrice: prev.price })]
    : [];
  const reviewReasons = code === 'JS_REQUIRED' ? [...new Set([...prev.reviewReasons, 'JS_REQUIRED'])] : prev.reviewReasons;
  const patch: Partial<PropertyDoc> = {
    ...common,
    status,
    failure,
    lastError: { code, message: message.slice(0, 500), at: now },
    nextCheckAt,
    needsReview: reviewReasons.length > 0,
    reviewReasons,
  };
  if (changes.length) patch.lastChangedAt = now;
  return {
    patch,
    changes,
    priceEntry: null,
    snapshot: null,
    notification: planNotification(prev, changes, ctx.settings, {
      status,
      error: { code, message },
      currentPrice: prev.price,
    }),
    outcome: kind === 'REMOVED' ? 'REMOVED' : kind === 'BLOCKED' ? 'BLOCKED' : 'ERROR',
    firstSuccess: false,
  };
}

// ---------------------------------------------------------------- success

function evaluateOk(prev: PropertyDoc, obs: Observation, ctx: EvalContext, common: Partial<PropertyDoc>, revision: number): EvalResult {
  const r = obs.parse!;
  const now = ctx.now;
  const first = prev.hashes === null;
  const reviewReasons = [...r.reviewReasons];
  const changes: Identified<ChangeRecord>[] = [];
  const snapshotId = ctx.newId();
  const alerts: string[] = [];

  const confident = r.price !== null && r.price.confidence >= MIN_PRICE_CONFIDENCE;
  const observedPrice = confident ? r.price!.value : null;
  const hashes = computeHashes(r, observedPrice);

  // Fields: keep the previous value of fields that vanished when the parse looks degraded.
  const prevCount = Object.keys(prev.fields).length;
  const newCount = Object.keys(r.fields).length;
  const degraded = !first && prevCount >= 5 && newCount < prevCount * 0.6;
  const fields: Partial<Record<FieldKey, string>> = degraded ? { ...prev.fields, ...r.fields } : { ...r.fields };
  if (degraded) reviewReasons.push('FIELDS_MISSING');

  // ---- status recovery
  if (!first && (prev.status === 'REMOVED' || prev.status === 'NOT_FOUND')) {
    changes.push(makeChange(prev, ctx, revision, 'RESTORED', 'ACTIVE', { newPrice: observedPrice, message: 'Tin xuất hiện lại' }));
  } else if (prev.status === 'ERROR' || prev.status === 'BLOCKED') {
    changes.push(makeChange(prev, ctx, revision, 'RECOVERED', 'ACTIVE', { message: `Hết ${prev.status}` }));
  }

  // ---- price
  let priceEntry: Identified<PriceHistoryEntry> | null = null;
  let lastPriceChange: PriceChangeInfo | null = prev.lastPriceChange;
  let priceStats: PriceStats = { ...prev.priceStats };
  let price = prev.price;
  let previousPrice = prev.previousPrice;
  let priceInfo: NotifyPlan['price'] = null;

  if (observedPrice !== null) {
    price = observedPrice;
    if (prev.price === null) {
      priceEntry = { id: ctx.newId(), at: now, price: observedPrice, display: r.price!.display, changeType: 'INITIAL', difference: null, percentage: null };
      priceStats = {
        ...priceStats,
        initial: priceStats.initial ?? observedPrice,
        max: Math.max(priceStats.max ?? observedPrice, observedPrice),
        min: Math.min(priceStats.min ?? observedPrice, observedPrice),
      };
    } else if (observedPrice !== prev.price) {
      const pc = comparePrices(prev.price, observedPrice);
      const type = pc.type as 'PRICE_DECREASE' | 'PRICE_INCREASE';
      previousPrice = prev.price;
      lastPriceChange = { type, oldPrice: prev.price, newPrice: observedPrice, difference: pc.difference!, percentage: pc.percentage, at: now };
      priceInfo = { oldPrice: prev.price, newPrice: observedPrice, difference: pc.difference!, percentage: pc.percentage };
      priceEntry = { id: ctx.newId(), at: now, price: observedPrice, display: r.price!.display, changeType: type, difference: pc.difference, percentage: pc.percentage };
      priceStats = {
        ...priceStats,
        max: Math.max(priceStats.max ?? prev.price, observedPrice),
        min: Math.min(priceStats.min ?? prev.price, observedPrice),
        dropCount: priceStats.dropCount + (type === 'PRICE_DECREASE' ? 1 : 0),
        increaseCount: priceStats.increaseCount + (type === 'PRICE_INCREASE' ? 1 : 0),
        firstDropAt: type === 'PRICE_DECREASE' ? (priceStats.firstDropAt ?? now) : priceStats.firstDropAt,
        lastDropAt: type === 'PRICE_DECREASE' ? now : priceStats.lastDropAt,
      };
      if (prev.track.price) {
        changes.push(
          makeChange(prev, ctx, revision, type, 'PRICE_CHANGED', {
            oldPrice: prev.price,
            newPrice: observedPrice,
            difference: pc.difference,
            percentage: pc.percentage,
            afterSnapshotId: snapshotId,
            message: `${formatManYen(prev.price)} → ${formatManYen(observedPrice)} (${pc.percentage !== null ? formatPercent(pc.percentage) : '?'})`,
          }),
        );
      }
    }
  } else if (prev.price !== null) {
    // PRICE_UNKNOWN: never invent a change from an unreadable price.
    reviewReasons.push(r.price ? 'LOW_PRICE_CONFIDENCE' : 'PRICE_NOT_FOUND');
  }

  // ---- price alerts
  let alertState = prev.alertState;
  if (observedPrice !== null && prev.track.price) {
    const t = prev.alerts.priceAtOrBelow;
    if (t) {
      const met = observedPrice <= t;
      if (met && prev.alertState.priceAtOrBelow !== t) alerts.push(`Giá ≤ ${formatManYen(t)} (hiện tại ${formatManYen(observedPrice)})`);
      alertState = { priceAtOrBelow: met ? t : null };
    }
    if (priceInfo && priceInfo.difference < 0) {
      const drop = -priceInfo.difference;
      if (prev.alerts.dropAmountAtLeast && drop >= prev.alerts.dropAmountAtLeast) {
        alerts.push(`Giảm ≥ ${formatManYen(prev.alerts.dropAmountAtLeast)} (giảm ${formatManYen(drop)})`);
      }
      const pct = priceInfo.percentage !== null ? -priceInfo.percentage : null;
      if (prev.alerts.dropPercentAtLeast && pct !== null && pct >= prev.alerts.dropPercentAtLeast) {
        alerts.push(`Giảm ≥ ${prev.alerts.dropPercentAtLeast}% (giảm ${pct.toFixed(2)}%)`);
      }
    }
    if (alerts.length) {
      changes.push(makeChange(prev, ctx, revision, 'PRICE_ALERT', priceInfo ? 'PRICE_CHANGED' : 'ACTIVE', { newPrice: observedPrice, oldPrice: prev.price, message: alerts.join(' · '), afterSnapshotId: snapshotId }));
    }
  }

  // ---- important fields
  const fieldChanges: FieldChange[] = [];
  if (!first && prev.track.content && prev.hashes && hashes.fields !== prev.hashes.fields) {
    const keys: string[] = ['title', ...FIELD_KEYS];
    for (const key of keys) {
      const before = key === 'title' ? prev.title : (prev.fields[key as FieldKey] ?? null);
      const after = key === 'title' ? (r.title?.value ?? prev.title) : (fields[key as FieldKey] ?? null);
      if (norm(before) === norm(after)) continue;
      if (after === null && degraded) continue;
      fieldChanges.push({ key, label: fieldLabel(key), before: before ?? null, after: after ?? null, importance: fieldImportance(key) });
    }
    const important = fieldChanges.filter((c) => c.importance !== 'low');
    const minor = fieldChanges.filter((c) => c.importance === 'low');
    if (important.length) {
      const severity: Severity = important.some((c) => c.importance === 'high') ? 'HIGH' : 'MEDIUM';
      changes.push(makeChange(prev, ctx, revision, 'FIELD_CHANGED', 'UPDATED', { severity, fieldChanges: important, afterSnapshotId: snapshotId, message: important.map((c) => c.label).join(', ') }));
    }
    if (minor.length) {
      changes.push(makeChange(prev, ctx, revision, 'MINOR_CHANGED', 'ACTIVE', { fieldChanges: minor, afterSnapshotId: snapshotId, message: minor.map((c) => c.label).join(', ') }));
    }
  }

  // ---- free text (FULL mode / custom content area), only when nothing more specific changed
  let diff: TextDiff | null = null;
  if (!first && prev.track.content && prev.hashes && hashes.content !== prev.hashes.content && fieldChanges.length === 0 && !priceInfo) {
    diff = ctx.prevText !== null ? textDiff(ctx.prevText, r.normalizedText) : null;
    if (!diff || diff.added.length || diff.removed.length) {
      changes.push(makeChange(prev, ctx, revision, 'MINOR_CHANGED', 'ACTIVE', { textDiff: diff, afterSnapshotId: snapshotId, message: 'Nội dung trang thay đổi' }));
    }
  }

  // ---- main image
  if (!first && prev.track.image && prev.hashes && hashes.image !== prev.hashes.image && prev.imageUrl && r.imageUrl) {
    changes.push(
      makeChange(prev, ctx, revision, 'IMAGE_CHANGED', 'ACTIVE', {
        fieldChanges: [{ key: 'imageUrl', label: fieldLabel('imageUrl'), before: prev.imageUrl, after: r.imageUrl, importance: 'low' }],
        afterSnapshotId: snapshotId,
      }),
    );
  }

  // ---- status
  const meaningful = changes.filter((c) => c.type !== 'RECOVERED');
  let status: PropertyStatus;
  if (priceInfo) status = 'PRICE_CHANGED';
  else if (changes.some((c) => c.type === 'FIELD_CHANGED')) status = 'UPDATED';
  else status = decayStatus(prev, now);
  for (const c of changes) c.statusAfter = status;

  const takeSnapshot = first || meaningful.length > 0;
  const snapshot: Identified<SnapshotRecord> | null = takeSnapshot
    ? {
        id: snapshotId,
        at: now,
        price,
        priceDisplay: price !== null ? formatManYen(price) : null,
        title: r.title?.value ?? prev.title,
        address: r.address?.value ?? prev.address,
        imageUrl: r.imageUrl,
        fields,
        normalizedText: r.normalizedText.slice(0, MAX_SNAPSHOT_TEXT),
        hashes,
        method: obs.method ?? 'HTTP',
        httpStatus: obs.httpStatus,
        parser: r.parser,
        confidence: r.confidence,
        htmlPath: null,
        screenshotPath: null,
      }
    : null;

  const uniqueReasons = [...new Set(reviewReasons)];
  const patch: Partial<PropertyDoc> = {
    ...common,
    site: r.site,
    title: r.title?.value ?? prev.title,
    address: r.address?.value ?? prev.address,
    propertyCode: r.propertyCode ?? prev.propertyCode,
    imageUrl: r.imageUrl ?? prev.imageUrl,
    fields,
    price,
    priceDisplay: price !== null ? (confident && r.price!.isRange ? r.price!.display : formatManYen(price)) : null,
    previousPrice,
    previousPriceDisplay: previousPrice !== null ? formatManYen(previousPrice) : null,
    lastPriceChange,
    priceStats,
    status,
    needsReview: uniqueReasons.length > 0,
    reviewReasons: uniqueReasons,
    confidence: r.confidence,
    parser: r.parser,
    needsBrowser: obs.usedBrowser ? true : prev.needsBrowser,
    hashes,
    fingerprint: r.fingerprint,
    failure: null,
    alertState,
    httpCache: obs.httpCache,
    lastSuccessAt: now,
    nextCheckAt: nextCheckTime(now, prev.intervalMin, ctx.rand),
  };
  if (snapshot) patch.lastSnapshotId = snapshot.id;
  if (meaningful.length) patch.lastChangedAt = now;

  return {
    patch,
    changes,
    priceEntry,
    snapshot,
    notification: planNotification(prev, changes, ctx.settings, {
      status,
      price: priceInfo,
      alerts,
      fieldChanges: changes.find((c) => c.type === 'FIELD_CHANGED')?.fieldChanges ?? changes.find((c) => c.type === 'MINOR_CHANGED' || c.type === 'IMAGE_CHANGED')?.fieldChanges ?? [],
      textDiff: diff,
      currentPrice: price,
    }),
    outcome: 'OK',
    firstSuccess: first,
  };
}

// ---------------------------------------------------------------- notification plan

const PRICE_TYPES: ChangeType[] = ['PRICE_DECREASE', 'PRICE_INCREASE'];

export function planNotification(
  prev: PropertyDoc,
  changes: ChangeRecord[],
  settings: UserSettings,
  extra: Partial<Omit<NotifyPlan, 'primary' | 'types' | 'severity'>> & { status: PropertyStatus },
): NotifyPlan | null {
  const minRank = SEVERITY_RANK[settings.minSeverity] ?? 0;
  let selected = changes.filter(
    (c) => c.type !== 'RECOVERED' && settings.notifyTypes[c.type as NotifyType] === true && SEVERITY_RANK[c.severity] >= minRank,
  );
  if (prev.alerts.only && !selected.some((c) => c.type === 'PRICE_ALERT')) {
    selected = selected.filter((c) => !PRICE_TYPES.includes(c.type));
  }
  if (selected.length === 0) return null;
  const types = PRIORITY.filter((t) => selected.some((c) => c.type === t));
  const showPrice = types.some((t) => t === 'PRICE_DECREASE' || t === 'PRICE_INCREASE' || t === 'PRICE_ALERT');
  return {
    primary: types[0]!,
    types,
    severity: maxSeverity(selected.map((c) => c.severity)),
    price: showPrice ? (extra.price ?? null) : null,
    currentPrice: extra.currentPrice ?? null,
    alerts: types.includes('PRICE_ALERT') ? (extra.alerts ?? []) : [],
    fieldChanges: types.some((t) => t === 'FIELD_CHANGED' || t === 'MINOR_CHANGED' || t === 'IMAGE_CHANGED') ? (extra.fieldChanges ?? []) : [],
    textDiff: types.includes('MINOR_CHANGED') ? (extra.textDiff ?? null) : null,
    status: extra.status,
    error: extra.error ?? null,
    match: extra.match ?? null,
  };
}
