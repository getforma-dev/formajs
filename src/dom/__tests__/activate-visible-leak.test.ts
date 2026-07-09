// F2 (1.3.0): a visible-trigger IntersectionObserver must be disconnected when the
// island is deactivated before it ever intersects (otherwise it leaks).
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { activateIslands, deactivateIsland } from '../activate';

let obInstance: { observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> };

beforeEach(() => {
  obInstance = { observe: vi.fn(), disconnect: vi.fn() };
  (globalThis as any).IntersectionObserver = vi.fn(function (this: any) {
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
});
