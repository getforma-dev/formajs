/**
 * Forma Reactive - Effect
 *
 * Side-effectful reactive computation that auto-tracks signal dependencies.
 * Backed by alien-signals for automatic dependency tracking.
 *
 * TC39 Signals equivalent: Signal.subtle.Watcher (effect is a userland concept)
 */

import { effect as rawEffect } from 'alien-signals';
import {
  hasActiveRoot,
  registerDisposer,
  getOwner,
  runWithOwner,
  registerOwnerDisposer,
  createChildOwner,
  disposeOwner,
  type Owner,
} from './root.js';
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

// ---------------------------------------------------------------------------
// Self-write bridge — alien-signals' propagate() never notifies a subscriber
// that is currently running, so an effect writing a signal it depends on is
// left stale. signal.ts calls notifyReactiveWrite() when such a write really
// changes a value; safeFn's loop then re-runs the effect to observe it.
// ---------------------------------------------------------------------------

let selfWriteRequested = false;
let effectRunDepth = 0;

/** @internal — signalled by signal.ts when a running effect writes a changed dep. */
export function notifyReactiveWrite(): void {
  if (effectRunDepth > 0) selfWriteRequested = true;
}

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
  // Capture the owner active at creation time so this effect's disposer is owned
  // by whatever created it — a root, or (for a nested effect) the parent effect's
  // current child-owner. This replaces a hasActiveRoot() snapshot so nested
  // effects created during a parent re-run (when no root is lexically active) are
  // still owned and disposed.
  const ownerAtCreate = getOwner();

  // This effect owns its nested effects/roots via a reusable child-owner: it is
  // disposed (nested cleanups run) at the top of each run and on disposal, then
  // reused for the next generation. One small allocation per createEffect; the
  // hot DOM path uses internalEffect, which has no child-owner.
  const childOwner: Owner = createChildOwner();

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

    // Dispose the previous generation of nested effects/roots (running their
    // cleanups) before re-running. alien-signals' raw unwatched teardown of a
    // nested effect bypasses our cleanup, so we own nested work explicitly.
    disposeOwner(childOwner);

    nextCleanup = undefined;
    nextCleanupBag = undefined;

    // Always install the collector so onCleanup()/returned cleanups are captured
    // on EVERY run. (The old skipCleanupInfra fast-path latched after a clean
    // first run and then silently dropped — or cross-registered — cleanups
    // registered on later runs.) The single-cleanup/pooled-array promotion below
    // keeps the zero/one-cleanup case allocation-free.
    const prevCollector = setCleanupCollector(addCleanup);

    try {
      // Run the body with this effect's child-owner installed so any nested
      // effects/roots it creates are owned by this generation.
      const result = runWithOwner(childOwner, fn);
      if (typeof result === 'function') {
        addCleanup(result as () => void);
      }
      // Commit this run's cleanups. When none were registered, both stay
      // undefined (allocation-free).
      if (nextCleanupBag !== undefined) {
        cleanupBag = nextCleanupBag;
      } else if (nextCleanup !== undefined) {
        cleanup = nextCleanup;
      }
    } catch (e) {
      reportError(e, 'effect');
      if (nextCleanupBag !== undefined) {
        cleanupBag = nextCleanupBag;
      } else if (nextCleanup !== undefined) {
        cleanup = nextCleanup;
      }
    } finally {
      setCleanupCollector(prevCollector);
    }
  };

  const safeFn = () => {
    // Self-rerun loop: if the body wrote a dependency of its own (bridged via
    // notifyReactiveWrite from signal.ts), run again to observe it, bounded so a
    // genuine unbounded cycle is reported instead of hanging. Save/restore the
    // outer flag so a nested effect's self-write does not leak into its parent.
    // Until signal.ts wires notifyReactiveWrite, selfWriteRequested is never set,
    // so this runs exactly once.
    const outerSelfWrite = selfWriteRequested;
    let reentrantRuns = 0;
    do {
      selfWriteRequested = false;
      effectRunDepth++;
      try {
        runOnce();
      } finally {
        effectRunDepth--;
      }
      if (!selfWriteRequested) break;
      if (++reentrantRuns >= MAX_REENTRANT_RUNS) {
        selfWriteRequested = false;
        reportError(
          new Error(`createEffect exceeded ${MAX_REENTRANT_RUNS} self-triggered re-runs (cycle?)`),
          'effect',
        );
        break;
      }
    } while (true);
    selfWriteRequested = outerSelfWrite;
  };

  const dispose = rawEffect(safeFn);

  // Wrap dispose to also run final cleanups
  let disposed = false;
  const wrappedDispose = () => {
    if (disposed) return;
    disposed = true;
    dispose();
    // Dispose nested effects/roots this effect owns, then run its own cleanups.
    disposeOwner(childOwner);
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

  // Register this effect's disposer with the owner active at creation (a root, or
  // a parent effect's child-owner).
  if (ownerAtCreate) {
    registerOwnerDisposer(ownerAtCreate, wrappedDispose);
  }

  return wrappedDispose;
}
