import { describe, it, expect } from 'vitest';
import { h, Fragment } from '../element';

describe('Fragment', () => {
  it('is a symbol', () => {
    expect(typeof Fragment).toBe('symbol');
  });

  it('h(Fragment) returns DocumentFragment', () => {
    const frag = h(Fragment, null);
    expect(frag).toBeInstanceOf(DocumentFragment);
  });

  it('h(Fragment) contains children', () => {
    const frag = h(Fragment, null,
      h('span', null, 'one'),
      h('span', null, 'two'),
    );
    expect(frag.childNodes.length).toBe(2);
    expect((frag.firstChild as HTMLElement).textContent).toBe('one');
  });

  it('nested Fragments flatten', () => {
    const frag = h(Fragment, null,
      h(Fragment, null,
        h('span', null, 'inner'),
      ),
      h('span', null, 'outer'),
    );
    // DocumentFragment children get absorbed when appended
    const container = document.createElement('div');
    container.appendChild(frag);
    expect(container.children.length).toBe(2);
  });

  it('Fragment with reactive children updates', async () => {
    const { createSignal, createRoot } = await import('../../reactive');
    const [count, setCount] = createSignal(0);

    let frag: any;
    createRoot(() => {
      frag = h(Fragment, null, () => String(count()));
    });

    const container = document.createElement('div');
    container.appendChild(frag);
    expect(container.textContent).toBe('0');

    setCount(5);
    expect(container.textContent).toBe('5');
  });
});
