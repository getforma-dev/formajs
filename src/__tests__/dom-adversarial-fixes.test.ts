// Defects found by adversarial verification of the 1.3.0 DOM work.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, setUnsafeEval, setUnsafeEvalMode, clearDiagnostics } from '../runtime';
import { activateIslands, deactivateIsland, deactivateAllIslands } from '../dom/activate';
import { h } from '../dom/element';

function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

describe('CSP parser left-associativity (HIGH)', () => {
  let c: HTMLDivElement;
  beforeEach(() => {
    setUnsafeEvalMode('locked-off');
    setUnsafeEval(false);
    clearDiagnostics();
    c = document.createElement('div');
    document.body.appendChild(c);
  });
  afterEach(() => { unmount(c); c.remove(); setUnsafeEvalMode('mutable'); });

  async function evalText(expr: string): Promise<string | null> {
    c.innerHTML = `<div data-forma-state='{}'><p id="o" data-text="{${expr}}"></p></div>`;
    mount(c);
    await tick();
    return c.querySelector('#o')!.textContent;
  }

  it('subtraction is left-associative: 10 - 3 - 2 = 5', async () => {
    expect(await evalText('10 - 3 - 2')).toBe('5');
  });
  it('modulo is left-associative: 12 % 5 % 3 = 2', async () => {
    expect(await evalText('12 % 5 % 3')).toBe('2');
  });
  it('division is left-associative: 20 / 2 / 5 = 2', async () => {
    expect(await evalText('20 / 2 / 5')).toBe('2');
  });
  it('precedence preserved: 2 + 3 * 4 = 14', async () => {
    expect(await evalText('2 + 3 * 4')).toBe('14');
  });
  it('string literal with operator still concatenates: a-b', async () => {
    expect(await evalText(`'a' + '-' + 'b'`)).toBe('a-b');
  });
});

describe('island teardown removes deferred work (HIGH)', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('deactivateIsland removes interaction listeners (no zombie hydration)', () => {
    document.body.innerHTML =
      '<div data-forma-island="0" data-forma-component="Inter" data-forma-hydrate="interaction"' +
      ' data-forma-status="pending"><span>x</span></div>';
    const hydrateFn = vi.fn(() => null);
    activateIslands({ Inter: hydrateFn });
    const el = document.querySelector('[data-forma-island]') as HTMLElement;
    deactivateIsland(el);
    el.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(hydrateFn).not.toHaveBeenCalled();
  });

  it('deactivateAllIslands disconnects a pending visible observer', () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    (globalThis as any).IntersectionObserver = vi.fn(function (this: any) {
      this.observe = observe; this.disconnect = disconnect; return this;
    });
    document.body.innerHTML =
      '<div data-forma-island="0" data-forma-component="Vis" data-forma-hydrate="visible"' +
      ' data-forma-status="pending"><span>x</span></div>';
    const hydrateFn = vi.fn(() => null);
    activateIslands({ Vis: hydrateFn });
    expect(observe).toHaveBeenCalledTimes(1);
    deactivateAllIslands(document);
    expect(disconnect).toHaveBeenCalledTimes(1);
    delete (globalThis as any).IntersectionObserver;
  });
});

describe('data-model member-path binding (MEDIUM)', () => {
  let c: HTMLDivElement;
  beforeEach(() => {
    setUnsafeEval(true);
    c = document.createElement('div');
    document.body.appendChild(c);
  });
  afterEach(() => { unmount(c); c.remove(); });

  it('reflects a nested {item.name} into an input inside a data-list row', async () => {
    c.innerHTML =
      `<div data-forma-state='{"rows": [{"name": "alice"}]}'>` +
      `<ul data-list="{rows}"><li data-key="{index}">` +
      `<input class="inp" data-model="{item.name}"></li></ul></div>`;
    mount(c);
    await tick();
    const input = c.querySelector('.inp') as HTMLInputElement;
    expect(input.value).toBe('alice');
  });
});

describe('h() dual-use tag defaults to HTML without svg context (MEDIUM)', () => {
  it('h(title) with no svg context is an HTML title element', () => {
    const el = h('title') as Element;
    expect(el.namespaceURI).toBe('http://www.w3.org/1999/xhtml');
  });
});
