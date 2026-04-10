import { describe, it, expect, vi } from 'vitest';
import { createShow } from '../show';
import { createSignal } from '../../reactive/signal';
import { createEffect } from '../../reactive/effect';
import { createRoot } from '../../reactive/root';

function mountFragment(frag: DocumentFragment): HTMLElement {
  const container = document.createElement('div');
  container.appendChild(frag);
  return container;
}

function getContent(container: HTMLElement): string {
  let text = '';
  for (const node of container.childNodes) {
    if (node.nodeType === 8) continue; // skip comments
    text += node.textContent ?? '';
  }
  return text;
}

describe('createShow', () => {
  it('renders thenFn when condition is true', () => {
    createRoot(() => {
      const [show] = createSignal(true);
      const frag = createShow(show, () => document.createTextNode('Visible'));
      const container = mountFragment(frag);
      expect(getContent(container)).toBe('Visible');
    });
  });

  it('renders nothing when condition is false (two-argument call)', () => {
    createRoot(() => {
      const [show] = createSignal(false);
      const frag = createShow(show, () => document.createTextNode('Visible'));
      const container = mountFragment(frag);
      expect(getContent(container)).toBe('');
    });
  });

  it('two-argument call does not crash', () => {
    createRoot(() => {
      const [show, setShow] = createSignal(true);
      const frag = createShow(show, () => document.createTextNode('Hello'));
      const container = mountFragment(frag);
      expect(getContent(container)).toBe('Hello');

      // Switch to false — should not crash
      expect(() => setShow(false)).not.toThrow();
      expect(getContent(container)).toBe('');

      // Switch back — should not crash
      expect(() => setShow(true)).not.toThrow();
      expect(getContent(container)).toBe('Hello');
    });
  });

  it('renders elseFn when condition is false', () => {
    createRoot(() => {
      const [show] = createSignal(false);
      const frag = createShow(
        show,
        () => document.createTextNode('Yes'),
        () => document.createTextNode('No'),
      );
      const container = mountFragment(frag);
      expect(getContent(container)).toBe('No');
    });
  });

  it('switches branches reactively', () => {
    createRoot(() => {
      const [show, setShow] = createSignal(true);
      const frag = createShow(
        show,
        () => document.createTextNode('On'),
        () => document.createTextNode('Off'),
      );
      const container = mountFragment(frag);
      expect(getContent(container)).toBe('On');

      setShow(false);
      expect(getContent(container)).toBe('Off');

      setShow(true);
      expect(getContent(container)).toBe('On');
    });
  });

  it('same value does not re-render', () => {
    let renderCount = 0;
    createRoot(() => {
      const [show, setShow] = createSignal(true);
      const frag = createShow(show, () => {
        renderCount++;
        return document.createTextNode('Hello');
      });
      mountFragment(frag);
      expect(renderCount).toBe(1);

      setShow(true); // same value
      expect(renderCount).toBe(1);
    });
  });

  it('__showDispose cleans up', () => {
    createRoot(() => {
      const [show] = createSignal(true);
      const frag = createShow(show, () => document.createTextNode('Hi'));
      mountFragment(frag);

      const dispose = (frag as any).__showDispose;
      expect(typeof dispose).toBe('function');
      expect(() => dispose()).not.toThrow();
    });
  });

  it('branch effects are disposed when parent root is disposed (no orphans)', () => {
    const spy = vi.fn();
    const [visible, setVisible] = createSignal(true);
    const [name, setName] = createSignal<string | null>('Alice');

    let disposeRoot!: () => void;

    createRoot((dispose) => {
      disposeRoot = dispose;
      const frag = createShow(visible, () => {
        const textNode = document.createTextNode('');
        createEffect(() => {
          spy();
          textNode.data = name() ?? '';
        });
        return textNode;
      });
      mountFragment(frag);
    });

    expect(spy).toHaveBeenCalledTimes(1);

    // Change signal — branch effect runs
    setName('Bob');
    expect(spy).toHaveBeenCalledTimes(2);

    // Dispose the root — branch effect should be stopped
    disposeRoot();

    // Signal change after disposal should NOT fire the branch effect
    setName(null);
    expect(spy).toHaveBeenCalledTimes(2); // not 3 — orphan is gone
  });

  it('nested createShow branch effects are disposed on outer swap (the gatewasm bug)', () => {
    const spy = vi.fn();
    const [outer, setOuter] = createSignal(true);
    const [name, setName] = createSignal<string | null>('Alice');

    createRoot(() => {
      const frag = createShow(
        outer,
        () => {
          // Inner createShow — its branch root must die when outer swaps
          const inner = createShow(
            () => name() !== null,
            () => {
              const textNode = document.createTextNode('');
              createEffect(() => {
                spy();
                textNode.data = name()!.toUpperCase();
              });
              return textNode;
            },
          );
          return inner;
        },
      );
      mountFragment(frag);
    });

    expect(spy).toHaveBeenCalledTimes(1);

    // Outer swaps to false — inner branch root should be disposed
    setOuter(false);

    // Setting name to null should NOT crash — the orphaned effect is gone
    expect(() => setName(null)).not.toThrow();
    expect(spy).toHaveBeenCalledTimes(1); // no re-run after disposal
  });
});
