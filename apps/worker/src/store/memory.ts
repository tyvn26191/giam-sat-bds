// In-memory Store for tests (same semantics as FirestoreStore, including preconditions).

import {
  DEFAULT_SYSTEM_CONFIG,
  DEFAULT_USER_SETTINGS,
  type ChangeRecord,
  type MonitorLog,
  type MonitorRun,
  type PriceHistoryEntry,
  type PropertyDoc,
  type SnapshotRecord,
  type SystemConfig,
  type UserDoc,
} from '@gsb/shared';
import type { CheckCommit, DomainState, PropertyRecord, Store, StoredNotification } from './types';

const clone = <T>(v: T): T => structuredClone(v);

export class MemoryStore implements Store {
  readonly properties = new Map<string, { data: PropertyDoc; version: number }>();
  readonly changes = new Map<string, Map<string, ChangeRecord>>();
  readonly priceHistory = new Map<string, Map<string, PriceHistoryEntry>>();
  readonly snapshots = new Map<string, Map<string, SnapshotRecord>>();
  readonly users = new Map<string, UserDoc>();
  readonly domains = new Map<string, DomainState>();
  readonly locks = new Map<string, { owner: string; until: number }>();
  readonly monitorLogs: MonitorLog[] = [];
  readonly runs = new Map<string, MonitorRun>();
  readonly notifications = new Map<string, StoredNotification>();
  config: SystemConfig = { ...DEFAULT_SYSTEM_CONFIG };
  private seq = 0;
  private versionSeq = 0;

  newId(): string {
    return `id${String(++this.seq).padStart(4, '0')}`;
  }

  private rec(id: string): PropertyRecord | null {
    const p = this.properties.get(id);
    return p ? { id, data: clone(p.data), version: String(p.version) } : null;
  }

  async getProperty(id: string) {
    return this.rec(id);
  }
  async queryDue(dueBefore: number, limit: number) {
    return [...this.properties.entries()]
      .filter(([, p]) => p.data.enabled && p.data.nextCheckAt <= dueBefore)
      .sort((a, b) => a[1].data.nextCheckAt - b[1].data.nextCheckAt)
      .slice(0, limit)
      .map(([id]) => this.rec(id)!);
  }
  async queryByOwner(ownerId: string) {
    return [...this.properties.entries()].filter(([, p]) => p.data.ownerId === ownerId).map(([id]) => this.rec(id)!);
  }
  async queryByCity(ownerId: string, cityKey: string) {
    return (await this.queryByOwner(ownerId)).filter((r) => r.data.fingerprint?.cityKey === cityKey);
  }
  async findByUrl(ownerId: string, url: string) {
    return (await this.queryByOwner(ownerId)).find((r) => r.data.url === url) ?? null;
  }
  async countByOwner(ownerId: string) {
    return (await this.queryByOwner(ownerId)).length;
  }
  async createProperty(id: string, data: PropertyDoc) {
    this.properties.set(id, { data: clone(data), version: ++this.versionSeq });
  }
  async updateProperty(id: string, patch: Partial<PropertyDoc>) {
    const p = this.properties.get(id);
    if (!p) throw new Error(`no property ${id}`);
    this.properties.set(id, { data: { ...p.data, ...clone(patch) }, version: ++this.versionSeq });
  }
  async deleteProperty(id: string) {
    this.properties.delete(id);
    this.changes.delete(id);
    this.priceHistory.delete(id);
    this.snapshots.delete(id);
  }
  private sub<T>(m: Map<string, Map<string, T>>, id: string) {
    let s = m.get(id);
    if (!s) m.set(id, (s = new Map()));
    return s;
  }
  async commitCheck(id: string, version: string | null, c: CheckCommit) {
    const p = this.properties.get(id);
    if (!p) return false;
    if (version !== null && String(p.version) !== version) return false;
    this.properties.set(id, { data: { ...p.data, ...clone(c.patch) }, version: ++this.versionSeq });
    for (const ch of c.changes) {
      const { id: cid, ...rest } = ch;
      this.sub(this.changes, id).set(cid, clone(rest));
    }
    if (c.priceEntry) {
      const { id: pid, ...rest } = c.priceEntry;
      this.sub(this.priceHistory, id).set(pid, clone(rest));
    }
    if (c.snapshot) {
      const { id: sid, ...rest } = c.snapshot;
      this.sub(this.snapshots, id).set(sid, clone(rest));
    }
    return true;
  }
  async setChangeScreenshot(propertyId: string, changeIds: string[], snapshotId: string | null, path: string) {
    for (const cid of changeIds) {
      const c = this.changes.get(propertyId)?.get(cid);
      if (c) c.screenshotPath = path;
    }
    if (snapshotId) {
      const s = this.snapshots.get(propertyId)?.get(snapshotId);
      if (s) s.screenshotPath = path;
    }
  }
  async getSnapshot(propertyId: string, snapshotId: string) {
    const s = this.snapshots.get(propertyId)?.get(snapshotId);
    return s ? clone(s) : null;
  }
  async getUser(uid: string) {
    const u = this.users.get(uid);
    return u ? clone(u) : null;
  }
  async ensureUser(uid: string, email: string | null, now: number) {
    if (!this.users.has(uid)) this.users.set(uid, { email: email ?? '', displayName: null, settings: structuredClone(DEFAULT_USER_SETTINGS), createdAt: now, updatedAt: now });
  }
  async getSystemConfig() {
    return { ...this.config };
  }
  async getDomainState(host: string) {
    return this.domains.get(host) ?? null;
  }
  async setDomainState(host: string, patch: Partial<DomainState>) {
    this.domains.set(host, { cooldownUntil: null, robots: null, ...this.domains.get(host), ...patch });
  }
  async acquireLock(name: string, owner: string, ttlMs: number, now: number) {
    const l = this.locks.get(name);
    if (l && l.until > now && l.owner !== owner) return false;
    this.locks.set(name, { owner, until: now + ttlMs });
    return true;
  }
  async releaseLock(name: string, owner: string) {
    if (this.locks.get(name)?.owner === owner) this.locks.delete(name);
  }
  async addMonitorLog(log: MonitorLog) {
    this.monitorLogs.push(clone(log));
  }
  async addMonitorRun(id: string, run: MonitorRun) {
    this.runs.set(id, clone(run));
  }
  async createNotification(id: string, log: StoredNotification) {
    if (this.notifications.has(id)) return false;
    this.notifications.set(id, clone(log));
    return true;
  }
  async updateNotification(id: string, patch: Partial<StoredNotification>) {
    const n = this.notifications.get(id);
    if (n) this.notifications.set(id, { ...n, ...clone(patch) });
  }
  async queryFailedNotifications(since: number, limit: number) {
    return [...this.notifications.entries()]
      .filter(([, n]) => n.status === 'FAILED' && n.createdAt >= since)
      .slice(0, limit)
      .map(([id, data]) => ({ id, data: clone(data) }));
  }
  async cleanup(olderThan: number) {
    let deleted = 0;
    for (const [pid, snaps] of this.snapshots) {
      const keep = this.properties.get(pid)?.data.lastSnapshotId;
      for (const [sid, s] of snaps) {
        if (s.at < olderThan && sid !== keep) {
          snaps.delete(sid);
          deleted++;
        }
      }
    }
    return { deleted };
  }
}
