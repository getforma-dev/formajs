import { describe, it, expect, vi } from 'vitest';
import { createSwitch } from '../switch';
import { createSignal } from '../../reactive/signal';
import { createRoot } from '../../reactive/root';
import { createEffect } from '../../reactive/effect';

function mountFragment(frag: DocumentFragment): HTMLElement {
  const container = document.createElement('div');
  container.appendChild(frag);
  return container;
}

function getContent(container: HTMLElement): string {
  // Get text between comment markers
  let text = '';
  for (const node of container.childNodes) {
    if (node.nodeType === 8) continue; // skip comments
    text += node.textContent ?? '';
  }
  return text;
}

describe('createSwitch', () => {
  it('renders matching case', () => {
    createRoot(() => {
      const [tab] = createSignal('home');
      const frag = createSwitch(tab, [
        { match: 'home', render: () => document.createTextNode('Home page') },
        { match: 'about', render: () => document.createTextNode('About page') },
      ]);
      const container = mountFragment(frag);
      expect(getContent(container)).toBe('Home page');
    });
  });

  it('switches between cases reactively', () => {
    createRoot(() => {
      const [tab, setTab] = createSignal('home');
      const frag = createSwitch(tab, [
        { match: 'home', render: () => document.createTextNode('Home') },
        { match: 'about', render: () => document.createTextNode('About') },
        { match: 'contact', render: () => document.createTextNode('Contact') },
      ]);
      const container = mountFragment(frag);
      expect(getContent(container)).toBe('Home');

      setTab('about');
      expect(getContent(container)).toBe('About');

      setTab('contact');
      expect(getContent(container)).toBe('Contact');
    });
  });

  it('caches previously rendered branches', () => {
    let renderCount = 0;
    createRoot(() => {
      const [tab, setTab] = createSignal('a');
      const frag = createSwitch(tab, [
        { match: 'a', render: () => { renderCount++; return document.createTextNode('A'); } },
        { match: 'b', render: () => document.createTextNode('B') },
      ]);
      mountFragment(frag);
      expect(renderCount).toBe(1);

      setTab('b');
      setTab('a'); // switch back — should reuse cached node
      expect(renderCount).toBe(1); // still 1, not re-rendered
    });
  });

  it('renders fallback for unmatched value', () => {
    createRoot(() => {
      const [tab] = createSignal('unknown');
      const frag = createSwitch(
        tab,
        [{ match: 'home', render: () => document.createTextNode('Home') }],
        () => document.createTextNode('404'),
      );
      const container = mountFragment(frag);
      expect(getContent(container)).toBe('404');
    });
  });

  it('renders nothing for unmatched value without fallback', () => {
    createRoot(() => {
      const [tab] = createSignal('unknown');
      const frag = createSwitch(tab, [
        { match: 'home', render: () => document.createTextNode('Home') },
      ]);
      const container = mountFragment(frag);
      expect(getContent(container)).toBe('');
    });
  });

  it('same value does not re-render', () => {
    const spy = vi.fn(() => document.createTextNode('A'));
    createRoot(() => {
      const [tab, setTab] = createSignal('a');
      const frag = createSwitch(tab, [{ match: 'a', render: spy }]);
      mountFragment(frag);
      expect(spy).toHaveBeenCalledTimes(1);

      setTab('a'); // same value
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  it('inner reactivity survives branch switches', () => {
    createRoot(() => {
      const [tab, setTab] = createSignal<string>('a');
      const [count, setCount] = createSignal(0);
      let textNode: Text | null = null;

      const frag = createSwitch(tab, [
        {
          match: 'a',
          render: () => {
            textNode = document.createTextNode('');
            createEffect(() => { textNode!.data = `Count: ${count()}`; });
            return textNode;
          },
        },
        { match: 'b', render: () => document.createTextNode('B') },
      ]);
      const container = mountFragment(frag);
      expect(getContent(container)).toBe('Count: 0');

      // Switch away and back
      setTab('b');
      setCount(5);
      setTab('a');
      // Cached branch should still be reactive
      expect(textNode!.data).toBe('Count: 5');
    });
  });

  it('__switchDispose cleans up all cached branches', () => {
    createRoot(() => {
      const [tab, setTab] = createSignal('a');
      const frag = createSwitch(tab, [
        { match: 'a', render: () => document.createTextNode('A') },
        { match: 'b', render: () => document.createTextNode('B') },
      ]);
      mountFragment(frag);

      // Render both branches so both are cached
      setTab('b');
      setTab('a');

      const dispose = (frag as any).__switchDispose;
      expect(typeof dispose).toBe('function');
      expect(() => dispose()).not.toThrow();
    });
  });
});
