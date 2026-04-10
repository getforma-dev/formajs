import { describe, it, expect, vi } from 'vitest';
import { createList } from '../list';
import { createSignal } from '../../reactive/signal';
import { createEffect } from '../../reactive/effect';
import { createRoot } from '../../reactive/root';

function mountFragment(frag: DocumentFragment): HTMLElement {
  const container = document.createElement('div');
  container.appendChild(frag);
  return container;
}

describe('createList disposal', () => {
  it('item effects are disposed when item is removed from list', () => {
    const spy = vi.fn();
    const [items, setItems] = createSignal([
      { id: 1, text: 'A' },
      { id: 2, text: 'B' },
    ]);
    const [tick, setTick] = createSignal(0);

    createRoot(() => {
      const frag = createList(
        items,
        (item) => item.id,
        (item) => {
          const el = document.createElement('div');
          createEffect(() => {
            tick(); // subscribe to tick
            spy(item.id);
          });
          el.textContent = item.text;
          return el;
        },
      );
      mountFragment(frag);
    });

    // Both items' effects ran once
    expect(spy).toHaveBeenCalledTimes(2);

    // Tick — both effects run again
    setTick(1);
    expect(spy).toHaveBeenCalledTimes(4);

    // Remove item 2
    setItems([{ id: 1, text: 'A' }]);

    // Tick — only item 1's effect should run (item 2 is disposed)
    spy.mockClear();
    setTick(2);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(1);
  });

  it('all item effects are disposed when parent root is disposed', () => {
    const spy = vi.fn();
    const [items] = createSignal([
      { id: 1, text: 'A' },
      { id: 2, text: 'B' },
    ]);
    const [tick, setTick] = createSignal(0);

    let disposeRoot!: () => void;

    createRoot((dispose) => {
      disposeRoot = dispose;
      const frag = createList(
        items,
        (item) => item.id,
        (item) => {
          const el = document.createElement('div');
          createEffect(() => {
            tick();
            spy(item.id);
          });
          el.textContent = item.text;
          return el;
        },
      );
      mountFragment(frag);
    });

    expect(spy).toHaveBeenCalledTimes(2);

    // Dispose root — all item effects should stop
    disposeRoot();
    spy.mockClear();

    setTick(1);
    expect(spy).toHaveBeenCalledTimes(0); // no orphaned effects
  });
});
