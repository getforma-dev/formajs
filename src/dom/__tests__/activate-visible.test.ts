/**
 * Tests for visible hydration trigger in activateIslands().
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { activateIslands } from '../activate.js';

// Mock IntersectionObserver
let observerCallback: IntersectionObserverCallback;
let observerInstance: { observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> };

beforeEach(() => {
  observerInstance = { observe: vi.fn(), disconnect: vi.fn() };
  // Must use function (not arrow) so it can be called with `new`
  const MockIO = vi.fn(function (this: any, cb: IntersectionObserverCallback) {
    observerCallback = cb;
    this.observe = observerInstance.observe;
    this.disconnect = observerInstance.disconnect;
    return this;
  });
  (globalThis as any).IntersectionObserver = MockIO;
});

afterEach(() => {
  document.body.innerHTML = '';
  delete (globalThis as any).IntersectionObserver;
});

function makeIsland(id: number, component: string, trigger?: string): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-forma-island', String(id));
  el.setAttribute('data-forma-component', component);
  el.setAttribute('data-forma-status', 'pending');
  if (trigger) el.setAttribute('data-forma-hydrate', trigger);
  el.setAttribute('data-forma-ssr', '');
  el.innerHTML = '<p>SSR content</p>';
  document.body.appendChild(el);
  return el;
}

describe('activateIslands visible trigger', () => {
  it('hydrates load-trigger islands immediately', () => {
    const el = makeIsland(1, 'Counter', 'load');
    const hydrateFn = vi.fn(() => null);
    activateIslands({ Counter: hydrateFn });
    expect(hydrateFn).toHaveBeenCalledOnce();
    expect(el.getAttribute('data-forma-status')).toBe('active');
  });

  it('hydrates islands with no trigger attribute immediately', () => {
    const el = makeIsland(1, 'Counter');
    const hydrateFn = vi.fn(() => null);
    activateIslands({ Counter: hydrateFn });
    expect(hydrateFn).toHaveBeenCalledOnce();
    expect(el.getAttribute('data-forma-status')).toBe('active');
  });

  it('defers visible-trigger islands behind IntersectionObserver', () => {
    const el = makeIsland(1, 'Counter', 'visible');
    const hydrateFn = vi.fn(() => null);
    activateIslands({ Counter: hydrateFn });

    expect(hydrateFn).not.toHaveBeenCalled();
    expect(el.getAttribute('data-forma-status')).toBe('pending');
    expect(observerInstance.observe).toHaveBeenCalledWith(el);
  });

  it('hydrates visible island when intersection fires', () => {
    const el = makeIsland(1, 'Counter', 'visible');
    const hydrateFn = vi.fn(() => null);
    activateIslands({ Counter: hydrateFn });

    // Simulate intersection
    observerCallback(
      [{ isIntersecting: true, target: el } as unknown as IntersectionObserverEntry],
      observerInstance as unknown as IntersectionObserver,
    );

    expect(hydrateFn).toHaveBeenCalledOnce();
    expect(el.getAttribute('data-forma-status')).toBe('active');
    expect(observerInstance.disconnect).toHaveBeenCalled();
  });

  it('ignores non-intersecting entries', () => {
    const el = makeIsland(1, 'Counter', 'visible');
    const hydrateFn = vi.fn(() => null);
    activateIslands({ Counter: hydrateFn });

    observerCallback(
      [{ isIntersecting: false, target: el } as unknown as IntersectionObserverEntry],
      observerInstance as unknown as IntersectionObserver,
    );

    expect(hydrateFn).not.toHaveBeenCalled();
    expect(el.getAttribute('data-forma-status')).toBe('pending');
  });

  it('defers interaction-trigger islands until user interaction', () => {
    const el = makeIsland(1, 'Counter', 'interaction');
    const hydrateFn = vi.fn(() => null);
    activateIslands({ Counter: hydrateFn });

    // Should NOT hydrate immediately — waits for user interaction
    expect(hydrateFn).not.toHaveBeenCalled();
    expect(el.getAttribute('data-forma-status')).toBe('pending');

    // Simulate pointerdown to trigger hydration
    el.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(hydrateFn).toHaveBeenCalledOnce();
    expect(el.getAttribute('data-forma-status')).toBe('active');
  });

  it('defers idle-trigger islands behind requestIdleCallback', () => {
    let idleCallback: (() => void) | undefined;
    vi.stubGlobal('requestIdleCallback', (cb: () => void) => { idleCallback = cb; return 1; });

    const el = makeIsland(1, 'Counter', 'idle');
    const hydrateFn = vi.fn(() => null);
    activateIslands({ Counter: hydrateFn });

    // Should NOT hydrate immediately — waits for idle callback
    expect(hydrateFn).not.toHaveBeenCalled();
    expect(el.getAttribute('data-forma-status')).toBe('pending');

    // Fire the idle callback
    idleCallback!();
    expect(hydrateFn).toHaveBeenCalledOnce();
    expect(el.getAttribute('data-forma-status')).toBe('active');

    vi.unstubAllGlobals();
  });

  it('creates IntersectionObserver with 200px rootMargin', () => {
    makeIsland(1, 'Counter', 'visible');
    activateIslands({ Counter: vi.fn(() => null) });

    expect(globalThis.IntersectionObserver).toHaveBeenCalledWith(
      expect.any(Function),
      { rootMargin: '200px' },
    );
  });
});
