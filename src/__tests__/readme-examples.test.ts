/**
 * Executable proof for the README code samples that are NOT the flagship block
 * or the directive table.
 *
 * Those two have their own files, and for a stronger reason than tidiness: they
 * extract their markup FROM README.md at test time, so they cannot drift.
 *   - src/__tests__/readme-flagship.test.ts
 *   - src/__tests__/readme-directive-table.test.ts
 *
 * What is left here is the samples that are prose-adjacent snippets rather than
 * one addressable block: the intro counter, the documented grammar surface, and
 * the `createHistory` API example.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'forma/reactive';
import { createHistory } from 'forma/state';
import * as runtime from '../runtime';

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('README HTML Runtime snippets', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    runtime.clearDiagnostics();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    runtime.unmount(container);
    container.remove();
    runtime.clearDiagnostics();
    vi.unstubAllGlobals();
  });

  // The counter under "3. HTML Runtime (no build step)".
  it('the intro counter works without eval', async () => {
    container.innerHTML = `
      <div data-forma-state='{ "count": 0 }'>
        <p data-text="{count}"></p>
        <button data-on:click="{count++}">+1</button>
        <button data-on:click="{count = 0}">Reset</button>
      </div>
    `;
    runtime.mount(container);
    await tick();

    const out = container.querySelector('p') as HTMLParagraphElement;
    const [plus, reset] = [...container.querySelectorAll('button')] as HTMLButtonElement[];
    expect(out.textContent).toBe('0');
    plus!.click();
    plus!.click();
    await tick();
    expect(out.textContent).toBe('2');
    reset!.click();
    await tick();
    expect(out.textContent).toBe('0');
    expect(runtime.getDiagnostics()).toEqual([]);
  });

  it('accepts every value-expression form the grammar section lists', async () => {
    const cases: Array<[label: string, expr: string, expected: string]> = [
      ['identifier', '{name}', 'Ada'],
      ['dot chain', '{user.address.city}', 'Paris'],
      ['optional chain', '{user?.missing?.deep}', ''],
      ['string key', "{user['name']}", 'Ada'],
      ['array index', '{tags[0]}', 'red'],
      ['computed index', '{tags[idx + 1]}', 'blue'],
      ['chained computed', '{user.pets[0].name}', 'Ada Jr'],
      ['method call', '{name.trim()}', 'Ada'],
      ['method call with args', "{tags.join(', ')}", 'red, blue'],
      ['Math namespace', '{Math.round(price)}', '13'],
      ['JSON namespace', '{JSON.stringify(tags)}', '["red","blue"]'],
      ['Object namespace', '{Object.keys(user.address)}', 'city'],
      ['arrow callback', '{tags.filter(t => t.length > 3)}', 'blue'],
      ['arrow callback chained', '{tags.map(t => t.toUpperCase()).join(&quot;/&quot;)}', 'RED/BLUE'],
      ['typeof', '{typeof price}', 'number'],
      ['unary minus on a name', '{-price}', '-12.5'],
      ['negation', '{!ok}', 'false'],
      ['ternary', "{ok ? 'yes' : 'no'}", 'yes'],
      // A `:` and a `//` inside a branch used to kill the ternary regex, which
      // made the single most common data-bind:href idiom unusable.
      ['ternary with a URL literal', "{ok ? 'https://a/b' : 'https://c/d'}", 'https://a/b'],
      ['nested ternary', "{price > 10 ? (ok ? 'x' : 'y') : 'z'}", 'x'],
      ['nullish', "{missing ?? 'fallback'}", 'fallback'],
      ['logical and/or', "{ok && tags[1] || 'none'}", 'blue'],
      // `!` had the LOWEST precedence in the regex cascade, so this used to
      // evaluate as `!(ok || tags[0])` and silently render "false".
      ['negation against ||', "{!ok || tags[0]}", 'red'],
      ['comparison', '{price > 10}', 'true'],
      ['arithmetic precedence', '{1 + 2 * 3}', '7'],
      ['array literal', "{['a', 'b']}", 'a,b'],
      ['array literal with a method', "{['a', 'b'].join('-')}", 'a-b'],
      ['object literal', '{JSON.stringify({ id: idx })}', '{"id":0}'],
      ['template literal', '`${name} in ${user.address.city}`', 'Ada in Paris'],
    ];
    container.innerHTML = `
      <div data-forma-state='{
        "name": "Ada",
        "price": 12.5,
        "ok": true,
        "missing": null,
        "idx": 0,
        "tags": ["red", "blue"],
        "user": { "name": "Ada", "address": { "city": "Paris" }, "pets": [{ "name": "Ada Jr" }] }
      }'>
        ${cases.map(([, expr], i) => `<p id="c${i}" data-text="${expr}"></p>`).join('')}
      </div>
    `;
    runtime.mount(container);
    await tick();

    cases.forEach(([label, , expected], i) => {
      expect(container.querySelector(`#c${i}`)!.textContent, label).toBe(expected);
    });
    expect(container.querySelectorAll('[data-forma-expr-error]')).toHaveLength(0);
    expect(runtime.getDiagnostics()).toEqual([]);
  });

  it('accepts every handler-statement form the grammar section lists', async () => {
    container.innerHTML = `
      <div data-forma-state='{"n":0,"flag":false,"key":"","item":{"done":false}}'>
        <button id="post" data-on:click="{n++}">post</button>
        <button id="pre" data-on:click="{--n}">pre</button>
        <button id="assign" data-on:click="{n = 5}">assign</button>
        <button id="toggle" data-on:click="{flag = !flag}">toggle</button>
        <button id="compound" data-on:click="{n *= 3}">compound</button>
        <button id="seq" data-on:click="{n = 1; flag = true}">seq</button>
        <button id="member" data-on:click="{item.done = !item.done}">member</button>
        <button id="rebind" data-on:click="{item = { done: !item.done }}">rebind</button>
        <input id="cond" data-on:keydown="{if (event.key === 'Enter') { key = 'entered' } else { key = 'other' }}">
        <p id="n" data-text="{n}"></p>
        <p id="flag" data-text="{flag}"></p>
        <p id="key" data-text="{key}"></p>
        <p id="done" data-text="{item.done}"></p>
      </div>
    `;
    runtime.mount(container);
    await tick();

    const click = async (id: string): Promise<void> => {
      (container.querySelector(id) as HTMLButtonElement).click();
      await tick();
    };
    const n = (): string | null => container.querySelector('#n')!.textContent;

    await click('#post');
    expect(n()).toBe('1');
    await click('#pre');
    expect(n()).toBe('0');
    await click('#assign');
    expect(n()).toBe('5');
    await click('#compound');
    expect(n()).toBe('15');
    await click('#toggle');
    expect(container.querySelector('#flag')!.textContent).toBe('true');
    // A property-path write MUTATES IN PLACE. The signal still holds the same
    // object, so nothing that reads it re-runs — identical to what `data-model`
    // already does for a member path, and documented as such. The write really
    // did land; only the notification is absent.
    await click('#member');
    expect(runtime.getScopes()[0]!.values.item!.value).toEqual({ done: true });
    expect(container.querySelector('#done')!.textContent).toBe('false');

    // Reassigning the root key is the reactive form, and object literals make
    // it expressible in the grammar.
    await click('#rebind');
    expect(container.querySelector('#done')!.textContent).toBe('false');
    await click('#rebind');
    expect(container.querySelector('#done')!.textContent).toBe('true');

    await click('#seq');
    expect(n()).toBe('1');
    expect(container.querySelector('#flag')!.textContent).toBe('true');

    const cond = container.querySelector('#cond') as HTMLInputElement;
    cond.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    await tick();
    expect(container.querySelector('#key')!.textContent).toBe('other');
    cond.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await tick();
    expect(container.querySelector('#key')!.textContent).toBe('entered');

    expect(container.querySelectorAll('[data-forma-handler-error]')).toHaveLength(0);
    expect(runtime.getDiagnostics()).toEqual([]);
  });

  it('data-fetch loads into a state key and $refetch re-runs it, both without eval', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => ({
      json: async () => ({ title: `load-${++calls}` }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    container.innerHTML = `
      <div data-forma-state='{}'>
        <div data-fetch="GET /api/items → result" data-fetch-id="items"></div>
        <p id="out" data-text="{result.title}"></p>
        <button id="again" data-on:click="{$refetch('items')}">Reload</button>
      </div>
    `;
    runtime.mount(container);
    await tick();

    expect(fetchMock).toHaveBeenCalledWith('/api/items', { method: 'GET' });
    expect(container.querySelector('#out')!.textContent).toBe('load-1');

    (container.querySelector('#again') as HTMLButtonElement).click();
    await tick();

    expect(container.querySelector('#out')!.textContent).toBe('load-2');
    expect(container.querySelectorAll('[data-forma-handler-error]')).toHaveLength(0);
  });

  it('the forms the README says are permanently unsupported really are', async () => {
    // The "Permanently unsupported" list is a promise about the security model,
    // not a to-do. Each of these is a capability the design refuses on purpose,
    // and each must be REPORTED rather than silently doing nothing.
    const cases: Array<[label: string, expr: string]> = [
      ['arrow as a value', '{f = i => i}'],
      ['bare call on a state value', '{fn(1)}'],
      ['.call', '{Math.floor.call(null, 1.2)}'],
      ['new', '{new Date()}'],
      ['delete', '{delete user.name}'],
      ['instanceof', '{user instanceof Object}'],
      ['a global', '{document.title}'],
      ['spread', '{[...tags]}'],
      ['this', '{this.x}'],
      ['regex literal', '{/x/.test(name)}'],
    ];
    container.innerHTML = `
      <div data-forma-state='{"name":"Ada","tags":["a"],"user":{"name":"Ada"},"f":null,"fn":null}'>
        ${cases.map(([, expr], i) => `<p id="u${i}" data-text="${expr}">kept</p>`).join('')}
      </div>
    `;
    runtime.mount(container);
    await tick();

    cases.forEach(([label], i) => {
      const el = container.querySelector(`#u${i}`)!;
      expect(el.getAttribute('data-forma-expr-error'), label).toBe('unsupported');
      expect(el.textContent, label).toBe('kept');
    });
  });
});

// ---------------------------------------------------------------------------
// README.md "History (Undo / Redo)"
// ---------------------------------------------------------------------------
describe('README createHistory example', () => {
  it('runs exactly as documented', () => {
    const [text, setText] = createSignal('');
    const { undo, redo, canUndo, canRedo } = createHistory([text, setText]);

    setText('hello');
    setText('hello world');

    expect(canUndo()).toBe(true);
    expect(canRedo()).toBe(false);

    undo();
    expect(text()).toBe('hello');
    expect(canRedo()).toBe(true);

    redo();
    expect(text()).toBe('hello world');
  });

  it('rejects the shape the old README documented', () => {
    // The pre-fix snippet passed a plain object and destructured a tuple.
    // Both halves fail: the source argument must be a [get, set] pair, and the
    // return value is a HistoryControls object with no iterator.
    // @ts-expect-error — deliberately the wrong argument shape.
    expect(() => createHistory({ text: '' })).toThrow(TypeError);

    const [text, setText] = createSignal('');
    const controls = createHistory([text, setText]);
    expect(Array.isArray(controls)).toBe(false);
    expect((controls as unknown as Record<symbol, unknown>)[Symbol.iterator]).toBeUndefined();
  });
});
