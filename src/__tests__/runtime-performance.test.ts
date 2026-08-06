import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyContainmentHints, yieldToMain } from '../runtime';

describe('runtime performance utilities', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('applies containment defaults to opt-in containers', () => {
    container.innerHTML = `
      <section data-forma-contain>
        <p>Hello</p>
      </section>
    `;
    const section = container.querySelector('section') as HTMLElement;

    const count = applyContainmentHints(container);

    expect(count).toBe(1);
    // jsdom may not expose `contain` but should still set supported hints.
    expect(section.style.getPropertyValue('content-visibility')).toBe('auto');
    expect(section.style.getPropertyValue('contain-intrinsic-size')).toBe('auto 800px');
  });

  it('respects explicit off switches', () => {
    container.innerHTML = `
      <section
        data-forma-contain="off"
        data-forma-content-visibility="off"
        data-forma-contain-intrinsic-size="off">
      </section>
    `;
    const section = container.querySelector('section') as HTMLElement;

    const count = applyContainmentHints(container);

    expect(count).toBe(0);
    expect(section.style.getPropertyValue('content-visibility')).toBe('');
    expect(section.style.getPropertyValue('contain-intrinsic-size')).toBe('');
  });

  it('yields the task, so work queued before it runs first', async () => {
    // `await expect(yieldToMain()).resolves.toBeUndefined()` was the whole test.
    // That passes for any `async () => {}` — including one that never yields,
    // which is the entire point of the function. A yield is observable: a
    // macrotask already on the queue must run BEFORE the code after the await.
    const order: string[] = [];
    setTimeout(() => order.push('macrotask'), 0);
    Promise.resolve().then(() => order.push('microtask'));

    await yieldToMain();
    order.push('after-yield');

    expect(order).toEqual(['microtask', 'macrotask', 'after-yield']);
  });
});
