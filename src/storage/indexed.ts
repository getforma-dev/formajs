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
 * Open (or retrieve a cached) IndexedDB database, ensuring the
 * requested object store exists.
 */
function openDB(dbName: string, storeName: string): Promise<IDBDatabase> {
  const cacheKey = `${dbName}::${storeName}`;
  const cached = dbCache.get(cacheKey);
  if (cached) return cached;

  const promise = new Promise<IDBDatabase>((resolve, reject) => {
    // First, try opening at the current (or default) version.
    const probe = indexedDB.open(dbName);

    probe.onerror = () => reject(probe.error);

    probe.onsuccess = () => {
      const db = probe.result;
      if (db.objectStoreNames.contains(storeName)) {
        resolve(db);
        return;
      }
      // Store doesn't exist yet — close and reopen with a version bump.
      const nextVersion = db.version + 1;
      db.close();

      const upgrade = indexedDB.open(dbName, nextVersion);
      upgrade.onerror = () => reject(upgrade.error);
      upgrade.onupgradeneeded = () => {
        const upgradedDB = upgrade.result;
        if (!upgradedDB.objectStoreNames.contains(storeName)) {
          upgradedDB.createObjectStore(storeName);
        }
      };
      upgrade.onsuccess = () => resolve(upgrade.result);
    };

    probe.onupgradeneeded = () => {
      const db = probe.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName);
      }
    };
  });

  dbCache.set(cacheKey, promise);

  // If the open fails, remove from cache so the next call retries.
  promise.catch(() => {
    dbCache.delete(cacheKey);
  });

  return promise;
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
  /** Helper: run a single read/write transaction and return the request result. */
  function withStore<R>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<R>,
  ): Promise<R> {
    return openDB(dbName, storeName).then(
      (db) =>
        new Promise<R>((resolve, reject) => {
          const tx = db.transaction(storeName, mode);
          const store = tx.objectStore(storeName);
          const request = fn(store);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        }),
    );
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
