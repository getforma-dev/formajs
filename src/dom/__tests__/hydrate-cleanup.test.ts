import { describe, it, expect, vi } from 'vitest';
import { applyDynamicProps } from '../hydrate';
import { cleanup } from '../element';

// ---------------------------------------------------------------------------
// C3: applyDynamicProps uses AbortController so cleanup(el) removes listeners
// ---------------------------------------------------------------------------

describe('applyDynamicProps — AbortController cleanup', () => {
  it('hydrated event listeners fire before cleanup', () => {
    const el = document.createElement('button');
    const handler = vi.fn();

    applyDynamicProps(el, { onClick: handler });

    el.click();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('after cleanup(el), event listeners no longer fire', () => {
    const el = document.createElement('button');
    const handler = vi.fn();

    applyDynamicProps(el, { onClick: handler });

    // Listener fires before cleanup
    el.click();
    expect(handler).toHaveBeenCalledTimes(1);

    // Cleanup removes the listener
    cleanup(el);

    // Listener should NOT fire after cleanup
    el.click();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('multiple event listeners on the same element share one AbortController', () => {
    const el = document.createElement('div');
    const clickHandler = vi.fn();
    const mouseoverHandler = vi.fn();

    applyDynamicProps(el, { onClick: clickHandler, onMouseover: mouseoverHandler });

    // Both fire before cleanup
    el.click();
    el.dispatchEvent(new Event('mouseover'));
    expect(clickHandler).toHaveBeenCalledTimes(1);
    expect(mouseoverHandler).toHaveBeenCalledTimes(1);

    // A single cleanup call removes both listeners
    cleanup(el);

    el.click();
    el.dispatchEvent(new Event('mouseover'));
    expect(clickHandler).toHaveBeenCalledTimes(1);
    expect(mouseoverHandler).toHaveBeenCalledTimes(1);
  });

  it('shares AbortController with element.ts (same Symbol.for key)', () => {
    const el = document.createElement('button');
    const handler = vi.fn();

    applyDynamicProps(el, { onClick: handler });

    // Verify the ABORT_SYM property exists on the element
    const sym = Symbol.for('forma-abort');
    expect((el as any)[sym]).toBeInstanceOf(AbortController);

    // cleanup() from element.ts aborts the controller created by hydrate.ts
    cleanup(el);

    // Controller should be removed after cleanup
    expect((el as any)[sym]).toBeUndefined();

    // Listener should not fire
    el.click();
    expect(handler).not.toHaveBeenCalled();
  });

  it('cleanup is idempotent — calling twice does not throw', () => {
    const el = document.createElement('button');
    const handler = vi.fn();

    applyDynamicProps(el, { onClick: handler });

    cleanup(el);
    expect(() => cleanup(el)).not.toThrow();
  });

  it('element can receive new listeners after cleanup', () => {
    const el = document.createElement('button');
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    applyDynamicProps(el, { onClick: handler1 });
    el.click();
    expect(handler1).toHaveBeenCalledTimes(1);

    cleanup(el);

    // Attach new listener after cleanup
    applyDynamicProps(el, { onClick: handler2 });
    el.click();
    expect(handler1).toHaveBeenCalledTimes(1); // old handler still not called again
    expect(handler2).toHaveBeenCalledTimes(1); // new handler fires
  });
});
