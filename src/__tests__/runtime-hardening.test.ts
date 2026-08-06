/**
 * The security model, driven through `mount()` rather than through the
 * interpreter's own API.
 *
 * src/expr/__tests__/adversarial.test.ts attacks the engine directly. This file
 * attacks it the way a real page does — a `data-forma-state` attribute, a
 * `data-on:click` handler, a click — because the wiring between them is its own
 * surface: a payload that the interpreter denies but that the runtime evaluates
 * through some other path would be just as exploitable.
 *
 * The suite this replaces tested a BLOCKLIST: nine names checked by a string
 * scan over the source text, guarding a `new Function` fallback. Every case in
 * it was written as "does this particular spelling get caught", which is the
 * shape of a defence that can only ever enumerate what it has already seen —
 * and four bypasses were found against it by assembling the blocked name at
 * runtime. The engine is now an allowlist, so the cases below are written the
 * other way round: what does the page get, and is it only what it declared?
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mount,
  unmount,
  setDiagnostics,
  getDiagnostics,
  clearDiagnostics,
  getScopes,
} from '../runtime';

function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

describe('runtime expression hardening', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    setDiagnostics(true);
    clearDiagnostics();
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    unmount(container);
    container.remove();
    setDiagnostics(false);
    clearDiagnostics();
    vi.restoreAllMocks();
  });

  /** Click a handler and report what `data-text="{out}"` ended up showing. */
  async function runHandler(state: string, handler: string): Promise<string> {
    container.innerHTML = `
      <div data-forma-state='${state}'>
        <button id="btn" data-on:click="${handler}">go</button>
        <p id="out" data-text="{out}"></p>
      </div>`;
    mount(container);
    await tick();
    (container.querySelector('#btn') as HTMLButtonElement).click();
    await tick();
    return container.querySelector('#out')?.textContent ?? '';
  }

  function codes(): string[] {
    return getDiagnostics().map((d) => d.code);
  }

  it('a constructor reach is denied however the name is assembled', async () => {
    // These four were WORKING bypasses of the string-scan blocklist: it saw no
    // literal `constructor` in any of them. The key filter runs on the
    // evaluated key, so the spelling is irrelevant.
    for (const handler of [
      "{out = x['constructor'].name}",
      "{out = x['constr' + 'uctor'].name}",
      "{out = x['con' + 'struc' + 'tor'].name}",
      "{out = x['xconstructorx'.slice(1, 12)].name}",
      '{out = x[k].name}',
    ]) {
      clearDiagnostics();
      expect(await runHandler('{"x":{},"out":0,"k":"constructor"}', handler), handler).toBe('0');
      expect(codes(), handler).toContain('FORMA_E_KEY_DENIED');
      unmount(container);
    }
  });

  it('a prototype write never reaches Object.prototype', async () => {
    try {
      for (const handler of [
        '{x.__proto__.polluted = true}',
        "{x['__pro' + 'to__'].polluted = true}",
        '{x[k].polluted = true}',
      ]) {
        clearDiagnostics();
        expect(await runHandler('{"x":{},"out":0,"k":"__proto__"}', handler), handler).toBe('0');
        expect(({} as Record<string, unknown>).polluted, handler).toBeUndefined();
        expect(Object.prototype, handler).not.toHaveProperty('polluted');
        expect(codes(), handler).toContain('FORMA_E_KEY_DENIED');
        unmount(container);
      }
    } finally {
      delete (Object.prototype as Record<string, unknown>).polluted;
    }
  });

  it('a value expression is guarded on the same terms as a handler', async () => {
    // The two paths had separate copies of the old blocklist, and a fix applied
    // to one of them was a fix applied to one of them.
    container.innerHTML = `
      <div data-forma-state='{"x":{}}'>
        <p id="out" data-text="{x['constr' + 'uctor'].name}">kept</p>
      </div>`;
    mount(container);
    await tick();

    const out = container.querySelector('#out')!;
    expect(out.textContent).toBe('kept');
    expect(out.getAttribute('data-forma-expr-error')).toBe('unsupported');
    expect(codes()).toContain('FORMA_E_KEY_DENIED');
  });

  it('does not over-block a harmless key that merely resembles one', async () => {
    // The mirror image, and the case that proves the ones above measure the key
    // filter rather than an engine that refuses everything: over-blocking is a
    // bug too.
    expect(await runHandler('{"x":{"hello":"yes"},"out":""}', "{out = x['he' + 'llo']}")).toBe('yes');
    expect(getDiagnostics()).toEqual([]);
  });

  it('does not flag an identifier that merely contains a blocked name', async () => {
    expect(
      await runHandler(
        '{"constructorValue":5,"out":0}',
        '{out = [constructorValue, 1].filter(n => n > 1)[0]}',
      ),
    ).toBe('5');
    expect(getDiagnostics()).toEqual([]);
  });

  it('state cannot smuggle a prototype key in through data-forma-state', async () => {
    // JSON.parse materialises "__proto__" as a real own property, so the sweep
    // in parseState is not the no-op the same delete would be on an object
    // literal — and even if it were, the key is unreadable.
    container.innerHTML = `
      <div data-forma-state='{"__proto__":{"polluted":true},"safe":1}'>
        <p id="out" data-text="{safe}"></p>
      </div>`;
    try {
      mount(container);
      await tick();
      expect(container.querySelector('#out')!.textContent).toBe('1');
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      expect(Object.keys(getScopes()[0]!.values)).not.toContain('__proto__');
    } finally {
      delete (Object.prototype as Record<string, unknown>).polluted;
    }
  });

  it('a state value that is a function cannot be invoked from markup', async () => {
    // An app can put a function in state; it can never be called with
    // attacker-chosen arguments, because bare `f(x)` has no call form at all.
    container.innerHTML = `
      <div data-forma-state='{"out":0}'>
        <p id="out" data-text="{fn(1)}">kept</p>
      </div>`;
    mount(container);
    await tick();
    const scope = (container.firstElementChild as unknown as {
      __formaScope: { getters: Record<string, () => unknown> };
    }).__formaScope;
    let called = false;
    scope.getters.fn = () => () => { called = true; };

    // Re-mount so the expression compiles against the extended scope.
    unmount(container);
    clearDiagnostics();
    mount(container);
    await tick();

    expect(called).toBe(false);
    expect(container.querySelector('#out')!.textContent).toBe('kept');
  });

  it('a page-wide budget refuses a runaway expression instead of hanging', async () => {
    // T3. The language is total — no loops, no recursion — so this bounds cost,
    // not termination; a 400×400 nested callback is simply refused.
    const rows = JSON.stringify(Array.from({ length: 400 }, (_, i) => i));
    container.innerHTML = `
      <div data-forma-state='{"rows":${rows}}'>
        <p id="out" data-text="{rows.map(a => rows.map(b => b)).length}">kept</p>
      </div>`;
    mount(container);
    await tick();

    expect(container.querySelector('#out')!.textContent).toBe('kept');
    expect(codes()).toContain('FORMA_E_BUDGET');
  });
});
