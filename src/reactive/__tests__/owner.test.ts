// Owner context (getOwner/runWithOwner) — additive ownership so work created
// asynchronously (after the root body returns) can still be owned and disposed.
import { describe, it, expect } from 'vitest';
import { createSignal } from '../signal';
import { createEffect } from '../effect';
import { createRoot, getOwner, runWithOwner } from '../root';
import { onCleanup } from '../cleanup';

describe('owner context (1.1.0)', () => {
  it('getOwner returns the current owner inside a root and null outside', () => {
    expect(getOwner()).toBe(null);
    let inside: unknown = 'unset';
    createRoot(() => {
      inside = getOwner();
    });
    expect(inside).not.toBe(null);
    expect(getOwner()).toBe(null);
  });

  it('runWithOwner lets an async-created effect be owned and disposed', () => {
    let owner: ReturnType<typeof getOwner> = null;
    let disposeRoot = () => {};
    const cleaned: string[] = [];
    createRoot((dispose) => {
      disposeRoot = dispose;
      owner = getOwner();
    });
    expect(owner).not.toBe(null);
    // Simulate creation after the root body already returned:
    runWithOwner(owner, () => {
      createEffect(() => {
        onCleanup(() => cleaned.push('async-effect'));
      });
    });
    disposeRoot();
    expect(cleaned).toContain('async-effect');
  });

  it('runWithOwner restores the previous owner afterwards', () => {
    createRoot(() => {
      const outer = getOwner();
      runWithOwner(null, () => {
        expect(getOwner()).toBe(null);
      });
      expect(getOwner()).toBe(outer);
    });
  });
});
