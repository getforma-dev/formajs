/**
 * Forma Storage - Local
 *
 * Typed localStorage wrapper with graceful error handling.
 * Zero dependencies — native browser APIs only.
 */

export interface TypedStorage<T> {
  get(): T | null;
  set(value: T): void;
  remove(): void;
  key: string;
}

export interface StorageOptions<T> {
  serialize?: (v: T) => string;
  deserialize?: (s: string) => T;
}

/**
 * Create a typed localStorage wrapper for the given key.
 *
 * ```ts
 * const store = createLocalStorage<{ name: string }>('user');
 * store.set({ name: 'Alice' });
 * store.get(); // { name: 'Alice' }
 * store.remove();
 * ```
 */
export function createLocalStorage<T>(
  key: string,
  options?: StorageOptions<T>,
): TypedStorage<T> {
  const serialize = options?.serialize ?? JSON.stringify;
  const deserialize = options?.deserialize ?? JSON.parse;

  return {
    key,

    get(): T | null {
      try {
        const raw = localStorage.getItem(key);
        if (raw === null) return null;
        return deserialize(raw) as T;
      } catch {
        return null;
      }
    },

    set(value: T): void {
      const serialized = serialize(value);
      localStorage.setItem(key, serialized);
    },

    remove(): void {
      localStorage.removeItem(key);
    },
  };
}
