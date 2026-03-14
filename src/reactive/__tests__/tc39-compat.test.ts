import { describe, it, expect } from 'vitest';
import { State, Computed } from '../tc39-compat';
import { createEffect } from '../effect';
import { createRoot } from '../root';

describe('State (TC39 Signal.State)', () => {
  it('stores and retrieves a value', () => {
    const count = new State(0);
    expect(count.get()).toBe(0);
  });

  it('set() updates the value', () => {
    const count = new State(0);
    count.set(42);
    expect(count.get()).toBe(42);
  });

  it('integrates with createEffect', () => {
    const log: number[] = [];
    createRoot(() => {
      const count = new State(0);
      createEffect(() => { log.push(count.get()); });

      expect(log).toEqual([0]);
      count.set(1);
      expect(log).toEqual([0, 1]);
    });
  });

  it('supports custom equality function', () => {
    const log: number[] = [];
    createRoot(() => {
      // Custom equality: consider equal if difference < 0.5
      const val = new State(1.0, {
        equals: (a, b) => Math.abs(a - b) < 0.5,
      });
      createEffect(() => { log.push(val.get()); });

      expect(log).toEqual([1.0]);

      // Difference is 0.1 — considered equal, no re-run
      val.set(1.1);
      expect(log).toEqual([1.0]);

      // Difference is 1.0 — not equal, triggers re-run
      val.set(2.0);
      expect(log).toEqual([1.0, 2.0]);
    });
  });

  it('works with various types', () => {
    const str = new State('hello');
    expect(str.get()).toBe('hello');
    str.set('world');
    expect(str.get()).toBe('world');

    const obj = new State({ x: 1 });
    expect(obj.get()).toEqual({ x: 1 });
  });
});

describe('Computed (TC39 Signal.Computed)', () => {
  it('derives value from State', () => {
    const count = new State(5);
    const doubled = new Computed(() => count.get() * 2);
    expect(doubled.get()).toBe(10);
  });

  it('updates when source State changes', () => {
    const count = new State(0);
    const doubled = new Computed(() => count.get() * 2);

    expect(doubled.get()).toBe(0);
    count.set(3);
    expect(doubled.get()).toBe(6);
  });

  it('chains computed values', () => {
    const base = new State(2);
    const doubled = new Computed(() => base.get() * 2);
    const quadrupled = new Computed(() => doubled.get() * 2);

    expect(quadrupled.get()).toBe(8);
    base.set(5);
    expect(quadrupled.get()).toBe(20);
  });

  it('works with createEffect', () => {
    const log: string[] = [];
    createRoot(() => {
      const firstName = new State('Alice');
      const lastName = new State('Smith');
      const full = new Computed(() => `${firstName.get()} ${lastName.get()}`);

      createEffect(() => { log.push(full.get()); });
      expect(log).toEqual(['Alice Smith']);

      firstName.set('Bob');
      expect(log).toEqual(['Alice Smith', 'Bob Smith']);
    });
  });
});
