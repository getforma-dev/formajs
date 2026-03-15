import { describe, it, expect, afterEach } from 'vitest';
import { h } from '../element';
import { mount } from '../mount';
import { createList } from '../list';
import { setHydrating } from '../hydrate';
import { createSignal, createRoot } from 'forma/reactive';

// ---------------------------------------------------------------------------
// S3: Function component support in h()
// ---------------------------------------------------------------------------

describe('h() — function components', () => {
  it('calls the function with merged props including children', () => {
    const Greeting = (props: Record<string, unknown>) => {
      return h('span', null, `Hello ${props.name}`);
    };

    const el = h(Greeting, { name: 'World' }, 'child1', 'child2') as HTMLElement;
    expect(el).toBeInstanceOf(HTMLSpanElement);
    expect(el.textContent).toBe('Hello World');
  });

  it('passes children array in props when called with null props', () => {
    let receivedProps: Record<string, unknown> | null = null;
    const Spy = (props: Record<string, unknown>) => {
      receivedProps = props;
      return h('div', null, 'spy');
    };

    h(Spy, null, 'child1', 'child2');

    expect(receivedProps).not.toBeNull();
    expect(receivedProps!.children).toEqual(['child1', 'child2']);
  });

  it('function receives {count: 5, children: []} when no children passed', () => {
    let receivedProps: Record<string, unknown> | null = null;
    const Counter = (props: Record<string, unknown>) => {
      receivedProps = props;
      return h('span', null, String(props.count));
    };

    const el = h(Counter, { count: 5 }) as HTMLElement;

    expect(receivedProps).not.toBeNull();
    expect(receivedProps!.count).toBe(5);
    expect(receivedProps!.children).toEqual([]);
    expect(el.textContent).toBe('5');
  });

  it('function component returning h("div") works inside mount()', () => {
    const container = document.createElement('div');

    const App = (props: Record<string, unknown>) => {
      return h('div', { class: 'app' }, 'mounted');
    };

    const unmount = mount(() => h(App, null) as HTMLElement, container);

    expect(container.children.length).toBe(1);
    expect(container.children[0]!.tagName).toBe('DIV');
    expect(container.children[0]!.getAttribute('class')).toBe('app');
    expect(container.children[0]!.textContent).toBe('mounted');

    unmount();
  });

  it('function component works inside createList render callback', () => {
    const Item = (props: Record<string, unknown>) => {
      return h('li', null, String(props.label));
    };

    const container = document.createElement('div');
    let frag: DocumentFragment | undefined;

    createRoot(() => {
      const [items] = createSignal([
        { id: 1, label: 'A' },
        { id: 2, label: 'B' },
        { id: 3, label: 'C' },
      ]);

      frag = createList(
        items,
        (item: { id: number; label: string }) => item.id,
        (item: { id: number; label: string }) => h(Item, { label: item.label }) as HTMLElement,
      );
    });

    container.appendChild(frag!);

    // The fragment should have comment markers + 3 list items
    const lis = container.querySelectorAll('li');
    expect(lis.length).toBe(3);
    expect(lis[0]!.textContent).toBe('A');
    expect(lis[1]!.textContent).toBe('B');
    expect(lis[2]!.textContent).toBe('C');
  });

  it('does NOT generate hydration descriptors — returns real DOM even during hydration mode', () => {
    let wasCalled = false;
    let receivedProps: Record<string, unknown> | null = null;

    const MyComponent = (props: Record<string, unknown>) => {
      wasCalled = true;
      receivedProps = props;
      return h('div', { class: 'real' }, 'real content');
    };

    // Enable hydration mode
    setHydrating(true);

    try {
      const result = h(MyComponent, { value: 42 });

      // The function component is CALLED immediately (not deferred as a descriptor).
      // This is the critical distinction: string-tag h('div') produces a descriptor
      // during hydration, but h(MyComponent) always invokes the function.
      expect(wasCalled).toBe(true);
      expect(receivedProps).not.toBeNull();
      expect(receivedProps!.value).toBe(42);

      // The result is whatever the function returned. Since the inner h('div')
      // runs during hydration mode, it returns a descriptor object (cast as HTMLElement).
      // The important thing is that the function component path itself does NOT
      // create its own descriptor — it delegates to the function.
      expect(result).toBeDefined();
      expect((result as any).type).toBe('element');
      expect((result as any).tag).toBe('div');
    } finally {
      setHydrating(false);
    }

    // Verify hydrating is properly restored — outside hydration, real DOM is produced
    wasCalled = false;
    const normalResult = h(MyComponent, null) as HTMLElement;
    expect(wasCalled).toBe(true);
    expect(normalResult).toBeInstanceOf(HTMLDivElement);
    expect(normalResult.textContent).toBe('real content');
  });

  it('nested function components work: h(Outer) where Outer returns h(Inner)', () => {
    const Inner = (props: Record<string, unknown>) => {
      return h('span', { class: 'inner' }, String(props.text ?? 'default'));
    };

    const Outer = (props: Record<string, unknown>) => {
      return h('div', { class: 'outer' },
        h(Inner, { text: 'nested' }),
      );
    };

    const el = h(Outer, null) as HTMLElement;

    expect(el).toBeInstanceOf(HTMLDivElement);
    expect(el.getAttribute('class')).toBe('outer');
    expect(el.children.length).toBe(1);

    const innerEl = el.children[0] as HTMLElement;
    expect(innerEl.tagName).toBe('SPAN');
    expect(innerEl.getAttribute('class')).toBe('inner');
    expect(innerEl.textContent).toBe('nested');
  });
});
