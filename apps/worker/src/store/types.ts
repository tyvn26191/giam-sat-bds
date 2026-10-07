import type {
  ChangeRecord,
  MonitorLog,
  MonitorRun,
  NotificationLog,
  PriceHistoryEntry,
  PropertyDoc,
  SnapshotRecord,
  SystemConfig,
  UserDoc,
} from '@gsb/shared';
import type { RobotsPolicy } from '../fetch/robots';

export interface PropertyRecord {
  id: string;
  data: PropertyDoc;
  /** Opaque version used as a write precondition (Firestore updateTime). */
  version: string | null;
}

export interface DomainState {
  cooldownUntil: number | null;
  robots: RobotsPolicy | null;
}

export interface CheckCommit {
  patch: Partial<PropertyDoc>;
  changes: (ChangeRecord & { id: string })[];
  priceEntry: (PriceHistoryEntry & { id: string }) | null;
  snapshot: (SnapshotRecord & { id: string }) | null;
}

export interface StoredNotification extends NotificationLog {
  /** JSON of the NotificationPayload, kept so a failed send can be retried. */
  payload: string;
  recipient: string;
  retryable: boolean;
}

/**
 * Persistence used by the engine and the API. FirestoreStore in production, MemoryStore in
 * tests. All times are epoch milliseconds.
 */
export interface Store {
  newId(): string;

  getProperty(id: string): Promise<PropertyRecord | null>;
  queryDue(dueBefore: number, limit: number): Promise<PropertyRecord[]>;
  queryByOwner(ownerId: string): Promise<PropertyRecord[]>;
  queryByCity(ownerId: string, cityKey: string): Promise<PropertyRecord[]>;
  findByUrl(ownerId: string, url: string): Promise<PropertyRecord | null>;
  countByOwner(ownerId: string): Promise<number>;
  createProperty(id: string, data: PropertyDoc): Promise<void>;
  updateProperty(id: string, patch: Partial<PropertyDoc>): Promise<void>;
  /** Deletes the property and its sub-collections. */
  deleteProperty(id: string): Promise<void>;
  /** Atomic write of one check; false when the property changed since `version` was read. */
  commitCheck(id: string, version: string | null, commit: CheckCommit): Promise<boolean>;
  setChangeScreenshot(propertyId: string, changeIds: string[], snapshotId: string | null, path: string): Promise<void>;
  getSnapshot(propertyId: string, snapshotId: string): Promise<SnapshotRecord | null>;

  getUser(uid: string): Promise<UserDoc | null>;
  /** Create users/{uid} with default settings when it does not exist yet. */
  ensureUser(uid: string, email: string | null, now: number): Promise<void>;
  getSystemConfig(): Promise<SystemConfig>;
  getDomainState(host: string): Promise<DomainState | null>;
  setDomainState(host: string, patch: Partial<DomainState>): Promise<void>;

  acquireLock(name: string, owner: string, ttlMs: number, now: number): Promise<boolean>;
  releaseLock(name: string, owner: string): Promise<void>;

  addMonitorLog(log: MonitorLog): Promise<void>;
  addMonitorRun(id: string, run: MonitorRun): Promise<void>;

  /** Creates the log only if `id` does not exist yet (notification dedupe). */
  createNotification(id: string, log: StoredNotification): Promise<boolean>;
  updateNotification(id: string, patch: Partial<StoredNotification>): Promise<void>;
  queryFailedNotifications(since: number, limit: number): Promise<{ id: string; data: StoredNotification }[]>;

  /** Retention: old snapshots (keeping the newest per property), logs without TTL. */
  cleanup(olderThan: number, keepSnapshotsPerProperty: number): Promise<{ deleted: number }>;
}
