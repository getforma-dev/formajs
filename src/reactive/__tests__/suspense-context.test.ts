import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  pushSuspenseContext,
  popSuspenseContext,
  getSuspenseContext,
  type SuspenseContext,
} from '../suspense-context';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal SuspenseContext stub with optional label for identification. */
function makeSuspenseContext(label = 'ctx'): SuspenseContext {
  return {
    increment: vi.fn().mockName(`${label}.increment`),
    decrement: vi.fn().mockName(`${label}.decrement`),
  };
}

// ---------------------------------------------------------------------------
// Suspense Context Stack
// ---------------------------------------------------------------------------

describe('suspense-context', () => {
  // The module uses module-level state, so we must restore to a clean slate
  // after every test by popping until the stack is empty.
  beforeEach(() => {
    // Drain any leftover state from a previous test.
    // Pop until we are back to the initial null state.
    while (getSuspenseContext() !== null) {
      popSuspenseContext();
    }
  });

  // -----------------------------------------------------------------------
  // 1. push / pop basics
  // -----------------------------------------------------------------------

  it('pushSuspenseContext / popSuspenseContext stack operations work correctly', () => {
    const ctx = makeSuspenseContext();

    pushSuspenseContext(ctx);
    expect(getSuspenseContext()).toBe(ctx);

    popSuspenseContext();
    expect(getSuspenseContext()).toBeNull();
  });

  // -----------------------------------------------------------------------
  // 2. getSuspenseContext returns the top of stack (most recently pushed)
  // -----------------------------------------------------------------------

  it('getSuspenseContext returns the most recently pushed context', () => {
    const first = makeSuspenseContext('first');
    const second = makeSuspenseContext('second');

    pushSuspenseContext(first);
    pushSuspenseContext(second);

    // Should see the second (top of stack), not the first
    expect(getSuspenseContext()).toBe(second);

    popSuspenseContext();
    popSuspenseContext();
  });

  // -----------------------------------------------------------------------
  // 3. getSuspenseContext returns null when stack is empty
  // -----------------------------------------------------------------------

  it('getSuspenseContext returns null when no context has been pushed', () => {
    expect(getSuspenseContext()).toBeNull();
  });

  // -----------------------------------------------------------------------
  // 4. Nested push/pop restores previous boundary correctly
  // -----------------------------------------------------------------------

  it('nested push/pop restores previous boundary correctly', () => {
    const outer = makeSuspenseContext('outer');
    const inner = makeSuspenseContext('inner');

    pushSuspenseContext(outer);
    expect(getSuspenseContext()).toBe(outer);

    // Simulate entering a nested Suspense boundary
    pushSuspenseContext(inner);
    expect(getSuspenseContext()).toBe(inner);

    // Leave the nested boundary — should restore outer
    popSuspenseContext();
    expect(getSuspenseContext()).toBe(outer);

    // Leave the outer boundary — should restore to null
    popSuspenseContext();
    expect(getSuspenseContext()).toBeNull();
  });

  // -----------------------------------------------------------------------
  // 5. Pop with empty stack doesn't crash (defensive check)
  // -----------------------------------------------------------------------

  it('popSuspenseContext on empty stack does not throw', () => {
    // Ensure stack is empty
    expect(getSuspenseContext()).toBeNull();

    // Should not throw
    expect(() => popSuspenseContext()).not.toThrow();

    // State should remain null
    expect(getSuspenseContext()).toBeNull();
  });

  it('multiple pops past empty stack remain safe', () => {
    expect(() => {
      popSuspenseContext();
      popSuspenseContext();
      popSuspenseContext();
    }).not.toThrow();

    expect(getSuspenseContext()).toBeNull();
  });

  // -----------------------------------------------------------------------
  // 6. Multiple pushes stack correctly (LIFO order)
  // -----------------------------------------------------------------------

  it('multiple pushes stack in LIFO order', () => {
    const ctxA = makeSuspenseContext('A');
    const ctxB = makeSuspenseContext('B');
    const ctxC = makeSuspenseContext('C');

    pushSuspenseContext(ctxA);
    pushSuspenseContext(ctxB);
    pushSuspenseContext(ctxC);

    // Pop order should be C → B → A (LIFO)
    expect(getSuspenseContext()).toBe(ctxC);
    popSuspenseContext();

    expect(getSuspenseContext()).toBe(ctxB);
    popSuspenseContext();

    expect(getSuspenseContext()).toBe(ctxA);
    popSuspenseContext();

    expect(getSuspenseContext()).toBeNull();
  });

  // -----------------------------------------------------------------------
  // 7. Push, pop, push with different context — returns the new context
  // -----------------------------------------------------------------------

  it('push, pop, push with different context returns the new context', () => {
    const first = makeSuspenseContext('first');
    const second = makeSuspenseContext('second');

    pushSuspenseContext(first);
    expect(getSuspenseContext()).toBe(first);

    popSuspenseContext();
    expect(getSuspenseContext()).toBeNull();

    pushSuspenseContext(second);
    expect(getSuspenseContext()).toBe(second);

    // Clean up
    popSuspenseContext();
    expect(getSuspenseContext()).toBeNull();
  });

  it('push, pop, push cycle does not leak previous context', () => {
    const alpha = makeSuspenseContext('alpha');
    const beta = makeSuspenseContext('beta');

    // First cycle
    pushSuspenseContext(alpha);
    popSuspenseContext();

    // Second cycle
    pushSuspenseContext(beta);
    expect(getSuspenseContext()).toBe(beta);

    // Popping should go back to null, not alpha
    popSuspenseContext();
    expect(getSuspenseContext()).toBeNull();
  });
});
