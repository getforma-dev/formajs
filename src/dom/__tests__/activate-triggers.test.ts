/**
 * Tests for idle and interaction hydration triggers in activateIslands().
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { activateIslands } from '../activate.js';

// Mock IntersectionObserver (needed because activate.ts references it for 'visible')
beforeEach(() => {
  const MockIO = vi.fn(function (this: any, cb: IntersectionObserverCallback) {
    this.observe = vi.fn();
    this.disconnect = vi.fn();
    return this;
  });
  (globalThis as any).IntersectionObserver = MockIO;
});

afterEach(() => {
  document.body.innerHTML = '';
  delete (globalThis as any).IntersectionObserver;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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

// ---------------------------------------------------------------------------
// idle trigger
// ---------------------------------------------------------------------------

describe('activateIslands idle trigger', () => {
  it('calls requestIdleCallback when available', () => {
    let idleCallback: (() => void) | undefined;
    vi.stubGlobal('requestIdleCallback', vi.fn((cb: () => void) => {
      idleCallback = cb;
      return 1;
    }));

    const el = makeIsland(1, 'Counter', 'idle');
    const hydrateFn = vi.fn(() => null);
    activateIslands({ Counter: hydrateFn });

    expect(globalThis.requestIdleCallback).toHaveBeenCalledOnce();
    expect(hydrateFn).not.toHaveBeenCalled();
    expect(el.getAttribute('data-forma-status')).toBe('pending');

    // Fire the idle callback
    idleCallback!();
    expect(hydrateFn).toHaveBeenCalledOnce();
    expect(el.getAttribute('data-forma-status')).toBe('active');
  });

  it('falls back to setTimeout(200) when requestIdleCallback is unavailable', () => {
    // Ensure requestIdleCallback is not available
    vi.stubGlobal('requestIdleCallback', undefined);

    vi.useFakeTimers();

    const el = makeIsland(1, 'Counter', 'idle');
    const hydrateFn = vi.fn(() => null);
    activateIslands({ Counter: hydrateFn });

    // Should not hydrate immediately
    expect(hydrateFn).not.toHaveBeenCalled();
    expect(el.getAttribute('data-forma-status')).toBe('pending');

    // Advance time by 199ms — still not hydrated
    vi.advanceTimersByTime(199);
    expect(hydrateFn).not.toHaveBeenCalled();

    // Advance to 200ms — now hydrated
    vi.advanceTimersByTime(1);
    expect(hydrateFn).toHaveBeenCalledOnce();
    expect(el.getAttribute('data-forma-status')).toBe('active');

    vi.useRealTimers();
  });

  it('transitions status pending -> hydrating -> active for idle trigger', () => {
    let idleCallback: (() => void) | undefined;
    vi.stubGlobal('requestIdleCallback', vi.fn((cb: () => void) => {
      idleCallback = cb;
      return 1;
    }));

    const el = makeIsland(1, 'StatusTrack', 'idle');
    const statusDuringHydration: string[] = [];

    const hydrateFn = vi.fn(() => {
      statusDuringHydration.push(el.getAttribute('data-forma-status')!);
      return null;
    });

    activateIslands({ StatusTrack: hydrateFn });

    // Before idle fires, status should still be pending
    expect(el.getAttribute('data-forma-status')).toBe('pending');

    // Fire idle
    idleCallback!();
    expect(statusDuringHydration).toContain('hydrating');
    expect(el.getAttribute('data-forma-status')).toBe('active');
  });
});

// ---------------------------------------------------------------------------
// interaction trigger
// ---------------------------------------------------------------------------

describe('activateIslands interaction trigger', () => {
  it('does NOT hydrate immediately', () => {
    const el = makeIsland(1, 'Counter', 'interaction');
    const hydrateFn = vi.fn(() => null);
    activateIslands({ Counter: hydrateFn });

    expect(hydrateFn).not.toHaveBeenCalled();
    expect(el.getAttribute('data-forma-status')).toBe('pending');
  });

  it('hydrates on pointerdown event', () => {
    const el = makeIsland(1, 'Counter', 'interaction');
    const hydrateFn = vi.fn(() => null);
    activateIslands({ Counter: hydrateFn });

    expect(hydrateFn).not.toHaveBeenCalled();

    el.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect(hydrateFn).toHaveBeenCalledOnce();
    expect(el.getAttribute('data-forma-status')).toBe('active');
  });

  it('hydrates on focusin event', () => {
    const el = makeIsland(1, 'Counter', 'interaction');
    const hydrateFn = vi.fn(() => null);
    activateIslands({ Counter: hydrateFn });

    expect(hydrateFn).not.toHaveBeenCalled();

    el.dispatchEvent(new Event('focusin', { bubbles: true }));

    expect(hydrateFn).toHaveBeenCalledOnce();
    expect(el.getAttribute('data-forma-status')).toBe('active');
  });

  it('listeners are cleaned up after hydration (no double-hydrate)', () => {
    const el = makeIsland(1, 'Counter', 'interaction');
    const hydrateFn = vi.fn(() => null);
    activateIslands({ Counter: hydrateFn });

    // First interaction hydrates
    el.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(hydrateFn).toHaveBeenCalledOnce();

    // Second interaction should NOT cause another hydration
    el.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    el.dispatchEvent(new Event('focusin', { bubbles: true }));
    expect(hydrateFn).toHaveBeenCalledOnce();
  });

  it('focusin after pointerdown does not double-hydrate', () => {
    const el = makeIsland(1, 'Counter', 'interaction');
    const hydrateFn = vi.fn(() => null);
    activateIslands({ Counter: hydrateFn });

    // Hydrate via pointerdown
    el.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(hydrateFn).toHaveBeenCalledOnce();

    // focusin after should not re-hydrate
    el.dispatchEvent(new Event('focusin', { bubbles: true }));
    expect(hydrateFn).toHaveBeenCalledOnce();
  });

  it('pointerdown after focusin does not double-hydrate', () => {
    const el = makeIsland(1, 'Counter', 'interaction');
    const hydrateFn = vi.fn(() => null);
    activateIslands({ Counter: hydrateFn });

    // Hydrate via focusin
    el.dispatchEvent(new Event('focusin', { bubbles: true }));
    expect(hydrateFn).toHaveBeenCalledOnce();

    // pointerdown after should not re-hydrate
    el.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(hydrateFn).toHaveBeenCalledOnce();
  });

  it('transitions status pending -> hydrating -> active for interaction trigger', () => {
    const el = makeIsland(1, 'StatusTrack', 'interaction');
    const statusDuringHydration: string[] = [];

    const hydrateFn = vi.fn(() => {
      statusDuringHydration.push(el.getAttribute('data-forma-status')!);
      return null;
    });

    activateIslands({ StatusTrack: hydrateFn });

    // Before interaction, status should still be pending
    expect(el.getAttribute('data-forma-status')).toBe('pending');

    // Trigger interaction
    el.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(statusDuringHydration).toContain('hydrating');
    expect(el.getAttribute('data-forma-status')).toBe('active');
  });
});
