/**
 * Forma State - History
 *
 * Undo/redo for any signal. Tracks changes and maintains undo/redo stacks
 * with reactive canUndo/canRedo signals.
 * Zero dependencies -- native browser APIs only.
 */

import { createSignal, internalEffect, batch } from 'forma/reactive';

// ---------------------------------------------------------------------------
// Snapshot helper — clone plain values so a later in-place mutation of a value
// stored in (or restored from) the history stack cannot corrupt other entries.
// Non-plain objects (Date/RegExp/Map/Set/class instances) pass by reference.
// ---------------------------------------------------------------------------

function cloneEntry<V>(v: V, seen?: WeakSet<object>): V {
  if (v === null || typeof v !== 'object') return v;
  const proto = Object.getPrototypeOf(v);
  if (!Array.isArray(v) && proto !== Object.prototype && proto !== null) return v;
  if (!seen) seen = new WeakSet();
  if (seen.has(v as unknown as object)) return v; // circular — return as-is
  seen.add(v as unknown as object);
  if (Array.isArray(v)) return (v.map((i) => cloneEntry(i, seen)) as unknown) as V;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v as Record<string, unknown>)) {
    out[k] = cloneEntry((v as Record<string, unknown>)[k], seen);
  }
  return out as unknown as V;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Undo/redo controls returned by {@link createHistory}. */
export interface HistoryControls<T> {
  /** Undo the last change, restoring the previous value. */
  undo: () => void;
  /** Redo the last undone change. */
  redo: () => void;
  /** Reactive getter: true if undo is available. */
  canUndo: () => boolean;
  /** Reactive getter: true if redo is available. */
  canRedo: () => boolean;
  /** Reactive getter: the full history stack (past + current + future). */
  history: () => T[];
  /** Reactive getter: current position in the history stack (0-based). */
  cursor: () => number;
  /** Clear all history, keeping only the current value. */
  clear: () => void;
  /** Stop tracking the source signal and release the history stack. */
  destroy: () => void;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create undo/redo history tracking for a signal.
 *
 * ```ts
 * const [count, setCount] = createSignal(0);
 * const h = createHistory([count, setCount], { maxLength: 50 });
 *
 * setCount(1);
 * setCount(2);
 * h.undo();            // count() === 1
 * h.redo();            // count() === 2
 * h.canUndo();         // true (reactive)
 * ```
 *
 * **Limitation:** the source must be a signal whose getter returns a stable
 * value (a primitive or a stable object reference). A `createStore` slice whose
 * getter returns a *fresh proxy on every read* is not supported: the undo/redo
 * echo guard compares by identity, so a new proxy each read makes every
 * undo/redo look like an external change and clears the redo history. Track
 * store state with `setState`/direct mutation, not `createHistory`.
 */
export function createHistory<T>(
  source: [get: () => T, set: (v: T) => void],
  options?: { maxLength?: number },
): HistoryControls<T> {
  const [sourceGet, sourceSet] = source;
  // Clamp to >= 1 so the current entry is always retained (maxLength 0 would
  // empty the stack and leave the cursor at -1).
  const maxLength = Math.max(1, options?.maxLength ?? 100);

  // ---------- Internal mutable state (not signals) ----------
  // We use plain arrays/numbers to avoid creating signal dependencies
  // inside the source-tracking effect, which would cause re-entrance issues.
  let _stack: T[] = [cloneEntry(sourceGet())];
  let _cursor = 0;

  // ---------- Reactive output signals ----------
  // These are signals that external consumers can subscribe to.
  // We update them explicitly after every mutation.
  const [stackSignal, setStackSignal] = createSignal<T[]>([..._stack]);
  const [cursorSignal, setCursorSignal] = createSignal(_cursor);
  // Separate signal for stack length so canRedo only depends on numeric
  // signals and doesn't re-fire when array reference changes but length stays.
  const [stackLenSignal, setStackLenSignal] = createSignal(_stack.length);

  /** Sync the reactive output signals with internal mutable state. */
  function syncSignals(): void {
    batch(() => {
      setStackSignal([..._stack]);
      setCursorSignal(_cursor);
      setStackLenSignal(_stack.length);
    });
  }

  // Distinguish our own undo/redo echo from a genuine external set. A bare
  // boolean assumed 1 set -> 1 effect run, which breaks under batch() (multiple
  // sets collapse to one flush) and under a custom `equals` that suppresses the
  // echo. Instead capture the exact value we restored and match it by identity.
  const NONE = Symbol('none');
  let _expected: T | typeof NONE = NONE;
  let isFirstRun = true;

  // Watch the source signal for external changes
  const disposeEffect = internalEffect(() => {
    const value = sourceGet();

    // Skip the initial effect run -- the initial value is already in the stack
    if (isFirstRun) {
      isFirstRun = false;
      return;
    }

    // Our own undo/redo echo — consume the guard and record nothing.
    if (_expected !== NONE && Object.is(value, _expected)) {
      _expected = NONE;
      return;
    }
    // Any other value is a real external change; clear a stale guard (so a
    // custom-equals-suppressed echo cannot eat this set) and record it.
    _expected = NONE;

    // Discard any "future" entries after the current cursor (redo is cleared)
    _stack = _stack.slice(0, _cursor + 1);
    _stack.push(cloneEntry(value));

    // Enforce maxLength
    if (_stack.length > maxLength) {
      _stack.splice(0, _stack.length - maxLength);
    }

    _cursor = _stack.length - 1;
    syncSignals();
  });

  const destroy = (): void => { disposeEffect(); };

  // Reactive derived getters
  const canUndo = (): boolean => cursorSignal() > 0;
  const canRedo = (): boolean => cursorSignal() < stackLenSignal() - 1;

  const undo = (): void => {
    if (_cursor <= 0) return;

    _cursor--;
    // Restore a clone and expect exactly that reference back, so a consumer
    // mutating the restored value cannot corrupt the stack entry.
    const restored = cloneEntry(_stack[_cursor] as T);
    _expected = restored;
    sourceSet(restored);
    syncSignals();
  };

  const redo = (): void => {
    if (_cursor >= _stack.length - 1) return;

    _cursor++;
    const restored = cloneEntry(_stack[_cursor] as T);
    _expected = restored;
    sourceSet(restored);
    syncSignals();
  };

  const clear = (): void => {
    const currentValue = sourceGet();
    _stack = [cloneEntry(currentValue)];
    _cursor = 0;
    syncSignals();
  };

  return {
    undo,
    redo,
    canUndo,
    canRedo,
    history: () => stackSignal(),
    cursor: () => cursorSignal(),
    clear,
    destroy,
  };
}
