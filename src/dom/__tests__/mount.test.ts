import { describe, it, expect, vi } from 'vitest';
import { createSignal, createRoot } from 'forma/reactive';
import { mount } from '../mount';
import { h } from '../element';

// ---------------------------------------------------------------------------
// Task 10: mount() — hydrateIsland integration
// ---------------------------------------------------------------------------

describe('mount', () => {
  it('uses hydrateIsland when data-forma-ssr present', () => {
    // Build SSR container: <div data-forma-ssr><button>Click me</button></div>
    const container = document.createElement('div');
    container.setAttribute('data-forma-ssr', '');
    const ssrButton = document.createElement('button');
    ssrButton.textContent = 'Click me';
    container.appendChild(ssrButton);

    const handler = vi.fn();

    const unmount = mount(
      () => h('button', { onClick: handler }, 'Click me'),
      container,
    );

    // data-forma-ssr removed
    expect(container.hasAttribute('data-forma-ssr')).toBe(false);

    // SAME button reference preserved
    expect(container.children[0]).toBe(ssrButton);

    // Event handler attached to SSR button
    ssrButton.click();
    expect(handler).toHaveBeenCalledTimes(1);

    // Cleanup
    unmount();
  });

  it('still works normally without data-forma-ssr', () => {
    const container = document.createElement('div');

    const unmount = mount(
      () => h('p', { class: 'fresh' }, 'Hello'),
      container,
    );

    expect(container.children.length).toBe(1);
    expect(container.children[0]!.tagName).toBe('P');
    expect(container.children[0]!.getAttribute('class')).toBe('fresh');
    expect(container.children[0]!.textContent).toBe('Hello');

    unmount();
    expect(container.innerHTML).toBe('');
  });

  it('hydration with reactive text binding', () => {
    // Build SSR container: <div data-forma-ssr><span><!--f:t0-->initial</span></div>
    const container = document.createElement('div');
    container.setAttribute('data-forma-ssr', '');
    const span = document.createElement('span');
    span.appendChild(document.createComment('f:t0'));
    const textNode = document.createTextNode('initial');
    span.appendChild(textNode);
    container.appendChild(span);

    let setVal!: (v: string) => void;

    const unmount = mount(
      () => {
        const [val, s] = createSignal('initial');
        setVal = s;
        return h('span', null, val);
      },
      container,
    );

    // Initial text preserved
    expect(textNode.data).toBe('initial');

    // Reactive update
    setVal('updated');
    expect(textNode.data).toBe('updated');

    unmount();
  });
});
