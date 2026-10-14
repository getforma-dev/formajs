/**
 * FORMA-025: the runtime's own conversions of a result to text are charged.
 *
 * FORMA-004 charged what an expression does. What the runtime then does with
 * the result happened outside the interpreter: `data-text` writes
 * `String(value)`, and `String()` of an array joins every element, so a list of
 * a thousand references to one 300,000-character string (cheap to build, 2,000
 * units) became 300 million characters. Each conversion is now charged with the
 * same cost model inside the binding's budget, before it runs, and refused
 * with `FORMA_E_BUDGET`; the DOM keeps what it had.
 *
 * "Before it runs" is observed: `String()` of an array and `JSON.stringify`
 * call `Array.prototype.join` and `JSON.stringify` on the live intrinsics, so
 * those are wrapped for the length of each test and must never see the hostile
 * value.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as runtime from '../runtime';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** 300,000 characters, and a thousand references to them: 300 million as text. */
const LONG = 'x'.repeat(300_000);
const BIG = Array.from({ length: 1000 }, () => LONG);

/**
 * A short, comparable view of a piece of text. Were a conversion to run, the
 * text would hold 300 million characters, and a failing `toBe` on it would
 * print them all.
 */
const view = (text: string | null | undefined): string =>
  text == null ? String(text) : text.length > 200 ? `${text.slice(0, 40)}… (${text.length} characters)` : text;

describe('the runtime charges its own conversions to text (FORMA-025)', () => {
  let container: HTMLDivElement;
  let joined: number;
  let stringified: number;

  beforeEach(async () => {
    await tick();
    runtime.clearDiagnostics();
    runtime.setDiagnostics(true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    joined = 0;
    stringified = 0;
    const join = Array.prototype.join;
    vi.spyOn(Array.prototype, 'join').mockImplementation(function (this: unknown[], ...a) {
      if (this === BIG || (this as unknown) === BIG[0]) joined++;
      return Reflect.apply(join, this, a);
    });
    const stringify = JSON.stringify;
    vi.spyOn(JSON, 'stringify').mockImplementation((...a: Parameters<typeof JSON.stringify>) => {
      if (a[0] === BIG || (a[0] as { name?: unknown })?.name === BIG) stringified++;
      return stringify(...a);
    });
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    runtime.unmount(container);
    container.remove();
    await tick();
    runtime.clearDiagnostics();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  const codes = (): string[] => runtime.getDiagnostics().map((d) => d.code ?? '');

  it('data-text of a value heavier than the budget is refused before it is converted', async () => {
    container.innerHTML = `<div data-forma-state='{"s": "ab"}'>
      <p id="heavy" data-text="{Array.from({length: 1000}).map(() => s)}">server</p>
      <p id="light" data-text="{Array.from({length: 3}).map(() => s.slice(0, 1000))}">server</p>
    </div>`;
    const root = container.firstElementChild!;
    runtime.mount(container);
    const before = Array(1000).fill('ab').join(',');
    expect(view(container.querySelector('#heavy')!.textContent)).toBe(view(before));
    // The same binding over the long string: built for 2,000 units, refused
    // for the 300 million characters String() would write.
    runtime.setScopeValue(root, 's', LONG);
    await tick();
    expect(view(container.querySelector('#heavy')!.textContent)).toBe(view(before));
    expect(container.querySelector('#heavy')!.getAttribute('data-forma-expr-error')).toBe('unsupported');
    expect(codes()).toEqual(['FORMA_E_BUDGET']);
    expect(joined, 'String() ran on the hostile list').toBe(0);
    // Two-sided: three slices of 1,000 characters convert as before.
    expect(view(container.querySelector('#light')!.textContent)).toBe(view(Array(3).fill(LONG.slice(0, 1000)).join(',')));
  });

  it('every other conversion of a result to text is refused before it runs', async () => {
    container.innerHTML = `<div data-forma-state='{"v": "init", "rows": [], "light": [{"name": "a"}, {"name": "b"}]}'>
      <p id="bind" data-bind:title="{v}"></p>
      <input id="model" data-model="{v}">
      <p id="persist" data-persist="{v}"></p>
      <ul id="names" data-list="{rows}"><li>{item.name}</li></ul>
      <ul id="whole" data-list="{rows}"><li>{item}</li></ul>
      <ul id="keyed" data-list="{rows}"><li data-key="{item.name}">row</li></ul>
      <ul id="ok" data-list="{light}"><li>{item.name}</li></ul>
    </div>`;
    const root = container.firstElementChild!;
    runtime.mount(container);
    expect(container.querySelector('#ok')!.textContent).toBe('ab');
    runtime.setScopeValue(root, 'v', BIG);
    // A thousand rows each placing (or keyed by) the long string.
    runtime.setScopeValue(root, 'rows', BIG.map((name) => ({ name })));
    // Each conversion weighs more than the whole budget, which no task could
    // hold, so all six are refused and reported at once, not retried (S2).
    expect(runtime.getDiagnostics().map((d) => [d.code, d.expr, d.count])).toEqual([
      ['FORMA_E_BUDGET', 'v', 3],
      ['FORMA_E_BUDGET', 'rows', 3],
    ]);
    for (let i = 0; i < 10; i++) await tick();
    // Each keeps what the last value it converted wrote.
    expect(view(container.querySelector('#bind')!.getAttribute('title'))).toBe('init');
    expect(view((container.querySelector('#model') as HTMLInputElement).value)).toBe('init');
    expect(view(localStorage.getItem('forma:v'))).toBe('"init"');
    for (const id of ['names', 'whole', 'keyed']) expect(container.querySelector(`#${id}`)!.children, id).toHaveLength(0);
    expect(joined, 'String() ran on the hostile list').toBe(0);
    expect(stringified, 'JSON.stringify ran on the hostile value').toBe(0);
    // Six directives refused, each reported: diagnostics count per expression.
    expect(runtime.getDiagnostics().map((d) => [d.code, d.expr, d.count])).toEqual([
      ['FORMA_E_BUDGET', 'v', 3],
      ['FORMA_E_BUDGET', 'rows', 3],
    ]);
    // Two-sided: the same directives convert an ordinary value.
    runtime.setScopeValue(root, 'v', ['a', 'b']);
    runtime.setScopeValue(root, 'rows', [{ name: 'p' }, { name: 'q' }]);
    await tick();
    expect(container.querySelector('#bind')!.getAttribute('title')).toBe('a,b');
    expect((container.querySelector('#model') as HTMLInputElement).value).toBe('a,b');
    expect(localStorage.getItem('forma:v')).toBe('["a","b"]');
    expect(container.querySelector('#names')!.textContent).toBe('pq');
    expect(container.querySelector('#whole')!.textContent).toBe('{"name":"p"}{"name":"q"}');
    expect(container.querySelector('#keyed')!.children).toHaveLength(2);
  });
});
