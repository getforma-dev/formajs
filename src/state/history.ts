/**
 * Forma State - History
 *
 * Undo/redo for any signal. Tracks changes and maintains undo/redo stacks
 * with reactive canUndo/canRedo signals.
 * Zero dependencies -- native browser APIs only.
 */

import { createSignal, internalEffect, batch } from 'forma/reactive';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
 */
export function createHistory<T>(
  source: [get: () => T, set: (v: T) => void],
  options?: { maxLength?: number },
): HistoryControls<T> {
  const [sourceGet, sourceSet] = source;
  const maxLength = options?.maxLength ?? 100;

  // ---------- Internal mutable state (not signals) ----------
  // We use plain arrays/numbers to avoid creating signal dependencies
  // inside the source-tracking effect, which would cause re-entrance issues.
  let _stack: T[] = [sourceGet()];
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

  // Track whether the next source change should be ignored
  // (because it was caused by undo/redo, not an external set).
  let ignoreNext = false;
  let isFirstRun = true;

  // Watch the source signal for external changes
  internalEffect(() => {
    const value = sourceGet();

    // Skip the initial effect run -- the initial value is already in the stack
    if (isFirstRun) {
      isFirstRun = false;
      return;
    }

    if (ignoreNext) {
      ignoreNext = false;
      return;
    }

    // New value from an external set: push onto history
    // Discard any "future" entries after the current cursor (redo is cleared)
    _stack = _stack.slice(0, _cursor + 1);
    _stack.push(value);

    // Enforce maxLength
    if (_stack.length > maxLength) {
      _stack.splice(0, _stack.length - maxLength);
    }

    _cursor = _stack.length - 1;
    syncSignals();
  });

  // Reactive derived getters
  const canUndo = (): boolean => cursorSignal() > 0;
  const canRedo = (): boolean => cursorSignal() < stackLenSignal() - 1;

  const undo = (): void => {
    if (_cursor <= 0) return;

    _cursor--;
    ignoreNext = true;
    sourceSet(_stack[_cursor] as T);
    syncSignals();
  };

  const redo = (): void => {
    if (_cursor >= _stack.length - 1) return;

    _cursor++;
    ignoreNext = true;
    sourceSet(_stack[_cursor] as T);
    syncSignals();
  };

  const clear = (): void => {
    const currentValue = sourceGet();
    _stack = [currentValue];
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
  };
}
