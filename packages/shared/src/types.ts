// Firestore document shapes. In application code every *At field is epoch milliseconds (UTC);
// the worker's store converts them to/from Firestore Timestamps ("keys ending in At" rule).

import type { FieldKey, Importance } from './fields';
import type { Fingerprint } from './fingerprint';
import type { IntervalMin } from './schedule';
import type { SiteId } from './sites';
import type { ChangeType, NotifyType, PropertyStatus, Severity } from './status';

export type FetchMethod = 'HTTP' | 'BROWSER' | 'MOCK';
export type MonitorMode = 'IMPORTANT' | 'FULL';
export type Role = 'admin' | 'member';

export interface CustomSelectors {
  price: string | null;
  title: string | null;
  address: string | null;
  content: string | null;
}

export interface PriceAlerts {
  /** Alert once when the price becomes <= this value (JPY). */
  priceAtOrBelow: number | null;
  /** Alert when a single decrease is at least this many JPY. */
  dropAmountAtLeast: number | null;
  /** Alert when a single decrease is at least this percent. */
  dropPercentAtLeast: number | null;
  /** Only notify price changes that hit one of the alerts above. */
  only: boolean;
}

/** User-editable part of a property (also writable directly by the owner through Rules). */
export interface PropertySettings {
  name: string | null;
  groups: string[];
  intervalMin: IntervalMin;
  enabled: boolean;
  monitorMode: MonitorMode;
  selectors: CustomSelectors | null;
  notify: { telegram: boolean; email: boolean };
  track: { price: boolean; content: boolean; image: boolean };
  alerts: PriceAlerts;
  note: string | null;
}

export interface PriceChangeInfo {
  type: 'PRICE_DECREASE' | 'PRICE_INCREASE';
  oldPrice: number;
  newPrice: number;
  difference: number;
  percentage: number | null;
  at: number;
}

export interface PriceStats {
  initial: number | null;
  max: number | null;
  min: number | null;
  dropCount: number;
  increaseCount: number;
  firstDropAt: number | null;
  lastDropAt: number | null;
}

export interface Confidence {
  price: number;
  title: number;
  address: number;
  overall: number;
}

export interface ContentHashes {
  snapshot: string;
  content: string;
  price: string;
  fields: string;
  image: string;
}

export type FailureKind = 'ERROR' | 'BLOCKED' | 'REMOVED';

export interface FailureState {
  kind: FailureKind;
  count: number;
  code: string;
  message: string;
  sinceAt: number;
}

export interface PropertyMatch {
  propertyId: string;
  confidence: number;
  url: string;
  title: string | null;
  status: PropertyStatus;
  price: number | null;
  reasons: string[];
}

export interface PropertyDoc extends PropertySettings {
  ownerId: string;
  url: string;
  site: SiteId;
  host: string;

  title: string | null;
  address: string | null;
  propertyCode: string | null;
  imageUrl: string | null;
  fields: Partial<Record<FieldKey, string>>;

  price: number | null;
  priceDisplay: string | null;
  previousPrice: number | null;
  previousPriceDisplay: string | null;
  lastPriceChange: PriceChangeInfo | null;
  priceStats: PriceStats;

  status: PropertyStatus;
  needsReview: boolean;
  reviewReasons: string[];
  confidence: Confidence | null;
  parser: string | null;
  method: FetchMethod | null;
  httpStatus: number | null;
  needsBrowser: boolean;

  hashes: ContentHashes | null;
  fingerprint: Fingerprint | null;
  matches: PropertyMatch[];

  failure: FailureState | null;
  lastError: { code: string; message: string; at: number } | null;
  alertState: { priceAtOrBelow: number | null };
  httpCache: { etag: string | null; lastModified: string | null } | null;
  lastSnapshotId: string | null;
  lastNotification: { type: ChangeType; severity: Severity; at: number; ok: boolean } | null;

  lastCheckedAt: number | null;
  lastSuccessAt: number | null;
  lastChangedAt: number | null;
  nextCheckAt: number;
  createdAt: number;
  updatedAt: number;
  /** Set when paused by "Pause all" so "Resume all" only resumes those. */
  pausedByAll: boolean;
  /** +1 on every committed check; used for optimistic concurrency and notification dedupe. */
  revision: number;
}

export interface FieldChange {
  key: string;
  label: string;
  before: string | null;
  after: string | null;
  importance: Importance;
}

export interface TextDiff {
  added: string[];
  removed: string[];
}

export interface ChangeRecord {
  propertyId: string;
  ownerId: string;
  at: number;
  type: ChangeType;
  severity: Severity;
  revision: number;
  oldPrice: number | null;
  newPrice: number | null;
  difference: number | null;
  percentage: number | null;
  fieldChanges: FieldChange[];
  textDiff: TextDiff | null;
  statusBefore: PropertyStatus;
  statusAfter: PropertyStatus;
  beforeSnapshotId: string | null;
  afterSnapshotId: string | null;
  message: string | null;
  dedupeKey: string;
  screenshotPath: string | null;
}

export interface PriceHistoryEntry {
  at: number;
  price: number;
  display: string;
  changeType: 'INITIAL' | 'PRICE_DECREASE' | 'PRICE_INCREASE';
  difference: number | null;
  percentage: number | null;
}

export interface SnapshotRecord {
  at: number;
  price: number | null;
  priceDisplay: string | null;
  title: string | null;
  address: string | null;
  imageUrl: string | null;
  fields: Partial<Record<FieldKey, string>>;
  normalizedText: string;
  hashes: ContentHashes;
  method: FetchMethod;
  httpStatus: number | null;
  parser: string;
  confidence: Confidence;
  htmlPath: string | null;
  screenshotPath: string | null;
}

export type CheckOutcome =
  | 'OK'
  | 'NOT_MODIFIED'
  | 'REMOVED'
  | 'BLOCKED'
  | 'ERROR'
  | 'SKIPPED';

export type MonitorTrigger = 'SCHEDULER' | 'MANUAL' | 'RUN_NOW' | 'CREATE';

export interface MonitorLog {
  runId: string;
  propertyId: string;
  ownerId: string;
  trigger: MonitorTrigger;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  method: FetchMethod | null;
  httpStatus: number | null;
  parser: string | null;
  outcome: CheckOutcome;
  priceDetected: number | null;
  fieldsDetected: string[];
  changed: boolean;
  changeTypes: ChangeType[];
  notificationSent: boolean;
  error: { code: string; message: string } | null;
  expireAt: number;
}

export interface MonitorRun {
  trigger: MonitorTrigger;
  ownerId: string | null;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  due: number;
  processed: number;
  changed: number;
  errors: number;
  skipped: number;
  notifications: number;
  expireAt: number;
}

export type NotificationChannelId = 'TELEGRAM' | 'EMAIL';
export type NotificationStatus = 'PENDING' | 'SENT' | 'FAILED' | 'DRY_RUN';

export interface NotificationLog {
  ownerId: string;
  propertyId: string;
  changeIds: string[];
  channel: NotificationChannelId;
  type: ChangeType;
  severity: Severity;
  title: string;
  dedupeKey: string;
  status: NotificationStatus;
  messageId: string | null;
  error: string | null;
  attempts: number;
  createdAt: number;
  sentAt: number | null;
  expireAt: number;
}

export interface UserSettings {
  defaultIntervalMin: IntervalMin;
  timezone: string;
  telegram: { enabled: boolean; chatId: string | null };
  email: { enabled: boolean; to: string | null };
  notifyTypes: Record<NotifyType, boolean>;
  minSeverity: Severity;
}

export interface UserDoc {
  email: string;
  displayName: string | null;
  settings: UserSettings;
  createdAt: number;
  updatedAt: number;
}

export interface SystemConfig {
  paused: boolean;
  maxConcurrentChecks: number;
  perDomainConcurrency: number;
  retentionDays: number;
  updatedAt: number;
  updatedBy: string | null;
}

export const DEFAULT_ALERTS: PriceAlerts = {
  priceAtOrBelow: null,
  dropAmountAtLeast: null,
  dropPercentAtLeast: null,
  only: false,
};

export const DEFAULT_PROPERTY_SETTINGS: PropertySettings = {
  name: null,
  groups: [],
  intervalMin: 15,
  enabled: true,
  monitorMode: 'IMPORTANT',
  selectors: null,
  notify: { telegram: true, email: false },
  track: { price: true, content: true, image: false },
  alerts: DEFAULT_ALERTS,
  note: null,
};

export const DEFAULT_NOTIFY_TYPES: Record<NotifyType, boolean> = {
  PRICE_DECREASE: true,
  PRICE_INCREASE: true,
  PRICE_ALERT: true,
  REMOVED: true,
  RESTORED: true,
  POSSIBLE_RELIST: true,
  FIELD_CHANGED: true,
  MINOR_CHANGED: false,
  IMAGE_CHANGED: false,
  BLOCKED: true,
  ERROR: true,
};

export const DEFAULT_USER_SETTINGS: UserSettings = {
  defaultIntervalMin: 15,
  timezone: 'Asia/Tokyo',
  telegram: { enabled: true, chatId: null },
  email: { enabled: false, to: null },
  notifyTypes: DEFAULT_NOTIFY_TYPES,
  minSeverity: 'LOW',
};

export const DEFAULT_SYSTEM_CONFIG: SystemConfig = {
  paused: false,
  maxConcurrentChecks: 4,
  perDomainConcurrency: 1,
  retentionDays: 90,
  updatedAt: 0,
  updatedBy: null,
};

export const EMPTY_PRICE_STATS: PriceStats = {
  initial: null,
  max: null,
  min: null,
  dropCount: 0,
  increaseCount: 0,
  firstDropAt: null,
  lastDropAt: null,
};

/** Merge stored user settings over defaults (older docs may miss newer keys). */
export function withUserDefaults(s: Partial<UserSettings> | null | undefined): UserSettings {
  return {
    ...DEFAULT_USER_SETTINGS,
    ...(s ?? {}),
    telegram: { ...DEFAULT_USER_SETTINGS.telegram, ...(s?.telegram ?? {}) },
    email: { ...DEFAULT_USER_SETTINGS.email, ...(s?.email ?? {}) },
    notifyTypes: { ...DEFAULT_NOTIFY_TYPES, ...(s?.notifyTypes ?? {}) },
  };
}
