/**
 * Forma Reactive - Root
 *
 * Explicit reactive ownership scope. All effects created inside a root
 * are automatically disposed when the root is torn down.
 *
 * Uses alien-signals' `effectScope` under the hood for native graph-level
 * effect tracking, with a userland disposer list for non-effect cleanup
 * (e.g., event listeners, DOM references, timers).
 */

import { effectScope as rawEffectScope } from 'alien-signals';

// ---------------------------------------------------------------------------
// Root scope tracking
// ---------------------------------------------------------------------------

let currentRoot: RootScope | null = null;
const rootStack: (RootScope | null)[] = [];

interface RootScope {
  /** Userland disposers (event listeners, DOM refs, timers, etc.) */
  disposers: (() => void)[];
  /** alien-signals effect scope dispose — tears down all reactive effects */
  scopeDispose: (() => void) | null;
}

/**
 * Create a reactive root scope.
 *
 * All effects created (via `createEffect`) inside the callback are tracked
 * at both the reactive graph level (via alien-signals effectScope) and the
 * userland level (via registerDisposer). The returned `dispose` function
 * tears down everything.
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
  const scope: RootScope = { disposers: [], scopeDispose: null };

  rootStack.push(currentRoot);
  currentRoot = scope;

  const dispose = () => {
    // Dispose alien-signals effect scope first (reactive graph cleanup)
    if (scope.scopeDispose) {
      try { scope.scopeDispose(); } catch { /* ensure userland disposers still run */ }
      scope.scopeDispose = null;
    }
    // Then run userland disposers
    for (const d of scope.disposers) {
      try { d(); } catch { /* ensure all disposers run */ }
    }
    scope.disposers.length = 0;
  };

  let result: T;
  try {
    // Wrap in alien-signals effectScope for native effect tracking
    scope.scopeDispose = rawEffectScope(() => {
      result = fn(dispose);
    });
  } finally {
    currentRoot = rootStack.pop() ?? null;
  }

  return result!;
}

/**
 * @internal — called by createEffect to register disposers in the current root.
 */
export function registerDisposer(dispose: () => void): void {
  if (currentRoot) {
    currentRoot.disposers.push(dispose);
  }
}

/**
 * @internal — check if we're inside a root scope.
 */
export function hasActiveRoot(): boolean {
  return currentRoot !== null;
}
