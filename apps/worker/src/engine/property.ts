import {
  DEFAULT_ALERTS,
  DEFAULT_PROPERTY_SETTINGS,
  EMPTY_PRICE_STATS,
  guessSite,
  isValidInterval,
  type PropertyDoc,
  type PropertySettings,
} from '@gsb/shared';

/** Sanitise user-provided settings (API input) on top of defaults. */
export function sanitizeSettings(input: Partial<PropertySettings> | undefined, defaultInterval: PropertySettings['intervalMin']): PropertySettings {
  const s = input ?? {};
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  const num = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= max ? v : null);
  const groups = Array.isArray(s.groups)
    ? [...new Set(s.groups.filter((g): g is string => typeof g === 'string').map((g) => g.trim().slice(0, 40)).filter(Boolean))].slice(0, 10)
    : [];
  const sel = s.selectors && typeof s.selectors === 'object' ? s.selectors : null;
  return {
    name: str(s.name, 200),
    groups,
    intervalMin: isValidInterval(s.intervalMin) ? s.intervalMin : defaultInterval,
    enabled: bool(s.enabled, true),
    monitorMode: s.monitorMode === 'FULL' ? 'FULL' : 'IMPORTANT',
    selectors: sel
      ? { price: str(sel.price, 300), title: str(sel.title, 300), address: str(sel.address, 300), content: str(sel.content, 300) }
      : null,
    notify: { telegram: bool(s.notify?.telegram, DEFAULT_PROPERTY_SETTINGS.notify.telegram), email: bool(s.notify?.email, DEFAULT_PROPERTY_SETTINGS.notify.email) },
    track: {
      price: bool(s.track?.price, true),
      content: bool(s.track?.content, true),
      image: bool(s.track?.image, false),
    },
    alerts: {
      priceAtOrBelow: num(s.alerts?.priceAtOrBelow, 1e11) !== null ? Math.round(s.alerts!.priceAtOrBelow!) : null,
      dropAmountAtLeast: num(s.alerts?.dropAmountAtLeast, 1e11) !== null ? Math.round(s.alerts!.dropAmountAtLeast!) : null,
      dropPercentAtLeast: num(s.alerts?.dropPercentAtLeast, 100),
      only: bool(s.alerts?.only, DEFAULT_ALERTS.only),
    },
    note: str(s.note, 1000),
  };
}

export function newPropertyDoc(input: { ownerId: string; url: string; settings: PropertySettings; now: number }): PropertyDoc {
  const host = new URL(input.url).hostname.toLowerCase();
  return {
    ...input.settings,
    ownerId: input.ownerId,
    url: input.url,
    site: guessSite(host),
    host,
    title: null,
    address: null,
    propertyCode: null,
    imageUrl: null,
    fields: {},
    price: null,
    priceDisplay: null,
    previousPrice: null,
    previousPriceDisplay: null,
    lastPriceChange: null,
    priceStats: { ...EMPTY_PRICE_STATS },
    status: 'PENDING',
    needsReview: false,
    reviewReasons: [],
    confidence: null,
    parser: null,
    method: null,
    httpStatus: null,
    needsBrowser: false,
    hashes: null,
    fingerprint: null,
    matches: [],
    failure: null,
    lastError: null,
    alertState: { priceAtOrBelow: null },
    httpCache: null,
    lastSnapshotId: null,
    lastNotification: null,
    lastCheckedAt: null,
    lastSuccessAt: null,
    lastChangedAt: null,
    nextCheckAt: input.now,
    createdAt: input.now,
    updatedAt: input.now,
    pausedByAll: false,
    revision: 0,
  };
}

/** Reset detection state when the URL changes (history stays). */
export function resetForNewUrl(url: string, now: number): Partial<PropertyDoc> {
  const host = new URL(url).hostname.toLowerCase();
  return {
    url,
    host,
    site: guessSite(host),
    status: 'PENDING',
    hashes: null,
    fingerprint: null,
    matches: [],
    failure: null,
    needsBrowser: false,
    httpCache: null,
    propertyCode: null,
    title: null,
    address: null,
    imageUrl: null,
    fields: {},
    price: null,
    priceDisplay: null,
    previousPrice: null,
    previousPriceDisplay: null,
    lastPriceChange: null,
    priceStats: { ...EMPTY_PRICE_STATS },
    alertState: { priceAtOrBelow: null },
    lastSuccessAt: null,
    needsReview: false,
    reviewReasons: [],
    nextCheckAt: now,
    updatedAt: now,
  };
}
