/**
 * Forma Reactive - Effect
 *
 * Side-effectful reactive computation that auto-tracks signal dependencies.
 * Backed by alien-signals for automatic dependency tracking.
 *
 * TC39 Signals equivalent: Signal.subtle.Watcher (effect is a userland concept)
 */

import { effect as rawEffect, getActiveSub } from 'alien-signals';
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
// Self-write detection — alien-signals' propagate() never notifies a subscriber
// that is currently running, so an effect writing a signal it depends on is left
// stale. When that happens alien-signals still sets the Pending flag on the
// running subscriber's node (but skips the re-run). We read that flag on the
// EFFECT's own node after each run and loop, so a self-dependent effect
// converges. Reading the effect's own node (not a global) makes this precise:
// writes to signals the effect does not depend on, writes from a nested computed,
// and a nested effect's self-write never set THIS node's Pending, so they cause
// no spurious re-run. It also works through batch() (Pending is set at flush).
// ---------------------------------------------------------------------------

// alien-signals ReactiveFlags.Pending (not exported from the package root).
const PENDING = 32;

interface SubNode { flags: number; }

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
    // Dispose the previous generation of nested effects/roots (running their
    // cleanups) FIRST — children before parents, matching wrappedDispose so the
    // teardown order is consistent between the re-run and dispose paths and a
    // nested cleanup never observes parent-owned state already freed. (alien's
    // raw unwatched teardown of a nested effect bypasses our cleanup, so we own
    // nested work explicitly.)
    disposeOwner(childOwner);

    // Run and clear this effect's own previous cleanups.
    if (cleanup !== undefined) {
      runCleanup(cleanup);
      cleanup = undefined;
    }
    if (cleanupBag !== undefined) {
      runCleanups(cleanupBag);
      releaseArray(cleanupBag);
      cleanupBag = undefined;
    }

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
    // alien-signals sets activeSub to this effect's node for the duration of this
    // callback, so getActiveSub() is our own node. If the body writes a signal we
    // depend on, alien-signals marks this node Pending but skips the re-run; we
    // detect that and run again, bounded so a genuine cycle is reported instead of
    // hanging.
    const node = getActiveSub() as SubNode | undefined;
    let reentrantRuns = 0;
    do {
      if (node) node.flags &= ~PENDING; // clear before running so we detect a fresh set
      runOnce();
      if (node === undefined || (node.flags & PENDING) === 0) break;
      if (++reentrantRuns >= MAX_REENTRANT_RUNS) {
        node.flags &= ~PENDING;
        reportError(
          new Error(`createEffect exceeded ${MAX_REENTRANT_RUNS} self-triggered re-runs (cycle?)`),
          'effect',
        );
        break;
      }
    } while (true);
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
