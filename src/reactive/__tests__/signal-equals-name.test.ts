// Signal F1 (equals:()=>false forces notify) and F2 (debug name does not break
// isSignal) — 1.1.0.
import { describe, it, expect } from 'vitest';
import { createSignal, getSignalName } from '../signal';
import { createEffect, createRoot } from '../index';
import { isSignal } from 'alien-signals';
import { State } from '../tc39-compat';

describe('equals:()=>false forces notify on identical reference', () => {
  it('re-runs subscribers when equals returns false even for same object ref', () => {
    let effectCount = 0;
    const obj = { x: 0 };
    const [pos, setPos] = createSignal(obj, { equals: () => false });
    createRoot(() => {
      createEffect(() => { pos(); effectCount++; });
    });
    const before = effectCount;
    setPos(obj); // identical ref, equals()=>false MUST force a re-run
    expect(effectCount).toBe(before + 1);
    expect(pos()).toBe(obj);
  });

  it('functional updater returning same ref still forces when equals is false', () => {
    let effectCount = 0;
    const obj = { n: 1 };
    const [g, s] = createSignal(obj, { equals: () => false });
    createRoot(() => { createEffect(() => { g(); effectCount++; }); });
    const before = effectCount;
    s((prev) => prev); // identical ref
    expect(effectCount).toBe(before + 1);
  });

  it('default (no equals) still de-dupes identical refs (unchanged)', () => {
    let effectCount = 0;
    const obj = { x: 0 };
    const [g, s] = createSignal(obj);
    createRoot(() => { createEffect(() => { g(); effectCount++; }); });
    const before = effectCount;
    s(obj);
    expect(effectCount).toBe(before);
  });

  it('equals returning true still suppresses', () => {
    let effectCount = 0;
    const [g, s] = createSignal(1, { equals: () => true });
    createRoot(() => { createEffect(() => { g(); effectCount++; }); });
    const before = effectCount;
    s(2);
    expect(effectCount).toBe(before);
  });
});

describe('debug name does not break isSignal', () => {
  it('createSignal with name keeps getter recognized by isSignal', () => {
    const [g] = createSignal(0, { name: 'counter' });
    expect(isSignal(g)).toBe(true);
    expect(getSignalName(g)).toBe('counter');
  });

  it('State with name option is still a valid signal underneath', () => {
    const st = new State(0, { name: 'myState' });
    expect(st.get()).toBe(0);
    st.set(1);
    expect(st.get()).toBe(1);
  });
});
