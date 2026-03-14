import { describe, it, expect, vi } from 'vitest';
import { createSignal } from '../signal';
import { createEffect } from '../effect';
import { createRoot } from '../root';
import { onCleanup } from '../cleanup';
import { createRef, type Ref } from '../ref';
import { createReducer } from '../reducer';
import { on } from '../on';

// ---------------------------------------------------------------------------
// onCleanup
// ---------------------------------------------------------------------------

describe('onCleanup', () => {
  it('runs when effect re-runs', () => {
    const order: string[] = [];
    createRoot(() => {
      const [count, setCount] = createSignal(0);

      createEffect(() => {
        const c = count();
        order.push(`effect:${c}`);
        onCleanup(() => order.push(`cleanup:${c}`));
      });

      expect(order).toEqual(['effect:0']);

      setCount(1);
      expect(order).toEqual(['effect:0', 'cleanup:0', 'effect:1']);

      setCount(2);
      expect(order).toEqual(['effect:0', 'cleanup:0', 'effect:1', 'cleanup:1', 'effect:2']);
    });
  });

  it('runs on disposal', () => {
    const cleanupSpy = vi.fn();
    const [count] = createSignal(0);

    const dispose = createEffect(() => {
      count();
      onCleanup(cleanupSpy);
    });

    expect(cleanupSpy).not.toHaveBeenCalled();
    dispose();
    expect(cleanupSpy).toHaveBeenCalledTimes(1);
  });

  it('runs on root disposal', () => {
    const cleanupSpy = vi.fn();

    createRoot((dispose) => {
      const [count] = createSignal(0);

      createEffect(() => {
        count();
        onCleanup(cleanupSpy);
      });

      expect(cleanupSpy).not.toHaveBeenCalled();
      dispose();
      expect(cleanupSpy).toHaveBeenCalledTimes(1);
    });
  });

  it('works alongside returned cleanup function', () => {
    const order: string[] = [];
    createRoot(() => {
      const [count, setCount] = createSignal(0);

      createEffect(() => {
        const c = count();
        onCleanup(() => order.push(`onCleanup:${c}`));
        return () => order.push(`return:${c}`);
      });

      setCount(1);
      // Both cleanup mechanisms should have fired
      expect(order).toContain('onCleanup:0');
      expect(order).toContain('return:0');
    });
  });
});

// ---------------------------------------------------------------------------
// createRef
// ---------------------------------------------------------------------------

describe('createRef', () => {
  it('creates a mutable reference', () => {
    const ref = createRef(0);
    expect(ref.current).toBe(0);
  });

  it('mutating .current does not trigger reactivity', () => {
    const spy = vi.fn();
    const ref = createRef(0);

    createRoot(() => {
      const [trigger, setTrigger] = createSignal(0);

      createEffect(() => {
        trigger(); // only track this
        spy(ref.current);
      });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(0);

      ref.current = 42;
      // No effect re-run since ref is not reactive
      expect(spy).toHaveBeenCalledTimes(1);

      // Trigger the effect manually
      setTrigger(1);
      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy).toHaveBeenCalledWith(42); // reads updated ref
    });
  });

  it('works with various types', () => {
    const numRef = createRef(42);
    const strRef = createRef('hello');
    const nullRef = createRef<HTMLElement | null>(null);
    const objRef = createRef({ x: 1, y: 2 });

    expect(numRef.current).toBe(42);
    expect(strRef.current).toBe('hello');
    expect(nullRef.current).toBe(null);
    expect(objRef.current).toEqual({ x: 1, y: 2 });

    nullRef.current = document.createElement('div');
    expect(nullRef.current).toBeInstanceOf(HTMLDivElement);
  });

  it('returns object with current property', () => {
    const ref = createRef('test');
    expect(Object.keys(ref)).toEqual(['current']);
  });
});

// ---------------------------------------------------------------------------
// createReducer
// ---------------------------------------------------------------------------

describe('createReducer', () => {
  type CountAction = { type: 'increment' } | { type: 'decrement' } | { type: 'reset' };

  const countReducer = (state: number, action: CountAction): number => {
    switch (action.type) {
      case 'increment': return state + 1;
      case 'decrement': return state - 1;
      case 'reset': return 0;
    }
  };

  it('initializes with initial state', () => {
    const [count] = createReducer(countReducer, 0);
    expect(count()).toBe(0);
  });

  it('dispatches actions to update state', () => {
    const [count, dispatch] = createReducer(countReducer, 0);

    dispatch({ type: 'increment' });
    expect(count()).toBe(1);

    dispatch({ type: 'increment' });
    expect(count()).toBe(2);

    dispatch({ type: 'decrement' });
    expect(count()).toBe(1);

    dispatch({ type: 'reset' });
    expect(count()).toBe(0);
  });

  it('state changes trigger effects', () => {
    const log: number[] = [];
    createRoot(() => {
      const [count, dispatch] = createReducer(countReducer, 0);

      createEffect(() => { log.push(count()); });

      expect(log).toEqual([0]);

      dispatch({ type: 'increment' });
      expect(log).toEqual([0, 1]);

      dispatch({ type: 'increment' });
      expect(log).toEqual([0, 1, 2]);
    });
  });

  it('returns [state, dispatch] tuple', () => {
    const result = createReducer(countReducer, 0);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(typeof result[0]).toBe('function');
    expect(typeof result[1]).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// on()
// ---------------------------------------------------------------------------

describe('on', () => {
  it('tracks only specified dependencies', () => {
    const spy = vi.fn();
    createRoot(() => {
      const [a, setA] = createSignal(0);
      const [b, setB] = createSignal(0);

      createEffect(on(a, (value) => {
        b(); // reads b but should NOT track it
        spy(value);
      }));

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(0);

      setB(1); // should NOT trigger
      expect(spy).toHaveBeenCalledTimes(1);

      setA(10); // should trigger
      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy).toHaveBeenCalledWith(10);
    });
  });

  it('provides previous value', () => {
    const log: Array<[number, number | undefined]> = [];
    createRoot(() => {
      const [count, setCount] = createSignal(0);

      createEffect(on(count, (value, prev) => {
        log.push([value, prev]);
      }));

      expect(log).toEqual([[0, undefined]]);

      setCount(1);
      expect(log).toEqual([[0, undefined], [1, 0]]);

      setCount(5);
      expect(log).toEqual([[0, undefined], [1, 0], [5, 1]]);
    });
  });

  it('deferred mode skips initial run', () => {
    const spy = vi.fn();
    createRoot(() => {
      const [count, setCount] = createSignal(0);

      createEffect(on(count, (value, prev) => {
        spy(value, prev);
      }, { defer: true }));

      // Should NOT have run on initial
      expect(spy).not.toHaveBeenCalled();

      setCount(1);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(1, 0);
    });
  });

  it('works with computed deps function', () => {
    const spy = vi.fn();
    createRoot(() => {
      const [a, setA] = createSignal(1);
      const [b, setB] = createSignal(2);

      createEffect(on(
        () => a() + b(),
        (sum) => { spy(sum); },
      ));

      expect(spy).toHaveBeenCalledWith(3);

      setA(10);
      expect(spy).toHaveBeenCalledWith(12);

      setB(20);
      expect(spy).toHaveBeenCalledWith(30);
    });
  });
});
