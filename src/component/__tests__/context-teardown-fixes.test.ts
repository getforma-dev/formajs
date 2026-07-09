// Context auto-teardown defects found by adversarial verification (1.5.0).
import { describe, it, expect, vi } from 'vitest';
import { defineComponent, disposeComponent, onMount, trackDisposer } from '../define';
import { createContext, provide, inject } from '../context';

describe('context auto-teardown correctness', () => {
  it('disposing one component does not corrupt a still-mounted sibling (HIGH)', () => {
    const ctx = createContext('default');
    const a = defineComponent(() => { provide(ctx, 'A'); return document.createElement('div'); })();
    const b = defineComponent(() => { provide(ctx, 'B'); return document.createElement('div'); })();
    expect(inject(ctx)).toBe('B'); // B provided last
    disposeComponent(a); // dispose A while B is still mounted
    // B's value must survive; A's frame is removed, not B's top frame.
    expect(inject(ctx)).toBe('B');
    disposeComponent(b);
    expect(inject(ctx)).toBe('default');
  });

  it('a setup that throws after provide() does not leak the value globally (HIGH)', () => {
    const ctx = createContext('def');
    const factory = defineComponent(() => {
      provide(ctx, 'LEAK');
      throw new Error('setup boom');
    });
    expect(() => factory()).toThrow('setup boom');
    expect(inject(ctx)).toBe('def'); // provide was unwound on throw
  });

  it('provide() inside onMount is balanced on dispose (MEDIUM)', () => {
    const ctx = createContext('base');
    const dom = defineComponent(() => {
      onMount(() => { provide(ctx, 'mounted'); });
      return document.createElement('div');
    })();
    expect(inject(ctx)).toBe('mounted');
    disposeComponent(dom);
    expect(inject(ctx)).toBe('base');
  });

  it('trackDisposer() inside onMount is cleaned up on dispose (LOW)', () => {
    const spy = vi.fn();
    const dom = defineComponent(() => {
      onMount(() => { trackDisposer(spy); });
      return document.createElement('div');
    })();
    expect(spy).not.toHaveBeenCalled();
    disposeComponent(dom);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
