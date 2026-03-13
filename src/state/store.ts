/**
 * Forma State - Store
 *
 * Deep reactive store with path-based signal granularity.
 * Every property path (e.g. `user.name`, `items.0.done`) gets its own signal,
 * so only effects that read a specific path are notified when it changes.
 *
 * Inspired by SolidJS's createStore and Vue's reactive(), with:
 * - Lazy proxy wrapping (child objects proxied on first access)
 * - Structural sharing (replacing an object invalidates child signals)
 * - Array mutation batching (push/pop/splice/sort etc. batch their signals)
 *
 * Backed by alien-signals via forma/reactive.
 */

import { createSignal, batch, untrack } from 'forma/reactive';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SignalPair = [get: () => unknown, set: (v: unknown) => void];

type StoreSetter<T extends object> = (
  partial: Partial<T> | ((prev: T) => Partial<T>),
) => void;

// ---------------------------------------------------------------------------
// Symbols
// ---------------------------------------------------------------------------

/** Access the underlying raw (unproxied) object from a store proxy. */
const RAW = Symbol('forma-raw');

/** Marker: true on every store proxy so we can detect them. */
const PROXY = Symbol('forma-proxy');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ARRAY_MUTATORS = new Set([
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse',
  'fill',
  'copyWithin',
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v == null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null || Array.isArray(v);
}

function shouldWrap(v: unknown): v is object {
  if (v == null || typeof v !== 'object') return false;
  // Don't wrap special built-ins (Date, RegExp, Map, Set, etc.)
  if (v instanceof Date || v instanceof RegExp || v instanceof Map ||
      v instanceof Set || v instanceof WeakMap || v instanceof WeakSet ||
      v instanceof Error || v instanceof Promise) {
    return false;
  }
  // Already a store proxy — no double wrapping
  if ((v as any)[PROXY]) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Deep-clone helper (used for functional setter snapshots)
// ---------------------------------------------------------------------------

function deepClone<T>(obj: T): T {
  if (obj == null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(deepClone) as unknown as T;
  if (obj instanceof Date) return new Date(obj.getTime()) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj as object)) {
    out[key] = deepClone((obj as Record<string, unknown>)[key]);
  }
  return out as T;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a deep reactive store.
 *
 * Returns a tuple of `[getter proxy, setter function]`.
 * The getter proxy tracks reads at every property path via dedicated signals.
 * Setting a property (either via `setState()` or direct mutation like
 * `state.user.name = 'Bob'`) only notifies effects that actually read that
 * specific path.
 *
 * ```ts
 * const [state, setState] = createStore({
 *   count: 0,
 *   user: { name: 'Alice', age: 30 },
 *   items: [{ text: 'Buy milk', done: false }],
 * });
 *
 * // Fine-grained reads
 * state.user.name;          // tracked at path "user.name"
 * state.items[0].done;      // tracked at path "items.0.done"
 *
 * // Setter API (batched)
 * setState({ count: 1 });
 * setState(prev => ({ count: prev.count + 1 }));
 *
 * // Direct mutation (via Proxy set trap)
 * state.user.name = 'Bob';  // only "user.name" subscribers notified
 * state.items[0].done = true;
 *
 * // Array mutations
 * state.items.push({ text: 'Walk dog', done: false });
 * ```
 */
export function createStore<T extends object>(
  initial: T,
): [get: T, set: StoreSetter<T>] {
  // -------------------------------------------------------------------------
  // Signal-per-path map
  // -------------------------------------------------------------------------

  /** Map of dot-separated paths -> signal pairs. */
  const signals = new Map<string, SignalPair>();

  /** Parent path -> set of direct child paths for O(1) child invalidation. */
  const children = new Map<string, Set<string>>();

  /**
   * Register a signal path with its parent in the adjacency map.
   * This allows walking the tree instead of scanning all signals.
   */
  function registerChild(path: string): void {
    const lastDot = path.lastIndexOf('.');
    if (lastDot === -1) return; // root-level, no parent
    const parentPath = path.substring(0, lastDot);
    let set = children.get(parentPath);
    if (!set) { set = new Set(); children.set(parentPath, set); }
    set.add(path);
  }

  /**
   * Get or create the signal for a given path.
   * When creating, seeds with `initialValue`.
   */
  function getSignal(path: string, initialValue?: unknown): SignalPair {
    let pair = signals.get(path);
    if (!pair) {
      pair = createSignal<unknown>(initialValue) as SignalPair;
      signals.set(path, pair);
      registerChild(path);
    }
    return pair;
  }

  // -------------------------------------------------------------------------
  // Proxy cache  (raw object -> proxy)
  // -------------------------------------------------------------------------

  /**
   * WeakMap so proxies for child objects are reused as long as the raw object
   * is alive. When an object is replaced, the old entry is GC'd naturally.
   */
  const proxyCache = new WeakMap<object, object>();

  // -------------------------------------------------------------------------
  // Invalidation
  // -------------------------------------------------------------------------

  /**
   * Recursively delete all child signals using the adjacency map.
   * Called when an entire sub-tree is replaced so stale signals are not reused.
   * O(k) where k = number of descendant signals, instead of O(n) over all signals.
   */
  function invalidateChildren(parentPath: string): void {
    const childSet = children.get(parentPath);
    if (!childSet) return;
    for (const childPath of childSet) {
      // Recursively invalidate grandchildren first
      invalidateChildren(childPath);
      // Remove the signal itself
      signals.delete(childPath);
      // Clean up this child's entry in the adjacency map
      children.delete(childPath);
    }
    // Clear the parent's children set (all children have been removed)
    childSet.clear();
  }

  // -------------------------------------------------------------------------
  // Proxy factory (lazy, recursive)
  // -------------------------------------------------------------------------

  function wrap(raw: object, basePath: string): object {
    // Primitives / non-wrappable values pass through
    if (!shouldWrap(raw)) return raw;

    // Return cached proxy if we already have one for this raw object
    const cached = proxyCache.get(raw);
    if (cached) return cached;

    const isArr = Array.isArray(raw);
    // Pre-compute the path prefix to avoid repeated string concatenation in hot paths
    const basePrefix = basePath ? basePath + '.' : '';

    // Inline cache: skip Map lookup when the same key is accessed repeatedly
    // (very common in render loops and effects that read the same property)
    let lastKey: string = '';
    let lastSignal: SignalPair | undefined;

    const proxy: object = new Proxy(raw, {
      // -------------------------------------------------------------------
      // GET
      // -------------------------------------------------------------------
      get(target: any, prop: PropertyKey, receiver: unknown): unknown {
        // Escape hatches
        if (prop === RAW) return target;
        if (prop === PROXY) return true;

        // Symbols pass through (Symbol.iterator, Symbol.toPrimitive, etc.)
        if (typeof prop === 'symbol') {
          return Reflect.get(target, prop, receiver);
        }

        const key = String(prop);
        // Cache-friendly path construction: avoid template literals in hot path
        const childPath = basePrefix + key;

        // ------------------------------------------------------------------
        // Array mutator methods — wrap to batch signal updates
        // ------------------------------------------------------------------
        if (isArr && ARRAY_MUTATORS.has(key)) {
          return (...args: unknown[]) => {
            let result: unknown;
            batch(() => {
              // Unwrap proxy arguments (e.g. pushing a store proxy)
              const rawArgs = args.map((a) =>
                a != null && typeof a === 'object' && (a as any)[RAW]
                  ? (a as any)[RAW]
                  : a,
              );
              result = (target as any)[key].apply(target, rawArgs);

              // Invalidate all child paths so they recreate from the
              // mutated raw array on next access.
              invalidateChildren(basePath);

              // Notify the length signal
              const [, setLen] = getSignal(
                basePrefix + 'length',
                (target as unknown[]).length,
              );
              setLen((target as unknown[]).length);
            });
            return result;
          };
        }

        // ------------------------------------------------------------------
        // Array `length` — special-case so it's always tracked
        // ------------------------------------------------------------------
        if (isArr && key === 'length') {
          const [getter] = getSignal(childPath, target.length);
          getter(); // subscribe
          return target.length;
        }

        // ------------------------------------------------------------------
        // Regular property access
        // ------------------------------------------------------------------
        const value = Reflect.get(target, prop);

        // Inline cache: if same key as last access, skip Map lookup
        let pair: SignalPair;
        if (key === lastKey && lastSignal) {
          pair = lastSignal;
        } else {
          pair = getSignal(childPath, value);
          lastKey = key;
          lastSignal = pair;
        }

        pair[0](); // subscribe to this path

        // Lazily wrap child objects/arrays
        if (shouldWrap(value)) {
          return wrap(value, childPath);
        }

        return value;
      },

      // -------------------------------------------------------------------
      // SET
      // -------------------------------------------------------------------
      set(target: any, prop: PropertyKey, value: unknown): boolean {
        if (typeof prop === 'symbol') {
          return Reflect.set(target, prop, value);
        }

        const key = String(prop);
        const childPath = basePrefix + key;

        // Unwrap if the value being set is itself a proxy
        const rawValue =
          value != null && typeof value === 'object' && (value as any)[RAW]
            ? (value as any)[RAW]
            : value;

        // Write to the underlying object
        Reflect.set(target, prop, rawValue);

        // If we're replacing with an object, invalidate all child signals
        // and evict the old proxy so sub-paths are recreated on next access.
        if (rawValue != null && typeof rawValue === 'object') {
          invalidateChildren(childPath);
          // Remove cached proxy for the old value so a fresh one is created
          // on the next access.
        }

        // Update the length signal when setting indexed array elements
        if (isArr && key !== 'length') {
          const lengthPath = basePrefix + 'length';
          const lenPair = signals.get(lengthPath);
          if (lenPair) {
            lenPair[1](target.length);
          }
        }

        // Notify (or create) the signal for this path
        const [, setter] = getSignal(childPath, rawValue);
        setter(rawValue);

        return true;
      },

      // -------------------------------------------------------------------
      // HAS — track membership checks
      // -------------------------------------------------------------------
      has(target: any, prop: PropertyKey): boolean {
        if (typeof prop === 'symbol') {
          return Reflect.has(target, prop);
        }
        const key = String(prop);
        const childPath = basePrefix + key;
        // Subscribe so that `'x' in state` is tracked
        const [getter] = getSignal(childPath, Reflect.get(target, prop));
        getter();
        return Reflect.has(target, prop);
      },

      // -------------------------------------------------------------------
      // OWNKEYS — return keys from the raw target
      // -------------------------------------------------------------------
      ownKeys(target: any): (string | symbol)[] {
        return Reflect.ownKeys(target);
      },

      // -------------------------------------------------------------------
      // GETOWNPROPERTYDESCRIPTOR — needed for Object.keys / spread / ...
      // -------------------------------------------------------------------
      getOwnPropertyDescriptor(target: any, prop: PropertyKey) {
        return Object.getOwnPropertyDescriptor(target, prop);
      },

      // -------------------------------------------------------------------
      // DELETEPROPERTY — clean up signals when a key is removed
      // -------------------------------------------------------------------
      deleteProperty(target: any, prop: PropertyKey): boolean {
        if (typeof prop === 'symbol') {
          return Reflect.deleteProperty(target, prop);
        }

        const key = String(prop);
        const childPath = basePrefix + key;

        const result = Reflect.deleteProperty(target, prop);

        // Clean up the signal for this path and all children via adjacency map
        invalidateChildren(childPath);
        signals.delete(childPath);

        // Remove from parent's children set in the adjacency map
        const parentPath = basePath;
        if (parentPath !== undefined) {
          const parentSet = children.get(parentPath);
          if (parentSet) {
            parentSet.delete(childPath);
            if (parentSet.size === 0) children.delete(parentPath);
          }
        }
        // Clean up the deleted path's own children entry
        children.delete(childPath);

        return result;
      },
    });

    proxyCache.set(raw, proxy);
    return proxy;
  }

  // -------------------------------------------------------------------------
  // Root proxy
  // -------------------------------------------------------------------------

  const rootProxy = wrap(initial, '') as T;

  // -------------------------------------------------------------------------
  // Snapshot (for functional setter)
  // -------------------------------------------------------------------------

  /**
   * Produce a plain-object snapshot of the store's current state.
   * Reads are untracked so calling `setState(prev => ...)` inside an effect
   * does not create additional subscriptions.
   */
  function getCurrentSnapshot(): T {
    return untrack(() => deepClone(initial));
  }

  // -------------------------------------------------------------------------
  // Setter
  // -------------------------------------------------------------------------

  const setter: StoreSetter<T> = (
    partial: Partial<T> | ((prev: T) => Partial<T>),
  ) => {
    // Resolve functional updates by snapshotting current state
    const updates: Partial<T> =
      typeof partial === 'function' ? partial(getCurrentSnapshot()) : partial;

    // Batch all top-level key writes so effects run only once
    batch(() => {
      for (const key of Object.keys(updates) as (keyof T & string)[]) {
        (rootProxy as any)[key] = (updates as any)[key];
      }
    });
  };

  return [rootProxy, setter];
}
