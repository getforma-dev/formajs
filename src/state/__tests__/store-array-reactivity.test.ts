import { describe, it, expect } from 'vitest';
import { createStore } from '../store';
import { internalEffect } from 'forma/reactive';

describe('createStore array reactivity (1.2.0)', () => {
  it('array push notifies a length-tracking effect', () => {
    const [state] = createStore({ items: ['a', 'b'] });
    const lengths: number[] = [];
    internalEffect(() => { lengths.push(state.items.length); });
    state.items.push('c');
    expect(lengths).toEqual([2, 3]);
  });

  it('array push notifies an effect reading the new index', () => {
    const [state] = createStore({ items: ['a', 'b'] });
    const seen: Array<string | undefined> = [];
    internalEffect(() => { seen.push(state.items[2]); });
    state.items.push('c');
    expect(seen).toEqual([undefined, 'c']);
  });

  it('array push notifies an effect that reads the array itself (own path)', () => {
    const [state] = createStore({ items: ['a', 'b'] });
    let runs = 0;
    internalEffect(() => { void state.items; runs++; });
    state.items.push('c');
    expect(runs).toBe(2);
  });

  it('array pop notifies the dropped index effect and length effect', () => {
    const [state] = createStore({ items: ['a', 'b', 'c'] });
    const idx2: Array<string | undefined> = [];
    const lengths: number[] = [];
    internalEffect(() => { idx2.push(state.items[2]); });
    internalEffect(() => { lengths.push(state.items.length); });
    state.items.pop();
    expect(idx2).toEqual(['c', undefined]);
    expect(lengths).toEqual([3, 2]);
  });

  it('array shift notifies shifted index effects and length', () => {
    const [state] = createStore({ items: ['a', 'b', 'c'] });
    const idx0: Array<string | undefined> = [];
    const lengths: number[] = [];
    internalEffect(() => { idx0.push(state.items[0]); });
    internalEffect(() => { lengths.push(state.items.length); });
    state.items.shift();
    expect(idx0).toEqual(['a', 'b']);
    expect(lengths).toEqual([3, 2]);
  });

  it('array unshift notifies index effects and length', () => {
    const [state] = createStore({ items: [3, 4] });
    const idx0: Array<number | undefined> = [];
    const lengths: number[] = [];
    internalEffect(() => { idx0.push(state.items[0]); });
    internalEffect(() => { lengths.push(state.items.length); });
    state.items.unshift(1, 2);
    expect(idx0).toEqual([3, 1]);
    expect(lengths).toEqual([2, 4]);
  });

  it('array splice notifies changed index effects', () => {
    const [state] = createStore({ items: [1, 2, 3, 4, 5] });
    const idx1: Array<number | undefined> = [];
    internalEffect(() => { idx1.push(state.items[1]); });
    state.items.splice(1, 2, 20, 30);
    expect(idx1).toEqual([2, 20]);
  });

  it('array sort notifies reordered index effects', () => {
    const [state] = createStore({ items: [3, 1, 2] });
    const idx0: Array<number | undefined> = [];
    internalEffect(() => { idx0.push(state.items[0]); });
    state.items.sort();
    expect(idx0).toEqual([3, 1]);
  });

  it('array reverse notifies reordered index effects', () => {
    const [state] = createStore({ items: [1, 2, 3] });
    const idx0: Array<number | undefined> = [];
    internalEffect(() => { idx0.push(state.items[0]); });
    state.items.reverse();
    expect(idx0).toEqual([1, 3]);
  });

  it('truncating via arr.length notifies dropped index effects', () => {
    const [state] = createStore({ items: ['a', 'b', 'c'] });
    const idx2: Array<string | undefined> = [];
    internalEffect(() => { idx2.push(state.items[2]); });
    (state.items as unknown as { length: number }).length = 1;
    expect(idx2).toEqual(['c', undefined]);
    expect(state.items[2]).toBeUndefined();
  });

  it('deleting a property notifies effects reading that property', () => {
    const [state] = createStore({ a: 1, b: 2 } as Record<string, number>);
    const seen: Array<number | undefined> = [];
    internalEffect(() => { seen.push(state.b); });
    delete state.b;
    expect(seen).toEqual([2, undefined]);
  });

  it('deleting a property notifies an "in" membership effect', () => {
    const [state] = createStore({ a: 1, b: 2 } as Record<string, number>);
    const present: boolean[] = [];
    internalEffect(() => { present.push('b' in state); });
    delete state.b;
    expect(present).toEqual([true, false]);
  });

  it('push with objects notifies own-path effect and keeps lazy wrapping', () => {
    const [state] = createStore({ todos: [{ text: 'first', done: false }] });
    let runs = 0;
    internalEffect(() => { void state.todos; runs++; });
    state.todos.push({ text: 'second', done: true });
    expect(runs).toBe(2);
    expect(state.todos[1].text).toBe('second');
    expect(state.todos.length).toBe(2);
  });
});