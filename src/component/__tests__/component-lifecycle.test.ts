import { describe, it, expect, vi, afterEach } from 'vitest';
import { defineComponent, disposeComponent, onUnmount } from '../define';
import { createContext, provide, inject, unprovide } from '../context';
import { onError } from '../../reactive/dev';

describe('fragment component dispose reachability (C1)', () => {
  it('disposeComponent runs onUnmount when reached via a child after the fragment is appended', () => {
    const spy = vi.fn();
    const factory = defineComponent(() => {
      onUnmount(spy);
      const frag = document.createDocumentFragment();
      const a = document.createElement('p');
      const b = document.createElement('p');
      frag.appendChild(a);
      frag.appendChild(b);
      return frag;
    });
    const frag = factory() as DocumentFragment;
    const first = frag.firstChild as HTMLElement;
    const parent = document.createElement('div');
    parent.append(frag);
    expect(frag.childNodes.length).toBe(0);
    expect(spy).not.toHaveBeenCalled();
    // The only reachable handle now is a child that moved into parent.
    disposeComponent(parent.firstChild as HTMLElement);
    expect(spy).toHaveBeenCalledTimes(1);
    // sanity: `first` is the same node that moved
    expect(parent.firstChild).toBe(first);
  });

  it('is idempotent across multiple stamped children', () => {
    const spy = vi.fn();
    const factory = defineComponent(() => {
      onUnmount(spy);
      const frag = document.createDocumentFragment();
      frag.appendChild(document.createElement('span'));
      frag.appendChild(document.createElement('span'));
      return frag;
    });
    const frag = factory() as DocumentFragment;
    const parent = document.createElement('div');
    parent.append(frag);
    disposeComponent(parent.childNodes[0] as HTMLElement);
    disposeComponent(parent.childNodes[1] as HTMLElement);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('context lifecycle integration (C3)', () => {
  afterEach(() => { onError(() => {}); });

  it('provide() inside a component setup is auto-unprovided on dispose', () => {
    const Ctx = createContext('default');
    const factory = defineComponent(() => {
      provide(Ctx, 'scoped');
      return document.createElement('div');
    });
    const el = factory();
    // While mounted, the provided value is visible.
    expect(inject(Ctx)).toBe('scoped');
    disposeComponent(el);
    // After dispose, the value is popped and inject returns the default.
    expect(inject(Ctx)).toBe('default');
  });

  it('inject after dispose returns the default (no global leak)', () => {
    const Ctx = createContext('base');
    const factory = defineComponent(() => {
      provide(Ctx, 'leak?');
      return document.createElement('div');
    });
    const el = factory();
    disposeComponent(el);
    expect(inject(Ctx)).toBe('base');
  });

  it('nested provides in one component pop in reverse order on dispose', () => {
    const Ctx = createContext('d');
    const factory = defineComponent(() => {
      provide(Ctx, 'a');
      provide(Ctx, 'b');
      return document.createElement('div');
    });
    const el = factory();
    expect(inject(Ctx)).toBe('b');
    disposeComponent(el);
    expect(inject(Ctx)).toBe('d');
  });

  it('manual provide/unprovide outside a component is unaffected (no auto-pop)', () => {
    const Ctx = createContext('x');
    provide(Ctx, 'y');
    expect(inject(Ctx)).toBe('y');
    // No component lifecycle active: nothing auto-pops, manual unprovide still required.
    unprovide(Ctx);
    expect(inject(Ctx)).toBe('x');
  });
});