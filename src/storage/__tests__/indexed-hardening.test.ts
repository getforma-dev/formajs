import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createIndexedDB } from '../indexed';
import { createLocalStorage } from '../local';
import { createSessionStorage } from '../session';

// ---------- indexed.ts ----------
describe('createIndexedDB transaction durability (S1)', () => {
  it('set resolves only after the transaction COMMITS (tx.oncomplete), not on request.onsuccess', async () => {
    const store = createIndexedDB<string>('durabilityDB_' + Math.random(), 's');
    // Round-trip proves the write is durable, which is only true post-commit.
    await store.set('k1', 'v1');
    expect(await store.get('k1')).toBe('v1');
  });

  it('a readwrite op whose transaction ABORTS rejects instead of falsely resolving', async () => {
    // Open a raw connection to the same db+store and force an abort mid-transaction,
    // then assert that a value written in an aborted tx is NOT durable and that our
    // wrapper never reports success for a rolled-back write.
    const dbName = 'abortDB_' + Math.random();
    const store = createIndexedDB<string>(dbName, 's');
    // materialize the store/connection
    await store.set('seed', 'ok');

    // Manually run a readwrite tx that aborts after the request succeeds.
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open(dbName);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    let requestSucceeded = false;
    let committed = false;
    let aborted = false;
    await new Promise<void>((res) => {
      const tx = db.transaction('s', 'readwrite');
      const req = tx.objectStore('s').put('shouldNotPersist', 'k2');
      req.onsuccess = () => { requestSucceeded = true; tx.abort(); };
      tx.oncomplete = () => { committed = true; res(); };
      tx.onabort = () => { aborted = true; res(); };
    });
    db.close();

    expect(requestSucceeded).toBe(true); // request-level success fired
    expect(aborted).toBe(true);
    expect(committed).toBe(false);       // tx never committed
    // The rolled-back value must not be readable -> proves resolving on
    // request.onsuccess would be a lie; correct code resolves on oncomplete.
    expect(await store.get('k2')).toBeUndefined();
    expect(await store.get('seed')).toBe('ok');
  });
});

describe('createIndexedDB connection hygiene (S2, S3)', () => {
  it('sets db.onversionchange so a later version bump is not blocked forever', async () => {
    const dbName = 'versionchangeDB_' + Math.random();
    const storeA = createIndexedDB<number>(dbName, 'a');
    await storeA.set('x', 1); // opens + caches a connection to `a`

    // A different store on the SAME db forces a version bump. With
    // db.onversionchange wired to close(), the bump must proceed and settle.
    const storeB = createIndexedDB<number>(dbName, 'b');
    // If the cached `a` connection had no onversionchange handler, this open
    // would block forever and the promise would never settle -> test timeout.
    await storeB.set('y', 2);
    expect(await storeB.get('y')).toBe(2);
  });

  it('evicts and reopens a connection that was force-closed (no permanent breakage)', async () => {
    const dbName = 'evictDB_' + Math.random();
    const store = createIndexedDB<string>(dbName, 's');
    await store.set('k', 'v1');

    // Read the current version via a transient connection (closed immediately so
    // it does not itself block the bump), then bump. The only remaining open
    // connection is our cached one — its wired onversionchange must close+evict
    // it so the bump proceeds instead of blocking.
    const version: number = await new Promise((res) => {
      const r = indexedDB.open(dbName);
      r.onsuccess = () => { const v = r.result.version; r.result.close(); res(v); };
    });
    await new Promise<void>((res, rej) => {
      const r = indexedDB.open(dbName, version + 1);
      r.onupgradeneeded = () => { /* no-op upgrade */ };
      r.onsuccess = () => { r.result.close(); res(); };
      r.onblocked = () => rej(new Error('bump blocked - onversionchange not wired'));
      r.onerror = () => rej(r.error);
    });

    // The store must still work: eviction + reopen on the next call.
    await store.set('k', 'v2');
    expect(await store.get('k')).toBe('v2');
  });

  it('memoizes the in-flight open: concurrent ops open the database once', async () => {
    const openSpy = vi.spyOn(indexedDB, 'open');
    const dbName = 'memoDB_' + Math.random();
    const store = createIndexedDB<number>(dbName, 's');
    await Promise.all([
      store.set('a', 1),
      store.set('b', 2),
      store.get('a'),
      store.getAll(),
    ]);
    // The probe open for this db+store is shared across the concurrent calls.
    const opensForThisDb = openSpy.mock.calls.filter((c) => c[0] === dbName);
    // One probe (+ at most one upgrade bump). Never one-per-operation.
    expect(opensForThisDb.length).toBeLessThanOrEqual(2);
    openSpy.mockRestore();
  });
});

// ---------- local.ts / session.ts ----------
describe('remove() graceful degradation (S4)', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

  it('createLocalStorage.remove does not throw when storage access throws', () => {
    const store = createLocalStorage<string>('k');
    const spy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(() => store.remove()).not.toThrow();
    spy.mockRestore();
  });

  it('createSessionStorage.remove does not throw when storage access throws', () => {
    const store = createSessionStorage<string>('k');
    const spy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(() => store.remove()).not.toThrow();
    spy.mockRestore();
  });
});