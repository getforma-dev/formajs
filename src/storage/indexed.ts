/**
 * Forma Storage - IndexedDB
 *
 * Simplified IndexedDB wrapper with lazy connection and promise-based API.
 * Zero dependencies — native browser APIs only.
 */

export interface IDBStore<T> {
  get(key: string): Promise<T | undefined>;
  set(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  getAll(): Promise<T[]>;
  keys(): Promise<string[]>;
  clear(): Promise<void>;
}

/** Cached database connections keyed by "dbName::storeName". */
const dbCache = new Map<string, Promise<IDBDatabase>>();

/**
 * Per-database open serialization. Concurrent createIndexedDB(db, storeA/B/...)
 * calls each bump db.version+1; without serialization they compute the version
 * from a stale probe and race, so some stores are never created and their
 * connections are permanently wedged. Chaining opens for the same db name makes
 * each see the previous open's committed version.
 */
const openLocks = new Map<string, Promise<unknown>>();

/**
 * Open (or retrieve a cached) IndexedDB database, ensuring the
 * requested object store exists.
 */
function openDB(dbName: string, storeName: string): Promise<IDBDatabase> {
  const cacheKey = `${dbName}::${storeName}`;
  const cached = dbCache.get(cacheKey);
  if (cached) return cached;

  // Serialize this open behind any in-flight open for the same db name.
  const prevLock = openLocks.get(dbName) ?? Promise.resolve();
  const promise = prevLock.then(() => doOpen(dbName, storeName, cacheKey), () => doOpen(dbName, storeName, cacheKey));

  dbCache.set(cacheKey, promise);
  // Advance the lock (never rejects, so the chain keeps flowing).
  openLocks.set(dbName, promise.then(() => undefined, () => undefined));

  // If the open fails, remove from cache so the next call retries.
  promise.catch(() => {
    dbCache.delete(cacheKey);
  });

  return promise;
}

function doOpen(dbName: string, storeName: string, cacheKey: string): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    // Wire a resolved connection so it closes + evicts on a version change
    // (another tab/store bumping the version) or a forced close. Without this a
    // later bump blocks forever and a stale connection is never dropped.
    const wire = (db: IDBDatabase) => {
      db.onversionchange = () => { db.close(); dbCache.delete(cacheKey); };
      db.onclose = () => { dbCache.delete(cacheKey); };
      resolve(db);
    };

    // First, try opening at the current (or default) version.
    const probe = indexedDB.open(dbName);

    probe.onerror = () => reject(probe.error);

    probe.onsuccess = () => {
      const db = probe.result;
      if (db.objectStoreNames.contains(storeName)) {
        wire(db);
        return;
      }
      // Store doesn't exist yet — close and reopen with a version bump. Opens
      // are serialized per db, so this version is current, not stale.
      const nextVersion = db.version + 1;
      db.close();

      const upgrade = indexedDB.open(dbName, nextVersion);
      upgrade.onerror = () => reject(upgrade.error);
      // Backstop: if another connection blocks the bump, settle (reject) so the
      // promise does not leak; the next call retries.
      upgrade.onblocked = () =>
        reject(upgrade.error ?? new DOMException('Upgrade blocked: another connection is open', 'AbortError'));
      upgrade.onupgradeneeded = () => {
        const upgradedDB = upgrade.result;
        if (!upgradedDB.objectStoreNames.contains(storeName)) {
          upgradedDB.createObjectStore(storeName);
        }
      };
      upgrade.onsuccess = () => {
        const upgradedDB = upgrade.result;
        if (!upgradedDB.objectStoreNames.contains(storeName)) {
          // Should not happen with serialized opens; reject (do not cache a
          // store-less connection) so the next call retries cleanly.
          upgradedDB.close();
          reject(new DOMException(`Object store "${storeName}" was not created`, 'NotFoundError'));
          return;
        }
        wire(upgradedDB);
      };
    };

    probe.onupgradeneeded = () => {
      const db = probe.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName);
      }
    };
  });
}

/**
 * Create a simplified IndexedDB store.
 *
 * ```ts
 * const store = createIndexedDB<User>('myApp', 'users');
 * await store.set('u1', { name: 'Alice' });
 * const user = await store.get('u1'); // { name: 'Alice' }
 * ```
 */
export function createIndexedDB<T>(
  dbName: string,
  storeName: string = 'default',
): IDBStore<T> {
  const cacheKey = `${dbName}::${storeName}`;

  /** Helper: run a single read/write transaction and return the request result. */
  function withStore<R>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<R>,
  ): Promise<R> {
    return openDB(dbName, storeName).then(
      (db) =>
        new Promise<R>((resolve, reject) => {
          let request: IDBRequest<R>;
          let tx: IDBTransaction;
          try {
            tx = db.transaction(storeName, mode);
            request = fn(tx.objectStore(storeName));
          } catch (err) {
            // A transaction on a closing connection throws synchronously.
            reject(err);
            return;
          }
          let result: R;
          request.onsuccess = () => {
            result = request.result;
            // Reads are durable at request success; writes only at commit.
            if (mode === 'readonly') resolve(result);
          };
          // A readwrite value is only durable once the transaction COMMITS —
          // resolving on request.onsuccess would falsely report success for a
          // write that later aborts (e.g. QuotaExceededError at commit).
          tx.oncomplete = () => resolve(result);
          tx.onerror = () => reject(tx.error ?? request.error);
          tx.onabort = () => reject(tx.error ?? request.error ?? new DOMException('Transaction aborted', 'AbortError'));
        }),
    ).catch((err: unknown) => {
      // Evict a broken/closing/store-less connection so the next call reopens
      // cleanly (NotFoundError = the cached connection lacks the store).
      const name = (err as { name?: string } | null)?.name;
      if (name === 'InvalidStateError' || name === 'AbortError' || name === 'NotFoundError') {
        dbCache.delete(cacheKey);
      }
      throw err;
    });
  }

  return {
    get(key: string): Promise<T | undefined> {
      return withStore('readonly', (store) => store.get(key)) as Promise<T | undefined>;
    },

    set(key: string, value: T): Promise<void> {
      return withStore('readwrite', (store) => store.put(value, key)).then(
        () => undefined,
      );
    },

    delete(key: string): Promise<void> {
      return withStore('readwrite', (store) => store.delete(key)).then(
        () => undefined,
      );
    },

    getAll(): Promise<T[]> {
      return withStore('readonly', (store) => store.getAll()) as Promise<T[]>;
    },

    keys(): Promise<string[]> {
      return withStore('readonly', (store) => store.getAllKeys()).then(
        (keys) => keys.map(String),
      );
    },

    clear(): Promise<void> {
      return withStore('readwrite', (store) => store.clear()).then(
        () => undefined,
      );
    },
  };
}
