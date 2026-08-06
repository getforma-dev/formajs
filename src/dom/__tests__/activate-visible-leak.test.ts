// F2 (1.3.0): a visible-trigger IntersectionObserver must be disconnected when the
// island is deactivated before it ever intersects (otherwise it leaks).
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { activateIslands, deactivateIsland } from '../activate';

let obInstance: { observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> };
/** The callback the runtime handed to `new IntersectionObserver(...)`. */
let obCallback: ((entries: Array<{ isIntersecting: boolean }>) => void) | null;

beforeEach(() => {
  obInstance = { observe: vi.fn(), disconnect: vi.fn() };
  obCallback = null;
  (globalThis as any).IntersectionObserver = vi.fn(function (this: any, cb: any) {
    obCallback = cb;
    this.observe = obInstance.observe;
    this.disconnect = obInstance.disconnect;
    return this;
  });
});
afterEach(() => {
  document.body.innerHTML = '';
  delete (globalThis as any).IntersectionObserver;
});

function makeVisibleIsland(): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-forma-island', '1');
  el.setAttribute('data-forma-component', 'Counter');
  el.setAttribute('data-forma-hydrate', 'visible');
  el.setAttribute('data-forma-status', 'pending');
  el.innerHTML = '<p>SSR</p>';
  document.body.appendChild(el);
  return el;
}

describe('activateIslands visible observer leak (F2)', () => {
  it('disconnects the observer when the island is deactivated before intersecting', () => {
    const el = makeVisibleIsland();
    activateIslands({ Counter: vi.fn(() => null) });
    expect(obInstance.observe).toHaveBeenCalledWith(el);
    expect(obInstance.disconnect).not.toHaveBeenCalled();

    deactivateIsland(el);
    expect(obInstance.disconnect).toHaveBeenCalledTimes(1);
  });

  it('deactivating a never-hydrated visible island leaves status pending (not disposed)', () => {
    const el = makeVisibleIsland();
    activateIslands({ Counter: vi.fn(() => null) });
    deactivateIsland(el);
    expect(el.getAttribute('data-forma-status')).toBe('pending');
  });

  it('a deferred callback that fires after disposal cannot resurrect the island', () => {
    // deactivateIsland sets a `__formaDisposed` marker "so any deferred callback
    // that still fires cannot resurrect a torn-down island". Cancelling the
    // observer is the first line of defence; this is the second, and it is the
    // one that matters when a scheduler hands back a callback that was already
    // in flight. Firing the captured callback after disconnect models exactly
    // that, and nothing covered it.
    const el = makeVisibleIsland();
    const hydrate = vi.fn(() => null);
    activateIslands({ Counter: hydrate });
    expect(hydrate).not.toHaveBeenCalled();

    deactivateIsland(el);
    obCallback!([{ isIntersecting: true }]);

    expect(hydrate, 'a disposed island must not hydrate').not.toHaveBeenCalled();
    expect(el.getAttribute('data-forma-status')).toBe('pending');
  });
});
