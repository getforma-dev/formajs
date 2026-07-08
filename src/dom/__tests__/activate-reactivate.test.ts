// F1 (1.3.0): a second activateIslands() must not double-run/double-bind islands.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { activateIslands } from '../activate';

afterEach(() => { document.body.innerHTML = ''; });

describe('activateIslands re-invocation guard (F1)', () => {
  it('does not re-run a load island when activateIslands is called twice', () => {
    document.body.innerHTML =
      '<div data-forma-island="0" data-forma-component="Dup" data-forma-status="pending">' +
      '<span>x</span></div>';
    const hydrateFn = vi.fn(() => null);

    activateIslands({ Dup: hydrateFn });
    expect(hydrateFn).toHaveBeenCalledTimes(1);
    const island = document.querySelector('[data-forma-island]') as HTMLElement;
    expect(island.getAttribute('data-forma-status')).toBe('active');

    activateIslands({ Dup: hydrateFn });
    expect(hydrateFn).toHaveBeenCalledTimes(1);
    expect(island.getAttribute('data-forma-status')).toBe('active');
  });

  it('does not attach duplicate handlers on re-activation', () => {
    document.body.innerHTML =
      '<div data-forma-island="0" data-forma-component="Btn" data-forma-status="pending">' +
      '<button>click</button></div>';
    let attachCount = 0;
    const hydrateFn = vi.fn((el: HTMLElement) => {
      const btn = el.querySelector('button')!;
      btn.addEventListener('click', () => { attachCount++; });
      return null;
    });

    activateIslands({ Btn: hydrateFn });
    activateIslands({ Btn: hydrateFn });

    const btn = document.querySelector('button') as HTMLButtonElement;
    btn.dispatchEvent(new Event('click', { bubbles: true }));
    expect(attachCount).toBe(1);
  });

  it('re-activates a freshly re-rendered island (status reset to pending)', () => {
    document.body.innerHTML =
      '<div data-forma-island="0" data-forma-component="Fresh" data-forma-status="pending">' +
      '<span>x</span></div>';
    const hydrateFn = vi.fn(() => null);

    activateIslands({ Fresh: hydrateFn });
    expect(hydrateFn).toHaveBeenCalledTimes(1);

    const island = document.querySelector('[data-forma-island]') as HTMLElement;
    island.setAttribute('data-forma-status', 'pending');

    activateIslands({ Fresh: hydrateFn });
    expect(hydrateFn).toHaveBeenCalledTimes(2);
    expect(island.getAttribute('data-forma-status')).toBe('active');
  });

  it('does not double-register a visible-trigger observer on re-invocation', () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    (globalThis as any).IntersectionObserver = vi.fn(function (this: any) {
      this.observe = observe; this.disconnect = disconnect; return this;
    });
    document.body.innerHTML =
      '<div data-forma-island="0" data-forma-component="Vis" data-forma-hydrate="visible"' +
      ' data-forma-status="pending"><span>x</span></div>';
    const hydrateFn = vi.fn(() => null);

    activateIslands({ Vis: hydrateFn });
    activateIslands({ Vis: hydrateFn });

    expect(observe).toHaveBeenCalledTimes(1);
    expect(hydrateFn).not.toHaveBeenCalled();
    delete (globalThis as any).IntersectionObserver;
  });
});
