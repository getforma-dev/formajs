import { describe, it, expect, vi } from 'vitest';
import { defineComponent, disposeComponent, trackDisposer, onMount, onUnmount } from '../define';
import { createSignal } from '../../reactive/signal';
import { createEffect } from '../../reactive/effect';

describe('defineComponent', () => {
  it('accepts a setup function and returns a factory', () => {
    const factory = defineComponent(() => document.createElement('div'));
    expect(typeof factory).toBe('function');
  });

  it('factory produces a DOM element', () => {
    const factory = defineComponent(() => {
      const el = document.createElement('div');
      el.textContent = 'hello';
      return el;
    });
    const el = factory();
    expect(el).toBeInstanceOf(HTMLElement);
    expect((el as HTMLElement).textContent).toBe('hello');
  });

  it('accepts a definition object with name', () => {
    const factory = defineComponent({
      name: 'MyWidget',
      setup: () => document.createElement('span'),
    });
    const el = factory();
    expect(el).toBeInstanceOf(HTMLSpanElement);
  });

  it('setup function runs once per factory call', () => {
    const spy = vi.fn(() => document.createElement('div'));
    const factory = defineComponent(spy);

    factory();
    factory();
    factory();
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('each factory call creates an independent instance', () => {
    const factory = defineComponent(() => {
      const el = document.createElement('div');
      el.id = Math.random().toString(36);
      return el;
    });
    const a = factory() as HTMLElement;
    const b = factory() as HTMLElement;
    expect(a.id).not.toBe(b.id);
    expect(a).not.toBe(b);
  });

  it('can return DocumentFragment from setup', () => {
    const factory = defineComponent(() => {
      const frag = document.createDocumentFragment();
      frag.appendChild(document.createElement('p'));
      frag.appendChild(document.createElement('p'));
      return frag;
    });
    const result = factory();
    expect(result).toBeInstanceOf(DocumentFragment);
  });
});

describe('onMount', () => {
  it('throws when called outside a setup function', () => {
    expect(() => onMount(() => {})).toThrow('onMount() must be called inside a component setup function');
  });

  it('runs after setup completes', () => {
    const order: string[] = [];
    const factory = defineComponent(() => {
      order.push('setup-start');
      onMount(() => { order.push('mount'); });
      order.push('setup-end');
      return document.createElement('div');
    });
    factory();
    expect(order).toEqual(['setup-start', 'setup-end', 'mount']);
  });

  it('mount cleanup function runs on dispose', () => {
    const log: string[] = [];
    const factory = defineComponent(() => {
      onMount(() => {
        log.push('mounted');
        return () => { log.push('mount-cleanup'); };
      });
      return document.createElement('div');
    });
    const el = factory();
    expect(log).toEqual(['mounted']);

    disposeComponent(el);
    expect(log).toEqual(['mounted', 'mount-cleanup']);
  });

  it('multiple mount callbacks run in order', () => {
    const order: number[] = [];
    const factory = defineComponent(() => {
      onMount(() => { order.push(1); });
      onMount(() => { order.push(2); });
      onMount(() => { order.push(3); });
      return document.createElement('div');
    });
    factory();
    expect(order).toEqual([1, 2, 3]);
  });
});

describe('onUnmount', () => {
  it('throws when called outside a setup function', () => {
    expect(() => onUnmount(() => {})).toThrow('onUnmount() must be called inside a component setup function');
  });

  it('runs when component is disposed', () => {
    const spy = vi.fn();
    const factory = defineComponent(() => {
      onUnmount(spy);
      return document.createElement('div');
    });
    const el = factory();
    expect(spy).not.toHaveBeenCalled();

    disposeComponent(el);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('multiple unmount callbacks run on dispose', () => {
    const order: string[] = [];
    const factory = defineComponent(() => {
      onUnmount(() => order.push('a'));
      onUnmount(() => order.push('b'));
      onUnmount(() => order.push('c'));
      return document.createElement('div');
    });
    const el = factory();
    disposeComponent(el);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('errors in unmount callbacks do not prevent other callbacks from running', () => {
    const log: string[] = [];
    const factory = defineComponent(() => {
      onUnmount(() => log.push('first'));
      onUnmount(() => { throw new Error('boom'); });
      onUnmount(() => log.push('third'));
      return document.createElement('div');
    });
    const el = factory();
    disposeComponent(el);
    expect(log).toEqual(['first', 'third']);
  });
});

describe('disposeComponent', () => {
  it('is a no-op on elements without dispose', () => {
    const el = document.createElement('div');
    expect(() => disposeComponent(el)).not.toThrow();
  });

  it('calling dispose twice is safe (idempotent)', () => {
    const spy = vi.fn();
    const factory = defineComponent(() => {
      onUnmount(spy);
      return document.createElement('div');
    });
    const el = factory();
    disposeComponent(el);
    disposeComponent(el);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('clears internal state after dispose', () => {
    const disposerSpy = vi.fn();
    const factory = defineComponent(() => {
      trackDisposer(disposerSpy);
      return document.createElement('div');
    });
    const el = factory();
    disposeComponent(el);
    expect(disposerSpy).toHaveBeenCalledTimes(1);
    // Second dispose should be no-op (dispose key deleted)
    disposeComponent(el);
    expect(disposerSpy).toHaveBeenCalledTimes(1);
  });
});

describe('trackDisposer', () => {
  it('tracked disposers run on component dispose', () => {
    const spy = vi.fn();
    const factory = defineComponent(() => {
      trackDisposer(spy);
      return document.createElement('div');
    });
    const el = factory();
    disposeComponent(el);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('errors in disposers do not prevent other disposers from running', () => {
    const log: string[] = [];
    const factory = defineComponent(() => {
      trackDisposer(() => log.push('d1'));
      trackDisposer(() => { throw new Error('oops'); });
      trackDisposer(() => log.push('d3'));
      return document.createElement('div');
    });
    const el = factory();
    disposeComponent(el);
    expect(log).toEqual(['d1', 'd3']);
  });

  it('is a no-op when called outside component setup', () => {
    const spy = vi.fn();
    // Should not throw, just silently does nothing
    expect(() => trackDisposer(spy)).not.toThrow();
  });
});

describe('component with signals', () => {
  it('setup can create reactive signals', () => {
    const factory = defineComponent(() => {
      const [count, setCount] = createSignal(0);
      const el = document.createElement('div');
      el.textContent = String(count());
      return el;
    });
    const el = factory() as HTMLElement;
    expect(el.textContent).toBe('0');
  });

  it('lifecycle context does not leak between nested component factories', () => {
    const outerUnmount = vi.fn();
    const innerUnmount = vi.fn();

    const InnerComponent = defineComponent(() => {
      onUnmount(innerUnmount);
      return document.createElement('span');
    });

    const OuterComponent = defineComponent(() => {
      onUnmount(outerUnmount);
      const container = document.createElement('div');
      const innerEl = InnerComponent();
      container.appendChild(innerEl);
      return container;
    });

    const outerEl = OuterComponent();

    // Dispose outer — inner's onUnmount should NOT fire (separate lifecycle)
    disposeComponent(outerEl);
    expect(outerUnmount).toHaveBeenCalledTimes(1);
    expect(innerUnmount).not.toHaveBeenCalled();
  });
});
