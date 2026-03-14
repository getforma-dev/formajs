/**
 * Forma State - Persist
 *
 * Auto-persist a signal to localStorage (or any Storage-compatible backend).
 * Reads stored value on creation; writes on every signal change.
 * Zero dependencies -- native browser APIs only.
 */

import { internalEffect } from 'forma/reactive';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PersistOptions<T> {
  /** Storage backend. Defaults to localStorage. */
  storage?: Storage;
  /** Custom serializer. Defaults to JSON.stringify. */
  serialize?: (v: T) => string;
  /** Custom deserializer. Defaults to JSON.parse. */
  deserialize?: (s: string) => T;
  /** Optional validator — return true if the deserialized value is valid. Rejects corrupt/tampered data. */
  validate?: (v: unknown) => v is T;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Persist a signal's value to storage.
 *
 * On creation, reads the stored value (if any) and hydrates the signal.
 * Then sets up an effect to write to storage whenever the signal changes.
 *
 * ```ts
 * const [theme, setTheme] = createSignal('light');
 * persist([theme, setTheme], 'app:theme');
 *
 * setTheme('dark'); // auto-saved to localStorage under key 'app:theme'
 * ```
 */
export function persist<T>(
  source: [get: () => T, set: (v: T) => void],
  key: string,
  options?: PersistOptions<T>,
): void {
  const [sourceGet, sourceSet] = source;
  const storage = options?.storage ?? globalThis.localStorage;
  const serialize = options?.serialize ?? JSON.stringify;
  const deserialize = options?.deserialize ?? JSON.parse;
  const validate = options?.validate;

  // Step 1: Hydrate from storage (if a value exists)
  try {
    const stored = storage.getItem(key);
    if (stored !== null) {
      const value = deserialize(stored);
      if (!validate || validate(value)) {
        sourceSet(value);
      }
    }
  } catch {
    // Stored data is invalid or storage is unavailable -- ignore and keep
    // the signal's current value.
  }

  // Step 2: Set up effect to persist on changes
  internalEffect(() => {
    const value = sourceGet();
    try {
      const serialized = serialize(value);
      storage.setItem(key, serialized);
    } catch {
      // Storage write failed (e.g., quota exceeded) -- silently ignore.
    }
  });
}
