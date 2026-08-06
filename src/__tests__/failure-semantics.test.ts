/**
 * What happens when an expression cannot run.
 *
 * This is the file that exists because of how the CSP gap stayed invisible: a
 * flagship README example rendered "Found undefined results" and an empty list
 * on the default build, and nothing anywhere said so. The runtime had at least
 * four places where failure was indistinguishable from success-with-undefined —
 * a blocked expression that returned a truthy compiled function (so the caller
 * recorded a SUCCESSFUL parse), and three cached `() => undefined` closures.
 *
 * The rules, from the design doc (R1–R3):
 *
 *   R1 — `undefined` is a VALUE. It can never also mean "this failed". The
 *        binding path carries a private symbol for failure instead.
 *   R2 — a parse/validate failure is loud AT BIND TIME, in production too:
 *        console.error with the offending column, a `formajs:diagnostic` event,
 *        an entry in getDiagnostics() with a stable code, and a
 *        `data-forma-expr-error` attribute. Deduped per (expression, element).
 *   R3 — a RUNTIME denial is reported the same way, at the binding boundary,
 *        and is never swallowed.
 *
 * And in every case the binding writes NOTHING — the DOM keeps what it had —
 * and the rest of the page still binds.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as runtime from '../runtime';

function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

describe('failure semantics', () => {
  let container: HTMLDivElement;
  let errors: string[];

  beforeEach(() => {
    runtime.clearDiagnostics();
    runtime.setDiagnostics(true);
    errors = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => { errors.push(args.map(String).join(' ')); });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    runtime.unmount(container);
    container.remove();
    runtime.clearDiagnostics();
    vi.restoreAllMocks();
  });

  it('a denied expression leaves the previous text in place and never renders undefined', async () => {
    // Server-rendered content is the realistic case: the element already holds
    // the right answer, and a binding that cannot run must not replace it with
    // "" or with the string "undefined".
    container.innerHTML = `
      <div data-forma-state='{"items":[1,2,3]}'>
        <p id="ssr" data-text="{items.push(4)}">server rendered</p>
        <p id="ok" data-text="{items.length}">stale</p>
      </div>
    `;
    runtime.mount(container);
    await tick();

    const denied = container.querySelector('#ssr')!;
    expect(denied.textContent).toBe('server rendered');
    expect(denied.textContent).not.toContain('undefined');
    expect(denied.getAttribute('data-forma-expr-error')).toBe('unsupported');
    // The mutating call was refused, not merely unrendered.
    expect(runtime.getScopes()[0]!.values.items!.value).toEqual([1, 2, 3]);
  });

  it('a denied binding does not stop its siblings from binding', async () => {
    // A throw out of bindElement used to leave every later directive on the
    // page unprocessed — one bad attribute, a dead page.
    container.innerHTML = `
      <div data-forma-state='{"n":1,"flag":true}'>
        <p id="bad" data-text="{document.title}"></p>
        <p id="good" data-text="{n}"></p>
        <p id="shown" data-show="{flag}">visible</p>
        <button id="btn" data-on:click="{n++}">go</button>
      </div>
    `;
    runtime.mount(container);
    await tick();

    expect(container.querySelector('#good')!.textContent).toBe('1');
    expect((container.querySelector('#shown') as HTMLElement).style.display).not.toBe('none');
    (container.querySelector('#btn') as HTMLButtonElement).click();
    await tick();
    expect(container.querySelector('#good')!.textContent).toBe('2');
  });

  it('reports one diagnostic per distinct expression, however many elements share it', async () => {
    // A five-row list sharing one denied expression files ONE diagnostic with a
    // count of five, and dispatches ONE `formajs:diagnostic` event — a 1,000-row
    // list must not produce 1,000 console lines or 1,000 CustomEvents. Every
    // row is still MARKED, because the marker is per element.
    const seen: unknown[] = [];
    const onDiagnostic = (e: Event): void => { seen.push((e as CustomEvent).detail); };
    window.addEventListener('formajs:diagnostic', onDiagnostic);
    try {
      container.innerHTML = `
        <div data-forma-state='{"rows":[1,2,3,4,5]}'>
          <ul data-list="{rows}">
            <li data-text="{item.nope.deep()}"></li>
          </ul>
        </div>
      `;
      runtime.mount(container);
      await tick();

      const diagnostics = runtime.getDiagnostics();
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]!.count).toBe(5);
      expect(seen).toHaveLength(1);
      expect(container.querySelectorAll('li[data-forma-expr-error]')).toHaveLength(5);
    } finally {
      window.removeEventListener('formajs:diagnostic', onDiagnostic);
    }
  });

  it('a data-list row template is not bound against the parent scope', async () => {
    // `data-list` lifts its first child out with removeChild, but mountScope's
    // querySelectorAll snapshot still holds that node — so it used to be bound
    // in the PARENT scope, where `item` does not exist. Under the old parser
    // that read undefined in silence; under this one it filed a bogus
    // "item is not declared" diagnostic against a perfectly good page.
    container.innerHTML = `
      <div data-forma-state='{"rows":[{"label":"a"},{"label":"b"}]}'>
        <ul data-list="{rows}">
          <li data-text="{item.label}"></li>
        </ul>
      </div>
    `;
    runtime.mount(container);
    await tick();

    expect([...container.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['a', 'b']);
    expect(runtime.getDiagnostics()).toEqual([]);
  });

  it('a denial while evaluating marks the element, not just the console', async () => {
    // `{items[key]}` compiles clean — the key only turns hostile when the state
    // value arrives — so the denial happens inside the effect that bindElement
    // is still setting up. A trailing "was anything blocked?" check at the end
    // of bindElement knew only about COMPILE failures and cleared the marker
    // this path had just written.
    container.innerHTML = `
      <div data-forma-state='{"items":[1,2],"key":"constructor"}'>
        <p id="runtime" data-text="{items[key]}">kept</p>
        <p id="compile" data-text="{a + }">also kept</p>
      </div>
    `;
    runtime.mount(container);
    await tick();

    for (const id of ['#runtime', '#compile']) {
      expect(container.querySelector(id)!.getAttribute('data-forma-expr-error'), id)
        .toBe('unsupported');
    }
    expect(container.querySelector('#runtime')!.textContent).toBe('kept');
  });

  it("a second, working handler does not erase the first one's failure marker", async () => {
    // The marker used to be set-or-cleared once per `data-on:*` attribute, so
    // the last handler on the element decided what the element said about all
    // of them.
    container.innerHTML = `
      <div data-forma-state='{"n":0}'>
        <button id="btn" data-on:click="{n = i => i}" data-on:mouseover="{n++}">go</button>
      </div>
    `;
    runtime.mount(container);
    await tick();

    expect(container.querySelector('#btn')!.getAttribute('data-forma-handler-error'))
      .toBe('unsupported');
    // …and the working one still works.
    (container.querySelector('#btn') as HTMLButtonElement)
      .dispatchEvent(new Event('mouseover', { bubbles: true }));
    await tick();
    expect(runtime.getScopes()[0]!.values.n!.value).toBe(1);
  });

  it('the report names the cause, the column and the element', async () => {
    // "Something is unsupported" is not actionable. The console line has to
    // carry the code, the message, the 1-based column and the markup.
    container.innerHTML = `
      <div data-forma-state='{"a":1}'>
        <p id="p" data-text="{a + }"></p>
      </div>
    `;
    runtime.mount(container);
    await tick();

    const line = errors.find((e) => e.includes('a + '));
    expect(line, 'a console.error naming the expression').toBeDefined();
    expect(line).toContain('FORMA_E_SYNTAX');
    expect(line).toMatch(/at column \d+/);
    expect(line).toContain('data-text');

    const diagnostic = runtime.getDiagnostics()[0]!;
    expect(diagnostic.code).toBe('FORMA_E_SYNTAX');
    expect(diagnostic.kind).toBe('expression-unsupported');
    expect(diagnostic.expr).toBe('a +');
  });

  it('a denied handler marks its element and leaves state untouched', async () => {
    container.innerHTML = `
      <div data-forma-state='{"n":0}'>
        <button id="btn" data-on:click="{n = window.outerWidth}">go</button>
        <p id="out" data-text="{n}"></p>
      </div>
    `;
    runtime.mount(container);
    await tick();
    (container.querySelector('#btn') as HTMLButtonElement).click();
    await tick();

    expect(container.querySelector('#out')!.textContent).toBe('0');
    expect(container.querySelector('#btn')!.getAttribute('data-forma-handler-error')).toBe('unsupported');
    expect(runtime.getDiagnostics().map((d) => d.code)).toContain('FORMA_E_UNRESOLVED');
  });

  it('a handler denied at click time reports without breaking the listener', async () => {
    // The denial happens on dispatch, not at bind time — the binding boundary
    // has to catch it there too, or the error escapes into the host page's
    // event loop as an unhandled exception.
    container.innerHTML = `
      <div data-forma-state='{"obj":{"a":1},"k":"a","n":0}'>
        <button id="btn" data-on:click="{obj[k] = n; n++}">go</button>
        <button id="hostile" data-on:click="{obj[bad] = 1}">hostile</button>
      </div>
    `;
    runtime.mount(container);
    await tick();

    const good = container.querySelector('#btn') as HTMLButtonElement;
    const hostile = container.querySelector('#hostile') as HTMLButtonElement;
    expect(() => hostile.click()).not.toThrow();
    await tick();
    expect(hostile.getAttribute('data-forma-handler-error')).toBe('unsupported');

    good.click();
    await tick();
    expect(runtime.getScopes()[0]!.values.obj!.value).toEqual({ a: 0 });
  });

  it('a genuine runtime bug is not swallowed as an expression denial', async () => {
    // The counterweight to every catch above. `isExprError` is a Symbol brand,
    // so only errors this engine raised deliberately take the report-and-carry-
    // on path; anything else is a bug in FormaJS and is rethrown, reaching the
    // reactive layer's binding-error reporter with its real name and message
    // instead of being filed as "unsupported expression".
    const boom = new RangeError('a real bug');
    container.innerHTML = `
      <div data-forma-state='{"n":1,"m":0}'>
        <p id="p" data-text="{n + m}"></p>
      </div>
    `;
    runtime.mount(container);
    await tick();

    const root = container.firstElementChild!;
    const scope = (root as unknown as {
      __formaScope: { getters: Record<string, () => unknown> };
    }).__formaScope;
    const original = scope.getters.n!;
    scope.getters.n = () => { throw boom; };
    try {
      runtime.setScopeValue(root, 'm', 5);
      await tick();
    } finally {
      scope.getters.n = original;
    }

    // Surfaced as a binding error carrying the ORIGINAL error…
    expect(errors.some((e) => e.includes('RangeError') && e.includes('a real bug'))).toBe(true);
    // …and never filed as an expression diagnostic, which would have claimed
    // the author wrote something unsupported.
    expect(runtime.getDiagnostics()).toEqual([]);
    expect(container.querySelector('#p')!.hasAttribute('data-forma-expr-error')).toBe(false);
  });

  it('disabling diagnostics silences the ledger but never fakes a value', async () => {
    // `setDiagnostics(false)` is a logging switch, not a permission switch: the
    // denied binding still writes nothing and still marks its element.
    runtime.setDiagnostics(false);
    container.innerHTML = `
      <div data-forma-state='{"a":1}'>
        <p id="p" data-text="{a.constructor}">kept</p>
      </div>
    `;
    runtime.mount(container);
    await tick();

    expect(runtime.getDiagnostics()).toEqual([]);
    expect(container.querySelector('#p')!.textContent).toBe('kept');
    expect(container.querySelector('#p')!.getAttribute('data-forma-expr-error')).toBe('unsupported');
    runtime.setDiagnostics(true);
  });
});
