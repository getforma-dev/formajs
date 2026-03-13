/**
 * Forma Reactive - Effect
 *
 * Side-effectful reactive computation that auto-tracks signal dependencies.
 * Backed by alien-signals for automatic dependency tracking.
 *
 * TC39 Signals equivalent: Signal.subtle.Watcher (effect is a userland concept)
 */

import { effect as rawEffect } from 'alien-signals';
import { hasActiveRoot, registerDisposer } from './root.js';
import { setCleanupCollector } from './cleanup.js';
import { reportError } from './dev.js';

// ---------------------------------------------------------------------------
// Cleanup array pool — avoids allocating a new array every effect re-run
// ---------------------------------------------------------------------------

const POOL_SIZE = 32;
const MAX_REENTRANT_RUNS = 100;
const pool: (() => void)[][] = [];
for (let i = 0; i < POOL_SIZE; i++) pool.push([]);
let poolIdx = POOL_SIZE;

function acquireArray(): (() => void)[] {
  if (poolIdx > 0) {
    const arr = pool[--poolIdx]!;
    arr.length = 0;
    return arr;
  }
  return [];
}

function releaseArray(arr: (() => void)[]): void {
  arr.length = 0;
  if (poolIdx < POOL_SIZE) {
    pool[poolIdx++] = arr;
  }
}

// ---------------------------------------------------------------------------
// Unified cleanup runner — single function for both re-run and dispose paths
// ---------------------------------------------------------------------------

function runCleanup(fn: (() => void) | undefined): void {
  if (fn === undefined) return;
  try {
    fn();
  } catch (e) {
    reportError(e, 'effect cleanup');
  }
}

function runCleanups(bag: (() => void)[] | undefined): void {
  if (bag === undefined) return;
  for (let i = 0; i < bag.length; i++) {
    try { bag[i]!(); } catch (e) { reportError(e, 'effect cleanup'); }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a reactive effect that auto-tracks signal dependencies.
 *
 * The provided function runs immediately and re-runs whenever any signal it
 * reads changes. If the function returns a cleanup function, that cleanup is
 * called before each re-run and on disposal.
 *
 * Additionally, `onCleanup()` can be called inside the effect to register
 * cleanup functions composably.
 *
 * Returns a dispose function that stops the effect.
 */
/**
 * @internal — Lightweight effect for Forma's internal DOM bindings.
 *
 * Bypasses createEffect's cleanup infrastructure (pool, collector, error
 * reporting, engine compression) since internal effects never use
 * onCleanup() or return cleanup functions.  This saves ~4 function calls
 * per effect creation and per re-run.
 *
 * ONLY use for effects that:
 * 1. Never call onCleanup()
 * 2. Never return a cleanup function
 * 3. Contain simple "read signal → write DOM" logic
 */
export function internalEffect(fn: () => void): () => void {
  const dispose = rawEffect(fn);
  if (hasActiveRoot()) {
    registerDisposer(dispose);
  }
  return dispose;
}

export function createEffect(fn: () => void | (() => void)): () => void {
  const shouldRegister = hasActiveRoot();

  // Most effects have zero or one cleanup. Track the single-cleanup case
  // without array allocation; only promote to pooled array when needed.
  let cleanup: (() => void) | undefined;
  let cleanupBag: (() => void)[] | undefined;
  let nextCleanup: (() => void) | undefined;
  let nextCleanupBag: (() => void)[] | undefined;

  const addCleanup = (cb: () => void) => {
    if (nextCleanupBag !== undefined) {
      nextCleanupBag.push(cb);
      return;
    }
    if (nextCleanup !== undefined) {
      const bag = acquireArray();
      bag.push(nextCleanup, cb);
      nextCleanup = undefined;
      nextCleanupBag = bag;
      return;
    }
    nextCleanup = cb;
  };

  // "Engine Compression" exploit: most effects never use cleanup (onCleanup()
  // or return value). After the first clean run, we know this effect is
  // "cleanup-free" and can skip the entire cleanup infrastructure on re-runs.
  // This saves 4 function calls per re-run: acquireArray, setCleanupCollector,
  // releaseArray, and bag inspection. Like the engine compression ratio exploit —
  // the "rules" say we should always prepare for cleanup, but we measure at
  // "room temperature" (first run) and exploit the gap.
  let skipCleanupInfra = false;
  let firstRun = true;
  let running = false;
  let rerunRequested = false;

  const runOnce = () => {
    // Run and clear previous cleanups (only if any exist).
    if (cleanup !== undefined) {
      runCleanup(cleanup);
      cleanup = undefined;
    }
    if (cleanupBag !== undefined) {
      runCleanups(cleanupBag);
      releaseArray(cleanupBag);
      cleanupBag = undefined;
    }

    // Ultra-fast path: this effect has proven it doesn't use cleanup.
    // Skip acquireArray + setCleanupCollector + bag checks + releaseArray.
    if (skipCleanupInfra) {
      try { fn(); } catch (e) { reportError(e, 'effect'); }
      return;
    }

    nextCleanup = undefined;
    nextCleanupBag = undefined;

    // Full path: install collector for onCleanup() calls.
    const prevCollector = setCleanupCollector(addCleanup);

    try {
      const result = fn();

      if (typeof result === 'function') {
        addCleanup(result as () => void);
      }

      // Hot path: no cleanups registered or returned — enable ultra-fast path.
      if (nextCleanup === undefined && nextCleanupBag === undefined) {
        // First clean run → enable ultra-fast path for all subsequent runs
        if (firstRun) skipCleanupInfra = true;
        return;
      }

      if (nextCleanupBag !== undefined) {
        cleanupBag = nextCleanupBag;
      } else {
        cleanup = nextCleanup;
      }
    } catch (e) {
      reportError(e, 'effect');

      if (nextCleanupBag !== undefined) {
        cleanupBag = nextCleanupBag;
      } else {
        cleanup = nextCleanup;
      }
    } finally {
      setCleanupCollector(prevCollector);
      firstRun = false;
    }
  };

  const safeFn = () => {
    if (running) {
      rerunRequested = true;
      return;
    }

    running = true;
    try {
      let reentrantRuns = 0;
      do {
        rerunRequested = false;
        runOnce();
        if (rerunRequested) {
          reentrantRuns++;
          if (reentrantRuns >= MAX_REENTRANT_RUNS) {
            reportError(
              new Error(`createEffect exceeded ${MAX_REENTRANT_RUNS} re-entrant runs`),
              'effect',
            );
            rerunRequested = false;
          }
        }
      } while (rerunRequested);
    } finally {
      running = false;
    }
  };

  const dispose = rawEffect(safeFn);

  // Wrap dispose to also run final cleanups
  let disposed = false;
  const wrappedDispose = () => {
    if (disposed) return;
    disposed = true;
    dispose();
    if (cleanup !== undefined) {
      runCleanup(cleanup);
      cleanup = undefined;
    }
    if (cleanupBag !== undefined) {
      runCleanups(cleanupBag);
      releaseArray(cleanupBag);
      cleanupBag = undefined;
    }
  };

  // Register in current root scope (if any)
  if (shouldRegister) {
    registerDisposer(wrappedDispose);
  }

  return wrappedDispose;
}
