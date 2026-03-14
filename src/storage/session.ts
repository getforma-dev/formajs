/**
 * Forma Storage - Session
 *
 * Typed sessionStorage wrapper with graceful error handling.
 * Zero dependencies — native browser APIs only.
 */

import { TypedStorage, StorageOptions } from './types.js';

/**
 * Create a typed sessionStorage wrapper for the given key.
 *
 * ```ts
 * const store = createSessionStorage<{ token: string }>('auth');
 * store.set({ token: 'abc123' });
 * store.get(); // { token: 'abc123' }
 * store.remove();
 * ```
 */
export function createSessionStorage<T>(
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
        const raw = sessionStorage.getItem(key);
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
        sessionStorage.setItem(key, serialized);
      } catch { /* QuotaExceededError or storage disabled — silently ignore */ }
    },

    remove(): void {
      sessionStorage.removeItem(key);
    },
  };
}
