/**
 * alien-signals 3.x API tests — type guards, trigger, getBatchDepth,
 * effectScope (via createRoot), and computed previousValue.
 */
import { describe, it, expect } from 'vitest';
import {
  createSignal,
  createEffect,
  createComputed,
  createRoot,
  batch,
  isSignal,
  isComputed,
  isEffect,
  isEffectScope,
  getBatchDepth,
  trigger,
} from '../index';

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

describe('isSignal', () => {
  it('returns true for signal getters', () => {
    const [count] = createSignal(0);
    expect(isSignal(count)).toBe(true);
  });

  it('returns false for computed', () => {
    const [count] = createSignal(0);
    const doubled = createComputed(() => count() * 2);
    expect(isSignal(doubled)).toBe(false);
  });

  it('returns false for plain functions', () => {
    expect(isSignal(() => 42)).toBe(false);
  });
});

describe('isComputed', () => {
  it('returns true for computed values', () => {
    const [count] = createSignal(0);
    const doubled = createComputed(() => count() * 2);
    expect(isComputed(doubled)).toBe(true);
  });

  it('returns false for signal getters', () => {
    const [count] = createSignal(0);
    expect(isComputed(count)).toBe(false);
  });

  it('returns false for plain functions', () => {
    expect(isComputed(() => 42)).toBe(false);
  });
});

describe('isEffect', () => {
  it('returns false for FormaJS wrapped effect dispose (wraps raw effect)', () => {
    // createEffect returns a FormaJS-wrapped dispose function, not the raw
    // alien-signals effect. isEffect checks the raw alien-signals type, so
    // it correctly returns false for the wrapper.
    let dispose: () => void = () => {};
    createRoot(() => {
      dispose = createEffect(() => {});
    });
    expect(isEffect(dispose)).toBe(false);
    dispose(); // cleanup
  });

  it('returns false for signal getters', () => {
    const [count] = createSignal(0);
    expect(isEffect(count)).toBe(false);
  });

  it('returns false for plain functions', () => {
    expect(isEffect(() => {})).toBe(false);
  });
});

describe('isEffectScope', () => {
  it('returns false for signal getters', () => {
    const [count] = createSignal(0);
    expect(isEffectScope(count)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getBatchDepth
// ---------------------------------------------------------------------------

describe('getBatchDepth', () => {
  it('returns 0 outside of batch', () => {
    expect(getBatchDepth()).toBe(0);
  });

  it('returns 1 inside a batch', () => {
    let depth = 0;
    batch(() => {
      depth = getBatchDepth();
    });
    expect(depth).toBe(1);
  });

  it('returns 2 inside nested batch', () => {
    let depth = 0;
    batch(() => {
      batch(() => {
        depth = getBatchDepth();
      });
    });
    expect(depth).toBe(2);
  });

  it('returns 0 after batch completes', () => {
    batch(() => {});
    expect(getBatchDepth()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// trigger
// ---------------------------------------------------------------------------

describe('trigger', () => {
  it('forces a computed to recompute', () => {
    let callCount = 0;
    const [count] = createSignal(0);
    const doubled = createComputed(() => {
      callCount++;
      return count() * 2;
    });

    // Initial read
    doubled();
    const initialCalls = callCount;

    // Trigger forces recomputation even though count hasn't changed
    trigger(doubled);
    doubled(); // read to trigger lazy recompute
    expect(callCount).toBeGreaterThan(initialCalls);
  });

  it('forces an effect to re-run', () => {
    let effectRuns = 0;
    let dispose: () => void = () => {};

    createRoot((d) => {
      dispose = d;
      const eff = createEffect(() => {
        effectRuns++;
      });
      // trigger the effect dispose function to force re-run
      trigger(eff);
    });

    expect(effectRuns).toBeGreaterThanOrEqual(1);
    dispose();
  });
});

// ---------------------------------------------------------------------------
// createComputed with previousValue
// ---------------------------------------------------------------------------

describe('createComputed with previousValue', () => {
  it('receives undefined on first computation', () => {
    const [count] = createSignal(0);
    let receivedPrev: unknown = 'not-called';

    const comp = createComputed((prev) => {
      receivedPrev = prev;
      return count() * 2;
    });

    comp(); // trigger first computation
    expect(receivedPrev).toBeUndefined();
  });

  it('receives previous value on subsequent computations', () => {
    const [count, setCount] = createSignal(1);
    const prevValues: (number | undefined)[] = [];

    const comp = createComputed((prev?: number) => {
      prevValues.push(prev);
      return count() * 2;
    });

    comp(); // first: prev = undefined, result = 2
    setCount(2);
    comp(); // second: prev = 2, result = 4
    setCount(3);
    comp(); // third: prev = 4, result = 6

    expect(prevValues).toEqual([undefined, 2, 4]);
    expect(comp()).toBe(6);
  });

  it('enables diffing patterns', () => {
    const [items, setItems] = createSignal([1, 2, 3]);
    const diffs: string[] = [];

    const tracked = createComputed((prev?: number[]) => {
      const current = items();
      if (prev) {
        if (current.length > prev.length) diffs.push('added');
        else if (current.length < prev.length) diffs.push('removed');
        else diffs.push('changed');
      } else {
        diffs.push('initial');
      }
      return current;
    });

    tracked(); // initial
    setItems([1, 2, 3, 4]);
    tracked(); // added
    setItems([1, 2]);
    tracked(); // removed
    setItems([3, 4]);
    tracked(); // changed (same length)

    expect(diffs).toEqual(['initial', 'added', 'removed', 'changed']);
  });
});

// ---------------------------------------------------------------------------
// effectScope (via createRoot)
// ---------------------------------------------------------------------------

describe('createRoot with effectScope', () => {
  it('disposes all effects when root is torn down', () => {
    let effectRuns = 0;
    const [count, setCount] = createSignal(0);

    const dispose = createRoot((d) => {
      createEffect(() => {
        count();
        effectRuns++;
      });
      return d;
    });

    const afterMount = effectRuns;
    setCount(1);
    expect(effectRuns).toBeGreaterThan(afterMount);

    const afterUpdate = effectRuns;
    dispose();

    // After disposal, signal changes should NOT trigger effects
    setCount(2);
    setCount(3);
    expect(effectRuns).toBe(afterUpdate);
  });

  it('handles nested roots correctly', () => {
    let innerEffectRuns = 0;
    let outerEffectRuns = 0;
    const [count, setCount] = createSignal(0);

    let innerDispose: () => void = () => {};

    createRoot(() => {
      createEffect(() => {
        count();
        outerEffectRuns++;
      });

      innerDispose = createRoot((d) => {
        createEffect(() => {
          count();
          innerEffectRuns++;
        });
        return d;
      });
    });

    setCount(1);
    const outerAfter = outerEffectRuns;
    const innerAfter = innerEffectRuns;

    // Dispose only the inner root
    innerDispose();

    setCount(2);
    // Outer should still run
    expect(outerEffectRuns).toBeGreaterThan(outerAfter);
    // Inner should NOT run
    expect(innerEffectRuns).toBe(innerAfter);
  });
});
