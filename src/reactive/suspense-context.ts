/**
 * Forma Reactive - Suspense Context
 *
 * Shared context stack for Suspense boundaries. Lives in the reactive layer
 * (not DOM) so that createResource can import it without circular dependencies.
 *
 * The pattern mirrors the lifecycle context stack in component/define.ts.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SuspenseContext {
  /** Increment when a resource starts loading inside this boundary. */
  increment(): void;
  /** Decrement when a resource resolves/rejects inside this boundary. */
  decrement(): void;
}

// ---------------------------------------------------------------------------
// Context stack
// ---------------------------------------------------------------------------

let currentSuspenseContext: SuspenseContext | null = null;
const suspenseStack: (SuspenseContext | null)[] = [];

export function pushSuspenseContext(ctx: SuspenseContext): void {
  suspenseStack.push(currentSuspenseContext);
  currentSuspenseContext = ctx;
}

export function popSuspenseContext(): void {
  currentSuspenseContext = suspenseStack.pop() ?? null;
}

/** Get the current Suspense context (if any). Called by createResource. */
export function getSuspenseContext(): SuspenseContext | null {
  return currentSuspenseContext;
}
