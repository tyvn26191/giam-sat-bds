import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, collection, query, where, setDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

let env: RulesTestEnvironment;

const settings = {
  defaultIntervalMin: 15,
  timezone: 'Asia/Tokyo',
  telegram: { enabled: true, chatId: '123456789' },
  email: { enabled: false, to: null },
  notifyTypes: { PRICE_DECREASE: true, MINOR_CHANGED: false },
  minSeverity: 'LOW',
};

const property = (ownerId: string) => ({
  ownerId,
  url: 'https://suumo.jp/ikkodate/aichi/sc_nishio/nc_76543210/',
  site: 'SUUMO',
  host: 'suumo.jp',
  name: null,
  groups: ['西尾市'],
  intervalMin: 15,
  enabled: true,
  pausedByAll: false,
  monitorMode: 'IMPORTANT',
  selectors: null,
  notify: { telegram: true, email: false },
  track: { price: true, content: true, image: false },
  alerts: { priceAtOrBelow: null, dropAmountAtLeast: null, dropPercentAtLeast: null, only: false },
  note: null,
  price: 31900000,
  status: 'ACTIVE',
  revision: 3,
  nextCheckAt: Timestamp.now(),
  updatedAt: Timestamp.now(),
});

const member = (uid: string, email = `${uid}@example.com`) => env.authenticatedContext(uid, { role: 'member', email }).firestore();
const admin = () => env.authenticatedContext('root', { role: 'admin', email: 'root@example.com' }).firestore();
const pending = () => env.authenticatedContext('pending', { email: 'pending@example.com' }).firestore();

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-gsb',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
afterAll(() => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'properties/pa'), property('alice'));
    await setDoc(doc(db, 'properties/pb'), property('bob'));
    await setDoc(doc(db, 'properties/pa/priceHistory/h1'), { price: 31900000, at: Timestamp.now() });
    await setDoc(doc(db, 'properties/pa/changes/c1'), { type: 'PRICE_DECREASE', ownerId: 'alice' });
    await setDoc(doc(db, 'notificationLogs/n1'), { ownerId: 'alice', propertyId: 'pa', status: 'SENT' });
    await setDoc(doc(db, 'monitorLogs/l1'), { ownerId: 'alice', propertyId: 'pa' });
    await setDoc(doc(db, 'monitorRuns/r1'), { processed: 1 });
    await setDoc(doc(db, 'users/alice'), { email: 'alice@example.com', displayName: null, settings, createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
  });
});

describe('access requires an approved role', () => {
  it('signed-out and pending users read nothing', async () => {
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'properties/pa')));
    await assertFails(getDoc(doc(pending(), 'properties/pa')));
    await assertFails(setDoc(doc(pending(), 'users/pending'), { email: 'pending@example.com', displayName: null, settings, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  });
});

describe('properties', () => {
  it('owner reads own, not others; queries must filter by owner', async () => {
    await assertSucceeds(getDoc(doc(member('alice'), 'properties/pa')));
    await assertFails(getDoc(doc(member('alice'), 'properties/pb')));
    await assertSucceeds(getDocs(query(collection(member('alice'), 'properties'), where('ownerId', '==', 'alice'))));
    await assertFails(getDocs(collection(member('alice'), 'properties')));
    await assertSucceeds(getDocs(collection(admin(), 'properties')));
  });

  it('owner edits settings fields with valid values', async () => {
    const db = member('alice');
    await assertSucceeds(
      updateDoc(doc(db, 'properties/pa'), {
        name: '本命',
        groups: ['西尾市', '本命'],
        intervalMin: 30,
        enabled: false,
        monitorMode: 'FULL',
        selectors: { price: '#price', title: null, address: null, content: null },
        notify: { telegram: true, email: true },
        track: { price: true, content: false, image: true },
        alerts: { priceAtOrBelow: 30000000, dropAmountAtLeast: 500000, dropPercentAtLeast: 3, only: true },
        note: 'メモ',
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('rejects invalid settings and worker-owned fields', async () => {
    const db = member('alice');
    const ref = doc(db, 'properties/pa');
    await assertFails(updateDoc(ref, { intervalMin: 5, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { groups: ['x'.repeat(41)], updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { groups: Array(11).fill('a'), updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { groups: [1], updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { alerts: { priceAtOrBelow: -1, dropAmountAtLeast: null, dropPercentAtLeast: null, only: false }, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { selectors: { price: 'x', evil: 'y' }, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { name: 'x' })); // updatedAt must be the server time
    await assertFails(updateDoc(ref, { price: 1, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { status: 'REMOVED', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { url: 'http://169.254.169.254/', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { ownerId: 'bob', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { nextCheckAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(member('bob'), 'properties/pa'), { name: 'x', updatedAt: serverTimestamp() }));
  });

  it('create and delete go through the worker API only', async () => {
    await assertFails(setDoc(doc(member('alice'), 'properties/new'), property('alice')));
    await assertFails(deleteDoc(doc(member('alice'), 'properties/pa')));
    await assertFails(deleteDoc(doc(admin(), 'properties/pa')));
  });

  it('history sub-collections: owner reads, nobody writes', async () => {
    await assertSucceeds(getDocs(collection(member('alice'), 'properties/pa/priceHistory')));
    await assertSucceeds(getDoc(doc(member('alice'), 'properties/pa/changes/c1')));
    await assertFails(getDocs(collection(member('bob'), 'properties/pa/priceHistory')));
    await assertFails(setDoc(doc(member('alice'), 'properties/pa/priceHistory/h2'), { price: 1 }));
    await assertFails(getDocs(collection(member('alice'), 'properties/pa/secret')));
    await assertSucceeds(getDocs(collection(admin(), 'properties/pa/changes')));
  });
});

describe('users/{uid} settings', () => {
  it('owner reads and updates own valid settings', async () => {
    await assertSucceeds(getDoc(doc(member('alice'), 'users/alice')));
    await assertFails(getDoc(doc(member('bob'), 'users/alice')));
    await assertSucceeds(updateDoc(doc(member('alice'), 'users/alice'), { settings: { ...settings, email: { enabled: true, to: 'me@example.com' } }, updatedAt: serverTimestamp() }));
  });

  it('rejects bad chat ids, emails, intervals and unknown keys', async () => {
    const ref = doc(member('alice'), 'users/alice');
    await assertFails(updateDoc(ref, { settings: { ...settings, telegram: { enabled: true, chatId: 'abc def' } }, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { settings: { ...settings, email: { enabled: true, to: 'not-an-email' } }, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { settings: { ...settings, defaultIntervalMin: 1 }, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { settings: { ...settings, notifyTypes: { HACK: true } }, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { settings: { ...settings, notifyTypes: { ERROR: 'yes' } }, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { role: 'admin', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { email: 'other@example.com', updatedAt: serverTimestamp() }));
  });

  it('a member can create their own doc with their token email only', async () => {
    const db = member('carol');
    await assertFails(setDoc(doc(db, 'users/carol'), { email: 'x@example.com', displayName: null, settings, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertSucceeds(setDoc(doc(db, 'users/carol'), { email: 'carol@example.com', displayName: null, settings, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(db, 'users/dave'), { email: 'carol@example.com', displayName: null, settings, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  });
});

describe('logs and system', () => {
  it('logs: owner reads own (filtered), nobody writes', async () => {
    await assertSucceeds(getDocs(query(collection(member('alice'), 'notificationLogs'), where('ownerId', '==', 'alice'))));
    await assertFails(getDocs(collection(member('alice'), 'notificationLogs')));
    await assertFails(getDoc(doc(member('bob'), 'monitorLogs/l1')));
    await assertSucceeds(getDoc(doc(member('alice'), 'monitorLogs/l1')));
    await assertFails(setDoc(doc(member('alice'), 'notificationLogs/n2'), { ownerId: 'alice' }));
    await assertFails(getDoc(doc(member('alice'), 'monitorRuns/r1')));
    await assertSucceeds(getDoc(doc(admin(), 'monitorRuns/r1')));
  });

  it('system config: admin only, validated', async () => {
    const ok = { paused: true, maxConcurrentChecks: 4, perDomainConcurrency: 1, retentionDays: 90, updatedAt: serverTimestamp(), updatedBy: 'root' };
    await assertSucceeds(setDoc(doc(admin(), 'system/config'), ok));
    await assertFails(setDoc(doc(member('alice'), 'system/config'), { ...ok, updatedBy: 'alice' }));
    await assertFails(setDoc(doc(admin(), 'system/config'), { ...ok, perDomainConcurrency: 10 }));
    await assertFails(setDoc(doc(admin(), 'system/config'), { ...ok, updatedBy: 'someone' }));
    await assertFails(setDoc(doc(admin(), 'system/lock_runDue'), { owner: 'x' }));
    await assertFails(getDoc(doc(member('alice'), 'system/config')));
  });
});
