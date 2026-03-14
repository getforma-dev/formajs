import { describe, it, expect, vi } from 'vitest';
import { onKey } from '../keyboard';

function fireKey(target: EventTarget, key: string, mods: Partial<KeyboardEventInit> = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...mods,
  });
  target.dispatchEvent(event);
  return event;
}

describe('onKey', () => {
  it('fires handler on matching key', () => {
    const spy = vi.fn();
    const cleanup = onKey('escape', spy, { target: document });

    fireKey(document, 'Escape');
    expect(spy).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('does not fire for non-matching key', () => {
    const spy = vi.fn();
    const cleanup = onKey('escape', spy, { target: document });

    fireKey(document, 'Enter');
    expect(spy).not.toHaveBeenCalled();
    cleanup();
  });

  it('matches ctrl+key combo', () => {
    const spy = vi.fn();
    const cleanup = onKey('ctrl+s', spy, { target: document });

    // Without ctrl — should not match
    fireKey(document, 's');
    expect(spy).not.toHaveBeenCalled();

    // With ctrl — should match
    fireKey(document, 's', { ctrlKey: true });
    expect(spy).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('matches shift+key combo', () => {
    const spy = vi.fn();
    const cleanup = onKey('shift+enter', spy, { target: document });

    fireKey(document, 'Enter', { shiftKey: true });
    expect(spy).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('matches ctrl+shift+key combo', () => {
    const spy = vi.fn();
    const cleanup = onKey('ctrl+shift+z', spy, { target: document });

    // Only ctrl — no match
    fireKey(document, 'z', { ctrlKey: true });
    expect(spy).not.toHaveBeenCalled();

    // Both modifiers — match
    fireKey(document, 'z', { ctrlKey: true, shiftKey: true });
    expect(spy).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('matches meta/cmd modifier', () => {
    const spy = vi.fn();
    const cleanup = onKey('meta+k', spy, { target: document });

    fireKey(document, 'k', { metaKey: true });
    expect(spy).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('accepts "cmd" and "command" as meta aliases', () => {
    const spy1 = vi.fn();
    const spy2 = vi.fn();
    const c1 = onKey('cmd+k', spy1, { target: document });
    const c2 = onKey('command+k', spy2, { target: document });

    fireKey(document, 'k', { metaKey: true });
    expect(spy1).toHaveBeenCalledTimes(1);
    expect(spy2).toHaveBeenCalledTimes(1);
    c1();
    c2();
  });

  it('accepts "control" as ctrl alias', () => {
    const spy = vi.fn();
    const cleanup = onKey('control+a', spy, { target: document });

    fireKey(document, 'a', { ctrlKey: true });
    expect(spy).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('preventDefault is true by default', () => {
    const spy = vi.fn();
    const cleanup = onKey('ctrl+s', spy, { target: document });

    const event = fireKey(document, 's', { ctrlKey: true });
    expect(event.defaultPrevented).toBe(true);
    cleanup();
  });

  it('preventDefault can be disabled', () => {
    const spy = vi.fn();
    const cleanup = onKey('escape', spy, { target: document, preventDefault: false });

    const event = fireKey(document, 'Escape');
    expect(event.defaultPrevented).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('cleanup removes the listener', () => {
    const spy = vi.fn();
    const cleanup = onKey('escape', spy, { target: document });

    fireKey(document, 'Escape');
    expect(spy).toHaveBeenCalledTimes(1);

    cleanup();
    fireKey(document, 'Escape');
    expect(spy).toHaveBeenCalledTimes(1); // no additional call
  });

  it('can target a specific element', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);

    const spy = vi.fn();
    const cleanup = onKey('escape', spy, { target: input });

    // Fire on input — should match
    fireKey(input, 'Escape');
    expect(spy).toHaveBeenCalledTimes(1);

    cleanup();
    document.body.removeChild(input);
  });

  it('is case-insensitive in combo parsing', () => {
    const spy = vi.fn();
    const cleanup = onKey('Ctrl+Shift+Z', spy, { target: document });

    fireKey(document, 'z', { ctrlKey: true, shiftKey: true });
    expect(spy).toHaveBeenCalledTimes(1);
    cleanup();
  });
});
