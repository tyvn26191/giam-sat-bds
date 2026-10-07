// Firestore implementation. Convention: every key ending in "At" holding a number is stored as
// a Timestamp (UTC) and read back as epoch milliseconds.

import { FieldPath, Timestamp, type DocumentSnapshot, type Firestore } from 'firebase-admin/firestore';
import {
  DEFAULT_SYSTEM_CONFIG,
  DEFAULT_USER_SETTINGS,
  type MonitorLog,
  type MonitorRun,
  type PropertyDoc,
  type SnapshotRecord,
  type SystemConfig,
  type UserDoc,
} from '@gsb/shared';
import type { CheckCommit, DomainState, PropertyRecord, Store, StoredNotification } from './types';

export function toFirestore(v: unknown, key = ''): unknown {
  if (v === undefined) return undefined;
  if (Array.isArray(v)) return v.map((x) => toFirestore(x));
  if (v instanceof Timestamp || Buffer.isBuffer(v)) return v;
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (x !== undefined) out[k] = toFirestore(x, k);
    }
    return out;
  }
  if (typeof v === 'number' && key.endsWith('At') && Number.isFinite(v)) return Timestamp.fromMillis(v);
  return v;
}

export function fromFirestore<T>(v: unknown): T {
  if (v instanceof Timestamp) return v.toMillis() as T;
  if (Array.isArray(v)) return v.map((x) => fromFirestore(x)) as T;
  if (v !== null && typeof v === 'object' && !Buffer.isBuffer(v)) {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = fromFirestore(x);
    return out as T;
  }
  return v as T;
}

const versionOf = (s: DocumentSnapshot) => (s.updateTime ? `${s.updateTime.seconds}:${s.updateTime.nanoseconds}` : null);
const toTimestamp = (v: string) => {
  const [s, n] = v.split(':').map(Number);
  return new Timestamp(s!, n!);
};

function code(e: unknown): number | undefined {
  return (e as { code?: number }).code;
}

export class FirestoreStore implements Store {
  constructor(private readonly db: Firestore) {}

  private props() {
    return this.db.collection('properties');
  }

  private record(s: DocumentSnapshot): PropertyRecord {
    return { id: s.id, data: fromFirestore<PropertyDoc>(s.data()), version: versionOf(s) };
  }

  newId(): string {
    return this.db.collection('_').doc().id;
  }

  async getProperty(id: string) {
    const s = await this.props().doc(id).get();
    return s.exists ? this.record(s) : null;
  }

  async queryDue(dueBefore: number, limit: number) {
    const q = await this.props()
      .where('enabled', '==', true)
      .where('nextCheckAt', '<=', Timestamp.fromMillis(dueBefore))
      .orderBy('nextCheckAt')
      .limit(limit)
      .get();
    return q.docs.map((d) => this.record(d));
  }

  async queryByOwner(ownerId: string) {
    const q = await this.props().where('ownerId', '==', ownerId).get();
    return q.docs.map((d) => this.record(d));
  }

  async queryByCity(ownerId: string, cityKey: string) {
    const q = await this.props().where('ownerId', '==', ownerId).where(new FieldPath('fingerprint', 'cityKey'), '==', cityKey).limit(200).get();
    return q.docs.map((d) => this.record(d));
  }

  async findByUrl(ownerId: string, url: string) {
    const q = await this.props().where('ownerId', '==', ownerId).where('url', '==', url).limit(1).get();
    return q.empty ? null : this.record(q.docs[0]!);
  }

  async countByOwner(ownerId: string) {
    const agg = await this.props().where('ownerId', '==', ownerId).count().get();
    return agg.data().count;
  }

  async createProperty(id: string, data: PropertyDoc) {
    await this.props().doc(id).create(toFirestore(data) as FirebaseFirestore.DocumentData);
  }

  async updateProperty(id: string, patch: Partial<PropertyDoc>) {
    await this.props().doc(id).update(toFirestore(patch) as FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>);
  }

  async deleteProperty(id: string) {
    await this.db.recursiveDelete(this.props().doc(id));
  }

  async commitCheck(id: string, version: string | null, c: CheckCommit) {
    const ref = this.props().doc(id);
    const batch = this.db.batch();
    const data = toFirestore(c.patch) as FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>;
    if (version) batch.update(ref, data, { lastUpdateTime: toTimestamp(version) });
    else batch.update(ref, data);
    for (const { id: cid, ...rest } of c.changes) batch.set(ref.collection('changes').doc(cid), toFirestore(rest) as FirebaseFirestore.DocumentData);
    if (c.priceEntry) {
      const { id: pid, ...rest } = c.priceEntry;
      batch.set(ref.collection('priceHistory').doc(pid), toFirestore(rest) as FirebaseFirestore.DocumentData);
    }
    if (c.snapshot) {
      const { id: sid, ...rest } = c.snapshot;
      batch.set(ref.collection('snapshots').doc(sid), toFirestore(rest) as FirebaseFirestore.DocumentData);
    }
    try {
      await batch.commit();
      return true;
    } catch (e) {
      if (code(e) === 9 || code(e) === 5) return false; // FAILED_PRECONDITION / NOT_FOUND (deleted meanwhile)
      throw e;
    }
  }

  async setChangeScreenshot(propertyId: string, changeIds: string[], snapshotId: string | null, path: string) {
    const ref = this.props().doc(propertyId);
    const batch = this.db.batch();
    for (const cid of changeIds) batch.update(ref.collection('changes').doc(cid), { screenshotPath: path });
    if (snapshotId) batch.update(ref.collection('snapshots').doc(snapshotId), { screenshotPath: path });
    await batch.commit();
  }

  async getSnapshot(propertyId: string, snapshotId: string) {
    const s = await this.props().doc(propertyId).collection('snapshots').doc(snapshotId).get();
    return s.exists ? fromFirestore<SnapshotRecord>(s.data()) : null;
  }

  async getUser(uid: string) {
    const s = await this.db.collection('users').doc(uid).get();
    return s.exists ? fromFirestore<UserDoc>(s.data()) : null;
  }

  async ensureUser(uid: string, email: string | null, now: number) {
    const ref = this.db.collection('users').doc(uid);
    try {
      await ref.create(toFirestore({ email: email ?? '', displayName: null, settings: DEFAULT_USER_SETTINGS, createdAt: now, updatedAt: now }) as FirebaseFirestore.DocumentData);
    } catch (e) {
      if (code(e) !== 6) throw e; // already exists
    }
  }

  async getSystemConfig(): Promise<SystemConfig> {
    const s = await this.db.collection('system').doc('config').get();
    return { ...DEFAULT_SYSTEM_CONFIG, ...(s.exists ? fromFirestore<Partial<SystemConfig>>(s.data()) : {}) };
  }

  async getDomainState(host: string) {
    const s = await this.db.collection('domains').doc(host).get();
    return s.exists ? fromFirestore<DomainState>(s.data()) : null;
  }

  async setDomainState(host: string, patch: Partial<DomainState>) {
    await this.db.collection('domains').doc(host).set(toFirestore({ ...patch, updatedAt: Date.now() }) as FirebaseFirestore.DocumentData, { merge: true });
  }

  async acquireLock(name: string, owner: string, ttlMs: number, now: number) {
    const ref = this.db.collection('system').doc(`lock_${name}`);
    return this.db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      const cur = s.exists ? fromFirestore<{ owner: string; untilAt: number }>(s.data()) : null;
      if (cur && cur.untilAt > now && cur.owner !== owner) return false;
      tx.set(ref, toFirestore({ owner, untilAt: now + ttlMs }) as FirebaseFirestore.DocumentData);
      return true;
    });
  }

  async releaseLock(name: string, owner: string) {
    const ref = this.db.collection('system').doc(`lock_${name}`);
    await this.db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      if (s.exists && s.get('owner') === owner) tx.delete(ref);
    });
  }

  async addMonitorLog(log: MonitorLog) {
    await this.db.collection('monitorLogs').add(toFirestore(log) as FirebaseFirestore.DocumentData);
  }

  async addMonitorRun(id: string, run: MonitorRun) {
    await this.db.collection('monitorRuns').doc(id).set(toFirestore(run) as FirebaseFirestore.DocumentData);
  }

  async createNotification(id: string, log: StoredNotification) {
    try {
      await this.db.collection('notificationLogs').doc(id).create(toFirestore(log) as FirebaseFirestore.DocumentData);
      return true;
    } catch (e) {
      if (code(e) === 6) return false; // ALREADY_EXISTS → duplicate
      throw e;
    }
  }

  async updateNotification(id: string, patch: Partial<StoredNotification>) {
    await this.db.collection('notificationLogs').doc(id).update(toFirestore(patch) as FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>);
  }

  async queryFailedNotifications(since: number, limit: number) {
    const q = await this.db
      .collection('notificationLogs')
      .where('status', '==', 'FAILED')
      .where('createdAt', '>=', Timestamp.fromMillis(since))
      .orderBy('createdAt')
      .limit(limit)
      .get();
    return q.docs.map((d) => ({ id: d.id, data: fromFirestore<StoredNotification>(d.data()) }));
  }

  async cleanup(olderThan: number) {
    let deleted = 0;
    const cutoff = Timestamp.fromMillis(olderThan);
    const writer = this.db.bulkWriter();
    const keep = new Map<string, string | null>();
    const snaps = await this.db.collectionGroup('snapshots').where('at', '<', cutoff).limit(1000).get();
    for (const d of snaps.docs) {
      const parent = d.ref.parent.parent;
      if (!parent) continue;
      if (!keep.has(parent.id)) {
        const p = await parent.get();
        keep.set(parent.id, p.exists ? ((p.get('lastSnapshotId') as string | null) ?? null) : null);
      }
      if (keep.get(parent.id) === d.id) continue;
      void writer.delete(d.ref);
      deleted++;
    }
    // Fallback when Firestore TTL policies are not configured.
    for (const col of ['monitorLogs', 'notificationLogs', 'monitorRuns']) {
      const old = await this.db.collection(col).where('expireAt', '<', Timestamp.fromMillis(Date.now())).limit(1000).get();
      for (const d of old.docs) {
        void writer.delete(d.ref);
        deleted++;
      }
    }
    await writer.close();
    return { deleted };
  }
}
