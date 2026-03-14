/**
 * Forma Reactive - Root
 *
 * Explicit reactive ownership scope. All effects created inside a root
 * are automatically disposed when the root is torn down.
 *
 * Replaces the module-level disposalBag pattern in mount.ts.
 */

// ---------------------------------------------------------------------------
// Root scope tracking
// ---------------------------------------------------------------------------

let currentRoot: RootScope | null = null;
// "Safety Car": use a fixed-capacity stack to prevent unbounded growth
// from deeply nested createRoot calls. Stack is trimmed after pop.
const rootStack: (RootScope | null)[] = [];

interface RootScope {
  disposers: (() => void)[];
}

/**
 * Create a reactive root scope.
 *
 * All effects created (via `createEffect`) inside the callback are tracked.
 * The returned `dispose` function tears them all down.
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
  const scope: RootScope = { disposers: [] };

  rootStack.push(currentRoot);
  currentRoot = scope;

  const dispose = () => {
    for (const d of scope.disposers) {
      try { d(); } catch { /* ensure all disposers run */ }
    }
    scope.disposers.length = 0;
  };

  try {
    return fn(dispose);
  } finally {
    currentRoot = rootStack.pop() ?? null;
    // "Safety Car": trim stack array if a deep nesting spike left excess capacity.
    // Without this, a spike of 100 nested roots leaves a length-0 array with
    // 100 slots of allocated memory that never shrinks.
    if (rootStack.length === 0) {
      rootStack.length = 0;
    }
  }
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
