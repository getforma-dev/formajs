/**
 * Forma Storage - Local
 *
 * Typed localStorage wrapper with graceful error handling.
 * Zero dependencies — native browser APIs only.
 */

import { TypedStorage, StorageOptions } from './types.js';

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
  const validate = options?.validate;

  return {
    key,

    get(): T | null {
      try {
        const raw = localStorage.getItem(key);
        if (raw === null) return null;
        const value = deserialize(raw);
        if (validate && !validate(value)) return null;
        return value as T;
      } catch {
        return null;
      }
    },

    set(value: T): void {
      try {
        const serialized = serialize(value);
        localStorage.setItem(key, serialized);
      } catch { /* QuotaExceededError or storage disabled — silently ignore */ }
    },

    remove(): void {
      localStorage.removeItem(key);
    },
  };
}
