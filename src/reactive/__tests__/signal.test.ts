import { describe, it, expect, vi } from 'vitest';
import { createSignal, value } from '../signal';
import { createEffect, createRoot } from '../index';

describe('createSignal', () => {
  it('creates with initial value', () => {
    const [count] = createSignal(0);
    expect(count()).toBe(0);
  });

  it('creates with various initial types', () => {
    const [str] = createSignal('hello');
    const [bool] = createSignal(true);
    const [obj] = createSignal({ a: 1 });
    const [arr] = createSignal([1, 2, 3]);
    const [nul] = createSignal(null);
    const [undef] = createSignal(undefined);

    expect(str()).toBe('hello');
    expect(bool()).toBe(true);
    expect(obj()).toEqual({ a: 1 });
    expect(arr()).toEqual([1, 2, 3]);
    expect(nul()).toBe(null);
    expect(undef()).toBe(undefined);
  });

  it('getter returns current value', () => {
    const [count, setCount] = createSignal(5);
    expect(count()).toBe(5);
    setCount(10);
    expect(count()).toBe(10);
  });

  it('setter updates value with literal', () => {
    const [count, setCount] = createSignal(0);
    setCount(42);
    expect(count()).toBe(42);
  });

  it('setter with function updater', () => {
    const [count, setCount] = createSignal(10);
    setCount((prev) => prev + 5);
    expect(count()).toBe(15);
    setCount((prev) => prev * 2);
    expect(count()).toBe(30);
  });

  it('multiple signals are independent', () => {
    const [a, setA] = createSignal(1);
    const [b, setB] = createSignal(100);

    setA(2);
    expect(a()).toBe(2);
    expect(b()).toBe(100);

    setB(200);
    expect(a()).toBe(2);
    expect(b()).toBe(200);
  });

  it('returns correct [getter, setter] tuple', () => {
    const result = createSignal(0);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(typeof result[0]).toBe('function');
    expect(typeof result[1]).toBe('function');
  });

  it('setter accepts same value (no-op by Object.is)', () => {
    const [count, setCount] = createSignal(5);
    setCount(5);
    expect(count()).toBe(5);
  });

  it('handles object identity correctly', () => {
    const obj = { x: 1 };
    const [val, setVal] = createSignal(obj);
    expect(val()).toBe(obj);

    // Same reference -> no change
    setVal(obj);
    expect(val()).toBe(obj);

    // New object with same shape -> different reference
    const obj2 = { x: 1 };
    setVal(obj2);
    expect(val()).toBe(obj2);
    expect(val()).not.toBe(obj);
  });

  it('value() wrapper disambiguates function values', () => {
    const fn1 = () => 'a';
    const fn2 = () => 'b';
    const [getFn, setFn] = createSignal<() => string>(fn1);

    expect(getFn()()).toBe('a');

    // Use value() to set a function literal
    setFn(value(fn2));
    expect(getFn()()).toBe('b');
  });

  it('setter with function updater receives previous value', () => {
    const [count, setCount] = createSignal(0);
    const prevValues: number[] = [];

    setCount((prev) => { prevValues.push(prev); return prev + 1; });
    setCount((prev) => { prevValues.push(prev); return prev + 1; });
    setCount((prev) => { prevValues.push(prev); return prev + 1; });

    expect(prevValues).toEqual([0, 1, 2]);
    expect(count()).toBe(3);
  });
});

describe('createSignal with equals option', () => {
  it('skips update when equals returns true (literal setter)', () => {
    let effectCount = 0;
    const [pos, setPos] = createSignal(
      { x: 0, y: 0 },
      { equals: (a, b) => a.x === b.x && a.y === b.y },
    );

    createRoot(() => {
      createEffect(() => {
        pos();
        effectCount++;
      });
    });

    const before = effectCount;
    // Same values — should be skipped
    setPos({ x: 0, y: 0 });
    expect(effectCount).toBe(before);
    expect(pos()).toEqual({ x: 0, y: 0 });
  });

  it('applies update when equals returns false', () => {
    let effectCount = 0;
    const [pos, setPos] = createSignal(
      { x: 0, y: 0 },
      { equals: (a, b) => a.x === b.x && a.y === b.y },
    );

    createRoot(() => {
      createEffect(() => {
        pos();
        effectCount++;
      });
    });

    const before = effectCount;
    setPos({ x: 1, y: 0 });
    expect(effectCount).toBeGreaterThan(before);
    expect(pos()).toEqual({ x: 1, y: 0 });
  });

  it('skips update with functional setter when equals returns true', () => {
    let effectCount = 0;
    const [count, setCount] = createSignal(5, {
      equals: (a, b) => a === b,
    });

    createRoot(() => {
      createEffect(() => {
        count();
        effectCount++;
      });
    });

    const before = effectCount;
    // Functional update that returns the same value
    setCount(prev => prev);
    expect(effectCount).toBe(before);
  });

  it('applies functional update when equals returns false', () => {
    const [count, setCount] = createSignal(5, {
      equals: (a, b) => a === b,
    });

    setCount(prev => prev + 1);
    expect(count()).toBe(6);
  });

  it('works without equals option (default behavior)', () => {
    const [count, setCount] = createSignal(0);
    setCount(1);
    expect(count()).toBe(1);
    // Same reference — alien-signals uses !== internally
    setCount(1);
    expect(count()).toBe(1);
  });

  it('custom equals with array comparison', () => {
    const [items, setItems] = createSignal(
      [1, 2, 3],
      { equals: (a, b) => a.length === b.length && a.every((v, i) => v === b[i]) },
    );

    let effectCount = 0;
    createRoot(() => {
      createEffect(() => {
        items();
        effectCount++;
      });
    });

    const before = effectCount;
    // Same content — should skip
    setItems([1, 2, 3]);
    expect(effectCount).toBe(before);

    // Different content — should apply
    setItems([1, 2, 4]);
    expect(effectCount).toBeGreaterThan(before);
    expect(items()).toEqual([1, 2, 4]);
  });
});
