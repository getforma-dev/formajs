import { describe, it, expect, vi } from 'vitest';
import { delegate } from '../delegate';

describe('delegate', () => {
  it('fires handler when clicking a matching child', () => {
    const container = document.createElement('div');
    const btn = document.createElement('button');
    btn.className = 'action';
    container.appendChild(btn);
    document.body.appendChild(container);

    const spy = vi.fn();
    delegate(container, '.action', 'click', spy);

    btn.click();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toBe(btn);

    document.body.removeChild(container);
  });

  it('does not fire for non-matching children', () => {
    const container = document.createElement('div');
    const span = document.createElement('span');
    container.appendChild(span);
    document.body.appendChild(container);

    const spy = vi.fn();
    delegate(container, '.action', 'click', spy);

    span.click();
    expect(spy).not.toHaveBeenCalled();

    document.body.removeChild(container);
  });

  it('matches nested elements via closest()', () => {
    const container = document.createElement('div');
    const btn = document.createElement('button');
    btn.className = 'action';
    const icon = document.createElement('span');
    btn.appendChild(icon);
    container.appendChild(btn);
    document.body.appendChild(container);

    const spy = vi.fn();
    delegate(container, '.action', 'click', spy);

    icon.click();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toBe(btn);

    document.body.removeChild(container);
  });

  it('returns cleanup function that removes listener', () => {
    const container = document.createElement('div');
    const btn = document.createElement('button');
    btn.className = 'target';
    container.appendChild(btn);
    document.body.appendChild(container);

    const spy = vi.fn();
    const cleanup = delegate(container, '.target', 'click', spy);

    btn.click();
    expect(spy).toHaveBeenCalledTimes(1);

    cleanup();
    btn.click();
    expect(spy).toHaveBeenCalledTimes(1); // no additional call

    document.body.removeChild(container);
  });

  it('does not match elements outside the container', () => {
    const container = document.createElement('div');
    const outside = document.createElement('button');
    outside.className = 'action';
    document.body.appendChild(container);
    document.body.appendChild(outside);

    const spy = vi.fn();
    delegate(container, '.action', 'click', spy);

    outside.click();
    expect(spy).not.toHaveBeenCalled();

    document.body.removeChild(container);
    document.body.removeChild(outside);
  });
});
