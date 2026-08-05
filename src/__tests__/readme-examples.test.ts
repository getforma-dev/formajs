/**
 * Executable proof for the code samples README.md ships.
 *
 * A documented example that nobody runs is a claim, not documentation. Every
 * markup block and snippet asserted here is copied verbatim from README.md, so
 * a change that breaks the sample breaks this file first.
 *
 * The HTML Runtime samples are mounted against the `locked-off` build variant —
 * the strictest one, where the Function-constructor fallback does not exist at
 * all — so passing here proves the sample needs no `unsafe-eval` in ANY build.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'forma/reactive';
import { createHistory } from 'forma/state';

type RuntimeModule = typeof import('../runtime');

const loaded: RuntimeModule[] = [];

/** Load a fresh runtime pinned to a build variant, exactly as tsup defines it. */
async function loadRuntime(buildMode: string): Promise<RuntimeModule> {
  vi.resetModules();
  (globalThis as Record<string, unknown>).__FORMA_UNSAFE_EVAL_MODE__ = buildMode;
  const mod = (await import('../runtime')) as RuntimeModule;
  loaded.push(mod);
  return mod;
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// README.md "Here's what you get from a single HTML file with one script tag"
// Keep byte-identical with the README block (minus the <script src> line).
// ---------------------------------------------------------------------------
const SHOWCASE_MARKUP = `
<div data-forma-state='{
  "name": "",
  "qty": 1,
  "price": 12.5,
  "toppings": ["Mushroom", "Olive", "Basil"],
  "darkMode": false
}'>

  <!-- Two-way binding: type in the input, every binding below updates -->
  <input data-model="{name}" placeholder="Your name">
  <p data-text="\`Order for \${name}\`"></p>

  <!-- Computed value: derived from state, recomputed automatically -->
  <p data-computed="total = qty * price"
     data-text="\`Total: $\${total}\`"></p>

  <!-- Event handling: increment, decrement, toggle -->
  <button data-on:click="{qty--}">-</button>
  <button data-on:click="{qty++}">+</button>

  <!-- Conditional rendering: show/hide based on state -->
  <p data-show="{qty >= 10}">Bulk discount applied.</p>

  <!-- List rendering: keyed reconciliation, only changed items re-render -->
  <ul data-list="{toppings}">
    <li>{item}</li>
  </ul>

  <!-- Dynamic classes and attributes -->
  <div data-class:dark="{darkMode}" data-bind:data-theme="{darkMode ? 'dark' : 'light'}">
    <button data-on:click="{darkMode = !darkMode}">Toggle theme</button>
    Theme is: <span data-text="{darkMode ? 'Dark' : 'Light'}"></span>
  </div>

  <!-- Persist to localStorage: survives page refresh -->
  <div data-persist="{darkMode}"></div>
</div>
`;

describe('README HTML Runtime showcase', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    for (const mod of loaded) {
      mod.unmount(container);
      mod.destroyRuntime();
    }
    loaded.length = 0;
    container.remove();
    delete (globalThis as Record<string, unknown>).__FORMA_UNSAFE_EVAL_MODE__;
    localStorage.clear();
  });

  it('runs on the hardened build with no unsupported expression or handler', async () => {
    const runtime = await loadRuntime('locked-off');
    container.innerHTML = SHOWCASE_MARKUP;
    runtime.mount(container);
    await tick();

    // A single unparseable expression or handler marks its element and files a
    // diagnostic. Zero of both is the whole claim.
    expect(container.querySelectorAll('[data-forma-expr-error]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-forma-handler-error]')).toHaveLength(0);
    expect(runtime.getDiagnostics()).toEqual([]);
  });

  it('renders every documented binding and updates them reactively', async () => {
    const runtime = await loadRuntime('locked-off');
    container.innerHTML = SHOWCASE_MARKUP;
    runtime.mount(container);
    await tick();

    const paragraphs = container.querySelectorAll('p');
    const greeting = paragraphs[0] as HTMLParagraphElement;
    const total = paragraphs[1] as HTMLParagraphElement;
    const bulk = paragraphs[2] as HTMLParagraphElement;
    const input = container.querySelector('input') as HTMLInputElement;
    const buttons = container.querySelectorAll('button');
    const dec = buttons[0] as HTMLButtonElement;
    const inc = buttons[1] as HTMLButtonElement;
    const toggle = buttons[2] as HTMLButtonElement;
    const themed = container.querySelector('[data-class\\:dark]') as HTMLElement;
    const themeLabel = themed.querySelector('span') as HTMLSpanElement;

    // Template literal + data-model two-way binding.
    expect(greeting.textContent).toBe('Order for ');
    input.value = 'Ada';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    expect(greeting.textContent).toBe('Order for Ada');

    // data-computed feeding a second data-text on the same element.
    expect(total.textContent).toBe('Total: $12.5');
    inc.click();
    await tick();
    expect(total.textContent).toBe('Total: $25');
    dec.click();
    await tick();
    expect(total.textContent).toBe('Total: $12.5');

    // data-show toggles display, not existence.
    expect(bulk.style.display).toBe('none');
    for (let i = 0; i < 9; i++) inc.click();
    await tick();
    expect(bulk.style.display).not.toBe('none');

    // data-list rendered one row per item, in order.
    const rows = [...container.querySelectorAll('li')].map((li) => li.textContent);
    expect(rows).toEqual(['Mushroom', 'Olive', 'Basil']);

    // data-class:* and data-bind:* both react to the same signal.
    expect(themed.classList.contains('dark')).toBe(false);
    expect(themed.getAttribute('data-theme')).toBe('light');
    expect(themeLabel.textContent).toBe('Light');
    toggle.click();
    await tick();
    expect(themed.classList.contains('dark')).toBe(true);
    expect(themed.getAttribute('data-theme')).toBe('dark');
    expect(themeLabel.textContent).toBe('Dark');
  });

  it('persists darkMode to localStorage as the comment claims', async () => {
    const runtime = await loadRuntime('locked-off');
    container.innerHTML = SHOWCASE_MARKUP;
    runtime.mount(container);
    await tick();

    (container.querySelectorAll('button')[2] as HTMLButtonElement).click();
    await tick();

    expect(localStorage.getItem('forma:darkMode')).toBe('true');
  });

  it('the arrow-function showcase this replaced does NOT run — why it was changed', async () => {
    // Verbatim from the README before this fix. `i => …` is not in the
    // CSP-safe grammar, so both bindings are dropped with a diagnostic and the
    // page renders wrong. This is the failure the replacement above avoids.
    const runtime = await loadRuntime('locked-off');
    container.innerHTML = `
      <div data-forma-state='{"query":"","items":["Apples","Bananas"]}'>
        <p id="count" data-computed="matchCount = items.filter(i => i.toLowerCase().includes(query.toLowerCase())).length"
           data-text="{'Found ' + matchCount + ' results'}"></p>
        <ul id="list" data-list="{items.filter(i => i.toLowerCase().includes(query.toLowerCase()))}">
          <li>{item}</li>
        </ul>
      </div>
    `;
    runtime.mount(container);
    await tick();

    expect(container.querySelectorAll('[data-forma-expr-error]').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('#list li')).toHaveLength(0);
    const reasons = runtime.getDiagnostics().map((d) => d.reason);
    expect(reasons.some((r) => /arrow function detected/.test(r))).toBe(true);
  });

  // The counter under "3. HTML Runtime (no build step)".
  it('the intro counter works without eval', async () => {
    const runtime = await loadRuntime('locked-off');
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
});

// ---------------------------------------------------------------------------
// README.md "Full directive reference" — the magic-variable rows. The plain
// directive rows are already covered by the showcase above; these three carry
// call syntax that the CSP-safe grammar has to accept for the row to be true.
// ---------------------------------------------------------------------------
describe('README directive reference — $el / $refs / $dispatch / $event', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    for (const mod of loaded) {
      mod.unmount(container);
      mod.destroyRuntime();
    }
    loaded.length = 0;
    container.remove();
    delete (globalThis as Record<string, unknown>).__FORMA_UNSAFE_EVAL_MODE__;
    vi.unstubAllGlobals();
  });

  it('$event resolves in a handler on every build', async () => {
    const runtime = await loadRuntime('locked-off');
    container.innerHTML = `
      <div data-forma-state='{"query":""}'>
        <input id="evt" data-on:input="{query = $event.target.value}">
        <p id="out" data-text="{query}"></p>
      </div>
    `;
    runtime.mount(container);
    await tick();

    const evt = container.querySelector('#evt') as HTMLInputElement;
    evt.value = 'typed';
    evt.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();

    expect(container.querySelector('#out')!.textContent).toBe('typed');
    expect(container.querySelectorAll('[data-forma-handler-error]')).toHaveLength(0);
    expect(runtime.getDiagnostics()).toEqual([]);
  });

  it('accepts every value-expression form the grammar section lists', async () => {
    const runtime = await loadRuntime('locked-off');
    const cases: Array<[label: string, expr: string, expected: string]> = [
      ['identifier', '{name}', 'Ada'],
      ['dot chain', '{user.address.city}', 'Paris'],
      ['optional chain', '{user?.missing?.deep}', ''],
      ['string key', "{user['name']}", 'Ada'],
      ['array index', '{tags[0]}', 'red'],
      ['method call', '{name.trim()}', 'Ada'],
      ['method call with args', "{tags.join(', ')}", 'red, blue'],
      ['Math namespace', '{Math.round(price)}', '13'],
      ['negation', '{!ok}', 'false'],
      ['ternary', "{ok ? 'yes' : 'no'}", 'yes'],
      ['nullish', "{missing ?? 'fallback'}", 'fallback'],
      ['logical and/or', "{ok && tags[1] || 'none'}", 'blue'],
      ['comparison', '{price > 10}', 'true'],
      ['arithmetic precedence', '{1 + 2 * 3}', '7'],
      // A bare array literal only — `['a','b'].join('-')` is NOT parseable:
      // the chain parser requires an identifier root, and the array-literal
      // branch requires the literal to be the whole expression.
      ['array literal', "{['a', 'b']}", 'a,b'],
      ['template literal', '`${name} in ${user.address.city}`', 'Ada in Paris'],
    ];
    container.innerHTML = `
      <div data-forma-state='{
        "name": "Ada",
        "price": 12.5,
        "ok": true,
        "tags": ["red", "blue"],
        "user": { "name": "Ada", "address": { "city": "Paris" } }
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
    const runtime = await loadRuntime('locked-off');
    container.innerHTML = `
      <div data-forma-state='{"n":0,"flag":false,"key":""}'>
        <button id="post" data-on:click="{n++}">post</button>
        <button id="pre" data-on:click="{--n}">pre</button>
        <button id="assign" data-on:click="{n = 5}">assign</button>
        <button id="toggle" data-on:click="{flag = !flag}">toggle</button>
        <button id="compound" data-on:click="{n *= 3}">compound</button>
        <button id="seq" data-on:click="{n = 1; flag = true}">seq</button>
        <input id="cond" data-on:keydown="{if (event.key === 'Enter') { key = 'entered' } else { key = 'other' }}">
        <p id="n" data-text="{n}"></p>
        <p id="flag" data-text="{flag}"></p>
        <p id="key" data-text="{key}"></p>
      </div>
    `;
    runtime.mount(container);
    await tick();

    const click = async (id: string) => {
      (container.querySelector(id) as HTMLButtonElement).click();
      await tick();
    };
    const n = () => container.querySelector('#n')!.textContent;

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
    const runtime = await loadRuntime('locked-off');
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

  it('a bare method-call statement is NOT in the CSP-safe grammar — the opt-in note is real', async () => {
    // `parseHandler` recognises assignments, ++/--, compound assignment,
    // `if (…) { … }`, `;`-separated sequences of those, and `$refetch('id')`.
    // A statement that is only a method call — which is the shape of every
    // documented `$el` / `$refs` / `$dispatch` example — has no branch, so it
    // falls through to the Function constructor. That is why the README marks
    // those three rows as needing the opt-in.
    const runtime = await loadRuntime('locked-off');
    container.innerHTML = `
      <div data-forma-state='{"id":7}'>
        <input data-ref="myInput">
        <button id="elBtn" data-on:click="{$el.classList.toggle('active')}">el</button>
        <button id="refBtn" data-on:click="{$refs.myInput.focus()}">ref</button>
        <button id="dispatchBtn" data-on:click="{$dispatch('selected', id)}">dispatch</button>
      </div>
    `;
    runtime.mount(container);
    await tick();

    for (const id of ['#elBtn', '#refBtn', '#dispatchBtn']) {
      expect(container.querySelector(id)!.getAttribute('data-forma-handler-error'), id)
        .toBe('unsupported');
    }
  });

  it('the same three examples do run once the fallback is opted in', async () => {
    const runtime = await loadRuntime('mutable');
    runtime.setUnsafeEval(true);
    container.innerHTML = `
      <div data-forma-state='{"id":7}'>
        <input data-ref="myInput">
        <button id="elBtn" data-on:click="{$el.classList.toggle('active')}">el</button>
        <button id="refBtn" data-on:click="{$refs.myInput.focus()}">ref</button>
        <button id="dispatchBtn" data-on:click="{$dispatch('selected', id)}">dispatch</button>
      </div>
    `;
    const seen: unknown[] = [];
    container.addEventListener('selected', (e) => seen.push((e as CustomEvent).detail));
    runtime.mount(container);
    await tick();

    (container.querySelector('#elBtn') as HTMLButtonElement).click();
    (container.querySelector('#refBtn') as HTMLButtonElement).click();
    (container.querySelector('#dispatchBtn') as HTMLButtonElement).click();
    await tick();

    expect(container.querySelector('#elBtn')!.classList.contains('active')).toBe(true);
    expect(document.activeElement).toBe(container.querySelector('[data-ref="myInput"]'));
    expect(seen).toEqual([7]);
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
