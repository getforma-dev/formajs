// Defects found by adversarial verification of the 1.2.0 store/state work.
import { describe, it, expect } from 'vitest';
import { createStore } from '../store';
import { createHistory } from '../history';
import { createSignal, internalEffect } from 'forma/reactive';

describe('store reconcile does not misread array methods (CRITICAL)', () => {
  it('reading an array method inside an effect then mutating does not throw', () => {
    const [state] = createStore({ todos: [{ text: 'a' }] });
    let mapped: string[] = [];
    expect(() => {
      internalEffect(() => { mapped = state.todos.map((t) => t.text); });
      state.todos.push({ text: 'b' });
    }).not.toThrow();
    expect(mapped).toEqual(['a', 'b']);
  });

  it('array-length truncation with a method read does not throw', () => {
    const [state] = createStore({ items: [1, 2, 3] });
    expect(() => {
      internalEffect(() => { void state.items.map((n) => n); });
      (state.items as unknown as { length: number }).length = 1;
    }).not.toThrow();
  });
});

describe('same-raw reassignment does not orphan subscribers (HIGH)', () => {
  it('assigning the identical object then mutating a descendant still notifies', () => {
    const raw = { v: 1 };
    const [state] = createStore<{ x: { v: number } }>({ x: raw });
    const seen: number[] = [];
    internalEffect(() => { seen.push(state.x.v); });
    (state as any).x = raw; // identical reference
    (state.x as any).v = 2;
    expect(seen).toEqual([1, 2]);
  });

  it('same-raw reassign at a mid path keeps deep grandchildren reactive', () => {
    const mid = { deep: { v: 1 } };
    const [state] = createStore<{ a: { deep: { v: number } } }>({ a: mid });
    const seen: number[] = [];
    internalEffect(() => { seen.push(state.a.deep.v); });
    (state as any).a = mid;
    (state.a.deep as any).v = 9;
    expect(seen).toEqual([1, 9]);
  });
});

describe('delete then re-add re-notifies subscribers (HIGH)', () => {
  it('delete a key then set it again notifies the original effect', () => {
    const [state] = createStore({ a: 1 } as Record<string, number>);
    const seen: Array<number | undefined> = [];
    internalEffect(() => { seen.push(state.a); });
    delete state.a;
    (state as any).a = 42;
    expect(seen).toEqual([1, undefined, 42]);
  });
});

describe('history maxLength is clamped (LOW)', () => {
  it('maxLength <= 0 still retains the current entry', () => {
    const [count, setCount] = createSignal(0);
    const h = createHistory([count, setCount], { maxLength: 0 });
    setCount(1);
    expect(h.history().length).toBeGreaterThanOrEqual(1);
    expect(h.cursor()).toBeGreaterThanOrEqual(0);
    expect(h.history()[h.cursor()]).toBe(1);
  });
});
