import { describe, it, expect, vi, afterEach } from 'vitest';
import { onMutation, onResize, onIntersect } from '../observe';

// `onResize` and `onIntersect` used to be uncovered with a comment saying they
// were "validated by analogy" with `onMutation`. They are not: each has its own
// `observer.observe(el)` call, and deleting either one leaves a wrapper that
// returns a working disconnect function and never fires. happy-dom implements
// neither constructor, so both are installed as fakes here — but the assertion
// is on the EFFECT (the handler ran with the entry, the element was the one
// observed, disconnect really detached), never on the fake's arguments alone.

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

// ---------------------------------------------------------------------------
// ResizeObserver / IntersectionObserver wrappers
// ---------------------------------------------------------------------------

interface FakeObserver<E> {
  observed: Element[];
  disconnected: boolean;
  options: unknown;
  fire(entries: E[]): void;
}

/** Install a fake observer constructor on globalThis; returns the live instance. */
function installFake<E>(name: 'ResizeObserver' | 'IntersectionObserver'): {
  instances: Array<FakeObserver<E>>;
  restore: () => void;
} {
  const instances: Array<FakeObserver<E>> = [];
  const previous = (globalThis as Record<string, unknown>)[name];
  function Fake(this: FakeObserver<E>, cb: (entries: E[]) => void, options?: unknown) {
    this.observed = [];
    this.disconnected = false;
    this.options = options;
    this.fire = (entries: E[]) => { if (!this.disconnected) cb(entries); };
    (this as unknown as { observe: (el: Element) => void }).observe = (el: Element) => {
      this.observed.push(el);
    };
    (this as unknown as { disconnect: () => void }).disconnect = () => {
      this.disconnected = true;
    };
    instances.push(this);
    return this;
  }
  (globalThis as Record<string, unknown>)[name] = Fake as unknown;
  return {
    instances,
    restore: () => { (globalThis as Record<string, unknown>)[name] = previous; },
  };
}

const restorers: Array<() => void> = [];
afterEach(() => { for (const r of restorers.splice(0)) r(); });

describe('onResize', () => {
  it('observes the element it was given and forwards every entry to the handler', () => {
    const fake = installFake<ResizeObserverEntry>('ResizeObserver');
    restorers.push(fake.restore);
    const el = document.createElement('div');
    const other = document.createElement('div');
    const seen: ResizeObserverEntry[] = [];

    const stop = onResize(el, (entry) => seen.push(entry));

    // The element is actually under observation — a wrapper that constructed
    // the observer and never called observe() would fire for nothing.
    expect(fake.instances[0]!.observed).toEqual([el]);
    expect(fake.instances[0]!.observed).not.toContain(other);

    const a = { target: el, contentRect: { width: 10 } } as unknown as ResizeObserverEntry;
    const b = { target: el, contentRect: { width: 20 } } as unknown as ResizeObserverEntry;
    fake.instances[0]!.fire([a, b]);

    // Every entry in the batch, in order — the loop is not a single-entry read.
    expect(seen).toEqual([a, b]);
    stop();
  });

  it('its cleanup disconnects, and no further entry reaches the handler', () => {
    const fake = installFake<ResizeObserverEntry>('ResizeObserver');
    restorers.push(fake.restore);
    const handler = vi.fn();
    const stop = onResize(document.createElement('div'), handler);

    stop();
    fake.instances[0]!.fire([{ } as unknown as ResizeObserverEntry]);

    expect(fake.instances[0]!.disconnected).toBe(true);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('onIntersect', () => {
  it('observes the element and forwards every entry to the handler', () => {
    const fake = installFake<IntersectionObserverEntry>('IntersectionObserver');
    restorers.push(fake.restore);
    const el = document.createElement('div');
    const seen: boolean[] = [];

    const stop = onIntersect(el, (entry) => seen.push(entry.isIntersecting));

    expect(fake.instances[0]!.observed).toEqual([el]);

    fake.instances[0]!.fire([
      { isIntersecting: true, target: el } as unknown as IntersectionObserverEntry,
      { isIntersecting: false, target: el } as unknown as IntersectionObserverEntry,
    ]);

    expect(seen).toEqual([true, false]);
    stop();
  });

  it('passes its options through to the observer', () => {
    const fake = installFake<IntersectionObserverEntry>('IntersectionObserver');
    restorers.push(fake.restore);
    const options = { rootMargin: '200px', threshold: 0.5 };
    const stop = onIntersect(document.createElement('div'), () => {}, options);
    expect(fake.instances[0]!.options).toEqual(options);
    stop();
  });

  it('its cleanup disconnects, and no further entry reaches the handler', () => {
    const fake = installFake<IntersectionObserverEntry>('IntersectionObserver');
    restorers.push(fake.restore);
    const handler = vi.fn();
    const stop = onIntersect(document.createElement('div'), handler);

    stop();
    fake.instances[0]!.fire([{ isIntersecting: true } as unknown as IntersectionObserverEntry]);

    expect(fake.instances[0]!.disconnected).toBe(true);
    expect(handler).not.toHaveBeenCalled();
  });
});
