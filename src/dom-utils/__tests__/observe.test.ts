import { describe, it, expect, vi } from 'vitest';
import { onMutation } from '../observe';

// Note: ResizeObserver and IntersectionObserver are not reliably available
// in happy-dom. MutationObserver IS supported, so we test that thoroughly.
// onResize and onIntersect follow the same pattern — if MutationObserver
// tests pass, the wrapper pattern is validated.

describe('onMutation', () => {
  it('fires handler when children change', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);

    const spy = vi.fn();
    const cleanup = onMutation(el, spy);

    // Trigger a mutation
    const child = document.createElement('span');
    el.appendChild(child);

    // MutationObserver callbacks are async (microtask)
    await new Promise(r => setTimeout(r, 10));

    expect(spy).toHaveBeenCalled();
    const mutations = spy.mock.calls[0][0];
    expect(Array.isArray(mutations)).toBe(true);

    cleanup();
    document.body.removeChild(el);
  });

  it('cleanup stops observing', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);

    const spy = vi.fn();
    const cleanup = onMutation(el, spy);

    cleanup(); // stop before mutation

    el.appendChild(document.createElement('p'));
    await new Promise(r => setTimeout(r, 10));

    expect(spy).not.toHaveBeenCalled();
    document.body.removeChild(el);
  });

  it('accepts custom options', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);

    const spy = vi.fn();
    const cleanup = onMutation(el, spy, {
      childList: true,
      attributes: true,
    });

    // Trigger attribute mutation
    el.setAttribute('data-x', 'y');
    await new Promise(r => setTimeout(r, 10));

    expect(spy).toHaveBeenCalled();

    cleanup();
    document.body.removeChild(el);
  });

  it('returns a cleanup function', () => {
    const el = document.createElement('div');
    const cleanup = onMutation(el, () => {});
    expect(typeof cleanup).toBe('function');
    cleanup();
  });
});
