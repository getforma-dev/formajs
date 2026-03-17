/**
 * Forma Component - Context
 *
 * Dependency injection via stack-based context.
 * Simpler than React's Provider component tree: provide() pushes a value,
 * inject() reads the top, component teardown pops automatically.
 * Zero dependencies -- native browser APIs only.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A typed dependency injection context created by {@link createContext}. */
export interface Context<T> {
  /** Unique identifier for this context. */
  readonly id: symbol;
  /** Value returned when no provider is active. */
  readonly defaultValue: T;
}

// ---------------------------------------------------------------------------
// Internal storage
// ---------------------------------------------------------------------------

/**
 * Per-context value stacks.
 * Each context id maps to a stack of provided values.
 * The top of the stack is the "current" value.
 */
const contextStacks = new Map<symbol, unknown[]>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a new context with a default value.
 *
 * ```ts
 * const ThemeCtx = createContext('light');
 * ```
 */
export function createContext<T>(defaultValue: T): Context<T> {
  return {
    id: Symbol('forma:context'),
    defaultValue,
  };
}

/**
 * Provide a value for a context.
 * The value is pushed onto the context's stack and will be returned by
 * inject() until it is removed via unprovide() or overridden by a nested provide().
 *
 * ```ts
 * provide(ThemeCtx, 'dark');
 * ```
 */
export function provide<T>(ctx: Context<T>, value: T): void {
  let stack = contextStacks.get(ctx.id);
  if (stack === undefined) {
    stack = [];
    contextStacks.set(ctx.id, stack);
  }
  stack.push(value);
}

/**
 * Read the current value of a context.
 * Returns the most recently provided value, or the default if none was provided.
 *
 * ```ts
 * const theme = inject(ThemeCtx); // 'dark' if provided, else 'light'
 * ```
 */
export function inject<T>(ctx: Context<T>): T {
  const stack = contextStacks.get(ctx.id);
  if (stack === undefined || stack.length === 0) {
    return ctx.defaultValue;
  }
  return stack[stack.length - 1] as T;
}

/**
 * Remove the most recent provided value for a context.
 * Used during component teardown to restore the previous scope.
 *
 * ```ts
 * unprovide(ThemeCtx);
 * ```
 */
export function unprovide<T>(ctx: Context<T>): void {
  const stack = contextStacks.get(ctx.id);
  if (stack !== undefined && stack.length > 0) {
    stack.pop();
    // Clean up empty stacks to avoid memory leaks
    if (stack.length === 0) {
      contextStacks.delete(ctx.id);
    }
  }
}
