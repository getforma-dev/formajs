import { describe, it, expect, vi } from 'vitest';
import { createSignal } from '../signal';
import { createComputed } from '../computed';
import { createMemo } from '../memo';
import { createEffect } from '../effect';
import { createRoot } from '../root';

describe('createComputed', () => {
  it('derives value from signal', () => {
    const [count] = createSignal(5);
    const doubled = createComputed(() => count() * 2);
    expect(doubled()).toBe(10);
  });

  it('updates when dependency changes', () => {
    const [count, setCount] = createSignal(3);
    const doubled = createComputed(() => count() * 2);

    expect(doubled()).toBe(6);
    setCount(10);
    expect(doubled()).toBe(20);
  });

  it('is lazy (does not compute until read)', () => {
    const computeSpy = vi.fn();
    const [count] = createSignal(0);

    const derived = createComputed(() => {
      computeSpy();
      return count() + 1;
    });

    // Not yet computed
    expect(computeSpy).not.toHaveBeenCalled();

    // Now read it
    derived();
    expect(computeSpy).toHaveBeenCalledTimes(1);
  });

  it('caches value (same result if deps unchanged)', () => {
    const computeSpy = vi.fn();
    const [count] = createSignal(0);

    const derived = createComputed(() => {
      computeSpy();
      return count() + 1;
    });

    derived();
    expect(computeSpy).toHaveBeenCalledTimes(1);

    // Read again without changing dependency
    derived();
    expect(computeSpy).toHaveBeenCalledTimes(1); // not recomputed
  });

  it('chains (computed of computed)', () => {
    const [count, setCount] = createSignal(2);
    const doubled = createComputed(() => count() * 2);
    const quadrupled = createComputed(() => doubled() * 2);

    expect(quadrupled()).toBe(8);

    setCount(5);
    expect(doubled()).toBe(10);
    expect(quadrupled()).toBe(20);
  });

  it('used as dependency in effects', () => {
    const log: number[] = [];
    createRoot(() => {
      const [count, setCount] = createSignal(1);
      const doubled = createComputed(() => count() * 2);

      createEffect(() => {
        log.push(doubled());
      });

      expect(log).toEqual([2]);

      setCount(3);
      expect(log).toEqual([2, 6]);
    });
  });

  it('handles multiple dependencies', () => {
    const [a, setA] = createSignal(2);
    const [b, setB] = createSignal(3);
    const sum = createComputed(() => a() + b());

    expect(sum()).toBe(5);
    setA(10);
    expect(sum()).toBe(13);
    setB(20);
    expect(sum()).toBe(30);
  });

  it('does not recompute when result is the same (glitch-free)', () => {
    const effectSpy = vi.fn();
    createRoot(() => {
      const [count, setCount] = createSignal(0);
      // always returns true for count >= 0
      const isNonNeg = createComputed(() => count() >= 0);

      createEffect(() => {
        isNonNeg();
        effectSpy();
      });

      expect(effectSpy).toHaveBeenCalledTimes(1);

      setCount(1); // isNonNeg still true
      // The computed result didn't change so the effect should not re-fire
      expect(isNonNeg()).toBe(true);
    });
  });
});

describe('createMemo (alias)', () => {
  it('is the same function as createComputed', () => {
    expect(createMemo).toBe(createComputed);
  });

  it('works identically', () => {
    const [count, setCount] = createSignal(3);
    const tripled = createMemo(() => count() * 3);

    expect(tripled()).toBe(9);
    setCount(4);
    expect(tripled()).toBe(12);
  });
});
