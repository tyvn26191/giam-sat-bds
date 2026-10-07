// Firestore listeners. Every query filters on exactly what the Rules check (ownerId).

import {
  Timestamp,
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type DocumentData,
  type Query,
} from 'firebase/firestore';
import { useEffect, useState } from 'react';
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
import { db } from './firebase';

/** Timestamps → epoch ms, recursively (mirror of the worker's convention). */
export function fromFs<T>(v: unknown): T {
  if (v instanceof Timestamp) return v.toMillis() as T;
  if (Array.isArray(v)) return v.map((x) => fromFs(x)) as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = fromFs(x);
    return out as T;
  }
  return v as T;
}

export type WithId<T> = T & { id: string };

interface Live<T> {
  data: T;
  loading: boolean;
  error: string | null;
}

function useQuery<T>(q: Query<DocumentData> | null, deps: unknown[]): Live<WithId<T>[]> {
  const [state, setState] = useState<Live<WithId<T>[]>>({ data: [], loading: true, error: null });
  useEffect(() => {
    if (!q) {
      setState({ data: [], loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    return onSnapshot(
      q,
      (snap) => setState({ data: snap.docs.map((d) => ({ id: d.id, ...fromFs<T>(d.data()) })), loading: false, error: null }),
      (err) => setState({ data: [], loading: false, error: err.message }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

function useDoc<T>(path: string | null): Live<WithId<T> | null> {
  const [state, setState] = useState<Live<WithId<T> | null>>({ data: null, loading: true, error: null });
  useEffect(() => {
    if (!path) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    return onSnapshot(
      doc(db, path),
      (snap) => setState({ data: snap.exists() ? { id: snap.id, ...fromFs<T>(snap.data()) } : null, loading: false, error: null }),
      (err) => setState({ data: null, loading: false, error: err.message }),
    );
  }, [path]);
  return state;
}

export type Property = WithId<PropertyDoc>;

export function useProperties(uid: string) {
  return useQuery<PropertyDoc>(query(collection(db, 'properties'), where('ownerId', '==', uid)), [uid]);
}

export function useProperty(id: string | undefined) {
  return useDoc<PropertyDoc>(id ? `properties/${id}` : null);
}

export function usePriceHistory(id: string) {
  return useQuery<PriceHistoryEntry>(query(collection(db, 'properties', id, 'priceHistory'), orderBy('at', 'asc'), limit(500)), [id]);
}

export function useChanges(id: string) {
  return useQuery<ChangeRecord>(query(collection(db, 'properties', id, 'changes'), orderBy('at', 'desc'), limit(100)), [id]);
}

export async function loadSnapshots(id: string, n = 10): Promise<WithId<SnapshotRecord>[]> {
  const snap = await getDocs(query(collection(db, 'properties', id, 'snapshots'), orderBy('at', 'desc'), limit(n)));
  return snap.docs.map((d) => ({ id: d.id, ...fromFs<SnapshotRecord>(d.data()) }));
}

export function useMonitorLogs(uid: string, propertyId?: string, n = 100) {
  const base = collection(db, 'monitorLogs');
  const q = propertyId
    ? query(base, where('ownerId', '==', uid), where('propertyId', '==', propertyId), orderBy('startedAt', 'desc'), limit(n))
    : query(base, where('ownerId', '==', uid), orderBy('startedAt', 'desc'), limit(n));
  return useQuery<MonitorLog>(q, [uid, propertyId, n]);
}

export function useAllMonitorLogs(enabled: boolean, n = 100) {
  return useQuery<MonitorLog>(enabled ? query(collection(db, 'monitorLogs'), orderBy('startedAt', 'desc'), limit(n)) : null, [enabled, n]);
}

export function useNotificationLogs(uid: string, propertyId?: string, n = 50) {
  const base = collection(db, 'notificationLogs');
  const q = propertyId
    ? query(base, where('ownerId', '==', uid), where('propertyId', '==', propertyId), orderBy('createdAt', 'desc'), limit(n))
    : query(base, where('ownerId', '==', uid), orderBy('createdAt', 'desc'), limit(n));
  return useQuery<NotificationLog>(q, [uid, propertyId, n]);
}

export function useMonitorRuns(enabled: boolean) {
  return useQuery<MonitorRun>(enabled ? query(collection(db, 'monitorRuns'), orderBy('startedAt', 'desc'), limit(50)) : null, [enabled]);
}

export function useUserDoc(uid: string) {
  return useDoc<UserDoc>(`users/${uid}`);
}

export function useSystemConfig(enabled: boolean) {
  return useDoc<SystemConfig>(enabled ? 'system/config' : null);
}
