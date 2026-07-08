/**
 * Forma Reactive - Root
 *
 * Explicit reactive ownership scope. All effects created inside a root
 * are automatically disposed when the root is torn down.
 *
 * Uses alien-signals' `effectScope` under the hood for native graph-level
 * effect tracking, with a userland disposer list for non-effect cleanup
 * (e.g., event listeners, DOM references, timers).
 *
 * Roots created inside another root are automatically owned by the parent
 * (Solid-style). When the parent is disposed, all child roots are disposed
 * too. Use {@link createUnownedRoot} for roots that must outlive their
 * lexical parent (e.g., mount points, test harnesses).
 */

import { effectScope as rawEffectScope, setActiveSub } from 'alien-signals';

// ---------------------------------------------------------------------------
// Root scope tracking
// ---------------------------------------------------------------------------

let currentRoot: RootScope | null = null;
const rootStack: (RootScope | null)[] = [];

/**
 * The minimal ownership unit: something that holds disposers. A {@link RootScope}
 * is an Owner with an extra alien-signals scope dispose. Effects use lightweight
 * child owners (no scopeDispose) to own their nested effects generation-by-generation.
 */
export interface Owner {
  /** Disposers to run when this owner is torn down. */
  disposers: (() => void)[];
}

interface RootScope extends Owner {
  /** alien-signals effect scope dispose — tears down all reactive effects */
  scopeDispose: (() => void) | null;
}

/**
 * The owner that new disposers register with. Inside a root this equals the
 * current {@link RootScope}; {@link runWithOwner} can temporarily point it at any
 * owner so work created outside the original synchronous scope is still owned.
 */
let currentOwner: Owner | null = null;

/** @internal — the owner disposers currently register with (or null). */
export function getOwner(): Owner | null {
  return currentOwner;
}

/**
 * Run `fn` with `owner` installed as the current owner, restoring the previous
 * owner afterwards. Lets effects/roots created asynchronously (after the
 * original root callback returned) still be owned and disposed.
 */
export function runWithOwner<T>(owner: Owner | null, fn: () => T): T {
  const prev = currentOwner;
  currentOwner = owner;
  try {
    return fn();
  } finally {
    currentOwner = prev;
  }
}

/** @internal — register a disposer directly with a specific owner. */
export function registerOwnerDisposer(owner: Owner, dispose: () => void): void {
  owner.disposers.push(dispose);
}

/** @internal — a fresh lightweight owner (no alien scope). Used per effect run. */
export function createChildOwner(): Owner {
  return { disposers: [] };
}

/** @internal — run and clear an owner's disposers (guarded so one throw doesn't abort the rest). */
export function disposeOwner(owner: Owner): void {
  const ds = owner.disposers;
  for (const d of ds) {
    try { d(); } catch { /* ensure all disposers run */ }
  }
  ds.length = 0;
}

// ---------------------------------------------------------------------------
// Shared implementation
// ---------------------------------------------------------------------------

function createRootImpl<T>(fn: (dispose: () => void) => T, owned: boolean): T {
  const scope: RootScope = { disposers: [], scopeDispose: null };
  const parentRoot = owned ? currentRoot : null;

  rootStack.push(currentRoot);
  currentRoot = scope;
  const prevOwner = currentOwner;
  currentOwner = scope;

  let disposed = false;
  const dispose = () => {
    if (disposed) return; // idempotent — safe to call after parent already disposed this
    disposed = true;
    // Dispose alien-signals effect scope first (reactive graph cleanup)
    if (scope.scopeDispose) {
      try { scope.scopeDispose(); } catch { /* ensure userland disposers still run */ }
      scope.scopeDispose = null;
    }
    // Then run userland disposers (includes child root disposes)
    for (const d of scope.disposers) {
      try { d(); } catch { /* ensure all disposers run */ }
    }
    scope.disposers.length = 0;
  };

  // Auto-register with parent root so child dies when parent dies (Solid-style)
  if (parentRoot) {
    parentRoot.disposers.push(dispose);
  }

  let result: T;
  try {
    if (owned) {
      // Owned: alien-signals nesting is kept (belt + suspenders with Forma cascade)
      scope.scopeDispose = rawEffectScope(() => {
        result = fn(dispose);
      });
    } else {
      // Unowned: break alien-signals scope nesting so this scope is NOT
      // disposed when the lexical parent scope is disposed.
      const prevSub = setActiveSub(undefined);
      try {
        scope.scopeDispose = rawEffectScope(() => {
          result = fn(dispose);
        });
      } finally {
        setActiveSub(prevSub);
      }
    }
  } finally {
    currentRoot = rootStack.pop() ?? null;
    currentOwner = prevOwner;
  }

  return result!;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a reactive root scope.
 *
 * All effects created (via `createEffect`) inside the callback are tracked
 * at both the reactive graph level (via alien-signals effectScope) and the
 * userland level (via registerDisposer). The returned `dispose` function
 * tears down everything.
 *
 * Roots created inside another root are automatically owned by the parent.
 * When the parent is disposed, this root is disposed too.
 *
 * ```ts
 * const dispose = createRoot(() => {
 *   createEffect(() => console.log(count()));
 *   createEffect(() => console.log(name()));
 * });
 * // later: dispose() stops both effects
 * ```
 */
export function createRoot<T>(fn: (dispose: () => void) => T): T {
  return createRootImpl(fn, true);
}

/**
 * Create a reactive root that is NOT owned by any parent root.
 *
 * Use this for roots that must outlive their lexical parent:
 * top-level mount points, island hydration, test harnesses, etc.
 *
 * ```ts
 * createRoot(() => {
 *   // This root outlives the parent even though it's nested:
 *   createUnownedRoot((dispose) => {
 *     // effects here survive parent disposal
 *   });
 * });
 * ```
 */
export function createUnownedRoot<T>(fn: (dispose: () => void) => T): T {
  return createRootImpl(fn, false);
}

/**
 * @internal — called by createEffect and DOM primitives to register disposers
 * with the current owner (a root scope, or an owner installed via runWithOwner).
 */
export function registerDisposer(dispose: () => void): void {
  if (currentOwner) {
    currentOwner.disposers.push(dispose);
  }
}

/**
 * @internal — check if we're inside an owner scope (root or runWithOwner).
 */
export function hasActiveRoot(): boolean {
  return currentOwner !== null;
}
