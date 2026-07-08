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

/** The phase in which a persist operation failed, passed to {@link PersistOptions.onError}. */
export type PersistErrorPhase = 'hydrate' | 'serialize' | 'write' | 'migrate';

/** Options for {@link persist} — storage backend, serialization, and validation. */
export interface PersistOptions<T> {
  /** Storage backend. Defaults to localStorage. */
  storage?: Storage;
  /** Custom serializer. Defaults to JSON.stringify. */
  serialize?: (v: T) => string;
  /** Custom deserializer. Defaults to JSON.parse. */
  deserialize?: (s: string) => T;
  /** Optional validator — return true if the deserialized value is valid. Rejects corrupt/tampered data. */
  validate?: (v: unknown) => v is T;
  /** Current schema version. When set, values are stored in a versioned envelope. */
  version?: number;
  /** Migrate stored data whose version is older than {@link version}. Runs before validate. */
  migrate?: (oldValue: unknown, oldVersion: number) => T;
  /** Re-hydrate when another tab writes this key. Defaults to true for localStorage. */
  syncTabs?: boolean;
  /** Report hydrate/serialize/write/migrate failures instead of swallowing them. */
  onError?: (err: unknown, phase: PersistErrorPhase) => void;
}

/** Marker key for the versioned storage envelope. */
const ENVELOPE_TAG = '$forma:v';

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
): () => void {
  const [sourceGet, sourceSet] = source;
  const storage = options?.storage ?? globalThis.localStorage;
  const serialize = options?.serialize ?? JSON.stringify;
  const deserialize = options?.deserialize ?? (JSON.parse as (s: string) => T);
  const validate = options?.validate;
  const version = options?.version;
  const migrate = options?.migrate;
  const onError = options?.onError;

  // Guard so external re-hydration (which calls sourceSet) does not echo a
  // write back to storage. Reset in finally so a throwing sourceSet can't wedge it.
  let writing = false;

  // Read a stored string, returning its value and version. A versioned envelope
  // is an object with an OWN ENVELOPE_TAG property (checked via hasOwnProperty,
  // never `in`, and never merged onto a prototype — no prototype-pollution vector).
  function unwrap(stored: string): { value: unknown; version: number } {
    const parsed = deserialize(stored) as unknown;
    if (
      parsed != null && typeof parsed === 'object' &&
      Object.prototype.hasOwnProperty.call(parsed, ENVELOPE_TAG)
    ) {
      const env = parsed as Record<string, unknown>;
      return { value: env.value, version: Number(env[ENVELOPE_TAG]) };
    }
    return { value: parsed, version: 0 }; // legacy bare value
  }

  function hydrate(): void {
    let stored: string | null;
    try {
      stored = storage.getItem(key);
    } catch (err) {
      onError?.(err, 'hydrate');
      return;
    }
    if (stored === null) return;
    try {
      const { value: raw, version: storedVersion } = unwrap(stored);
      let value = raw;
      if (version !== undefined && storedVersion < version) {
        if (!migrate) return; // stale and no migration path — keep current value
        try {
          value = migrate(raw, storedVersion);
        } catch (err) {
          onError?.(err, 'migrate');
          return;
        }
      }
      if (!validate || validate(value)) {
        writing = true;
        try { sourceSet(value as T); } finally { writing = false; }
      }
    } catch (err) {
      onError?.(err, 'hydrate');
    }
  }

  // Step 1: Hydrate from storage (before the writer effect so its first run
  // persists the hydrated value, preserving prior behavior).
  hydrate();

  // Step 2: Persist on change. Read the value first (to track it) then bail if
  // this run was triggered by our own hydration.
  const stopEffect = internalEffect(() => {
    const value = sourceGet();
    if (writing) return;
    try {
      const serialized = version !== undefined
        ? serialize({ [ENVELOPE_TAG]: version, value } as unknown as T)
        : serialize(value);
      storage.setItem(key, serialized);
    } catch (err) {
      onError?.(err, (err as { name?: string })?.name === 'QuotaExceededError' ? 'write' : 'serialize');
    }
  });

  // Step 3: Cross-tab sync (browser only). Default on for localStorage.
  const enableSync = options?.syncTabs
    ?? (typeof window !== 'undefined' && storage === globalThis.localStorage);
  let onStorage: ((e: StorageEvent) => void) | undefined;
  if (enableSync && typeof window !== 'undefined') {
    onStorage = (e: StorageEvent) => {
      if (e.storageArea !== storage) return;
      if (e.key !== null && e.key !== key) return; // null key = storage.clear()
      hydrate();
    };
    window.addEventListener('storage', onStorage);
  }

  return () => {
    stopEffect();
    if (onStorage && typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorage);
    }
  };
}
