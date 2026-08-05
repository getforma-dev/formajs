import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  mount,
  unmount,
  setUnsafeEval,
  setUnsafeEvalMode,
  getUnsafeEvalMode,
  isUnsafeEvalAllowed,
  setDiagnostics,
  getDiagnostics,
  clearDiagnostics,
} from '../runtime';

function waitForEffects(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('runtime unsafe-eval hardening', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    setUnsafeEvalMode('mutable');
    setUnsafeEval(false);
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    unmount(container);
    container.remove();
    setUnsafeEvalMode('mutable');
    setUnsafeEval(false);
  });

  it("setUnsafeEvalMode('mutable') does not enable the fallback", () => {
    // 'mutable' is the DEFAULT mode of every build, so it has to mean
    // "off, but you may turn it on" — never "on". Coming back to it from a
    // locked mode must not hand the page an eval it never asked for.
    setUnsafeEvalMode('locked-off');
    expect(isUnsafeEvalAllowed()).toBe(false);

    setUnsafeEvalMode('mutable');
    expect(getUnsafeEvalMode()).toBe('mutable');
    expect(isUnsafeEvalAllowed()).toBe(false);

    setUnsafeEvalMode('locked-on');
    expect(isUnsafeEvalAllowed()).toBe(true);
    setUnsafeEvalMode('mutable');
    expect(isUnsafeEvalAllowed()).toBe(false);
  });

  it('allows unsafe fallback in mutable mode when explicitly enabled', async () => {
    setUnsafeEvalMode('mutable');
    setUnsafeEval(true);

    container.innerHTML = `
      <div data-forma-state='{"count":0}'>
        <button id="btn" data-on:click="{count = Number('4')}">set</button>
        <p id="out" data-text="{count}"></p>
      </div>
    `;

    mount(container);
    await waitForEffects();

    (container.querySelector('#btn') as HTMLButtonElement).click();
    await waitForEffects();

    expect(getUnsafeEvalMode()).toBe('mutable');
    expect(container.querySelector('#out')?.textContent).toBe('4');
  });

  it('locks unsafe fallback off and ignores runtime toggles', async () => {
    setUnsafeEvalMode('locked-off');
    setUnsafeEval(true); // ignored by hardened mode

    container.innerHTML = `
      <div data-forma-state='{"count":0}'>
        <button id="btn" data-on:click="{count = Number('4')}">set</button>
        <p id="out" data-text="{count}"></p>
      </div>
    `;

    mount(container);
    await waitForEffects();

    (container.querySelector('#btn') as HTMLButtonElement).click();
    await waitForEffects();

    expect(getUnsafeEvalMode()).toBe('locked-off');
    expect(container.querySelector('#out')?.textContent).toBe('0');
  });

  // A blocked expression must not execute, and it must not take the rest of the
  // page down with it: every case below asserts the neutered handler AND that a
  // sibling directive on the same scope still binds. `data-text` rendering "0"
  // is the proof that mount() finished instead of aborting on the first throw.
  async function mountWithBlockedHandler(clickExpr: string): Promise<HTMLDivElement> {
    // Build container off-document to avoid MutationObserver auto-mount race
    const offscreen = document.createElement('div');
    offscreen.innerHTML = `
      <div data-forma-state='{"x":0}'>
        <button id="btn" data-on:click="${clickExpr}">hack</button>
        <p id="out" data-text="{x}"></p>
      </div>
    `;

    expect(() => {
      mount(offscreen);
    }).not.toThrow();
    await waitForEffects();

    expect(offscreen.querySelector('#out')?.textContent).toBe('0');
    (offscreen.querySelector('#btn') as HTMLButtonElement).click();
    await waitForEffects();

    return offscreen;
  }

  it('blocks constructor in new Function path', async () => {
    setUnsafeEvalMode('mutable');
    setUnsafeEval(true);

    const offscreen = await mountWithBlockedHandler("{x.constructor('alert(1)')()}");

    expect(offscreen.querySelector('#out')?.textContent).toBe('0');
    unmount(offscreen);
  });

  it('catches template literal bracket access bypass attempt', async () => {
    setUnsafeEvalMode('mutable');
    setUnsafeEval(true);

    const offscreen = await mountWithBlockedHandler("{x[\`constructor\`]('alert(1)')()}");

    expect(offscreen.querySelector('#out')?.textContent).toBe('0');
    unmount(offscreen);
  });

  it('catches comment injection bypass attempt', async () => {
    setUnsafeEvalMode('mutable');
    setUnsafeEval(true);

    const offscreen = await mountWithBlockedHandler("{x./**/constructor('alert(1)')()}");

    expect(offscreen.querySelector('#out')?.textContent).toBe('0');
    unmount(offscreen);
  });

  it('blocks .Function() access in handler', async () => {
    setUnsafeEvalMode('mutable');
    setUnsafeEval(true);

    const offscreen = await mountWithBlockedHandler("x.Function('return 1')()");

    expect(offscreen.querySelector('#out')?.textContent).toBe('0');
    unmount(offscreen);
  });

  it('blocks .__proto__ access in handler', async () => {
    setUnsafeEvalMode('mutable');
    setUnsafeEval(true);

    // `x` must be an OBJECT for this to mean anything: with the numeric `x` this
    // test used to declare, `x.__proto__` was Number.prototype, so the payload
    // succeeding would still have left `({}).polluted` undefined and the
    // assertion passed whether or not the blocklist ran.
    const offscreen = document.createElement('div');
    offscreen.innerHTML = `
      <div data-forma-state='{"x":{}}'>
        <button id="btn" data-on:click="{x.__proto__.polluted = true}">hack</button>
      </div>`;
    try {
      mount(offscreen);
      await waitForEffects();
      (offscreen.querySelector('#btn') as HTMLButtonElement).click();
      await waitForEffects();

      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      expect(Object.prototype).not.toHaveProperty('polluted');
    } finally {
      delete (Object.prototype as Record<string, unknown>).polluted;
      unmount(offscreen);
    }
  });
});

/**
 * The expression blocklist (`findBlockedMethod`), exercised through the runtime
 * rather than re-implemented beside it.
 *
 * This suite replaces src/__tests__/runtime-blocklist.test.ts, which pasted a
 * copy of the detection logic into the test file and asserted against the copy:
 * ten tests that passed with the real blocklist deleted. Each test below drives
 * a payload through `mount()` with the eval fallback switched on and reads a
 * binding, a diagnostic or `Object.prototype` — deleting either detection layer
 * fails them.
 */
describe('expression blocklist', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    setUnsafeEvalMode('mutable');
    setUnsafeEval(true); // the blocklist only guards the eval fallback
    setDiagnostics(true);
    clearDiagnostics();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    unmount(container);
    container.remove();
    setDiagnostics(false);
    clearDiagnostics();
    setUnsafeEval(false);
    setUnsafeEvalMode('mutable');
  });

  /** Click a handler and report what `data-text="{out}"` ended up showing. */
  async function runHandler(state: string, handler: string): Promise<string> {
    container.innerHTML = `
      <div data-forma-state='${state}'>
        <button id="btn" data-on:click="${handler}">go</button>
        <p id="out" data-text="{out}"></p>
      </div>`;
    mount(container);
    await waitForEffects();
    (container.querySelector('#btn') as HTMLButtonElement).click();
    await waitForEffects();
    return container.querySelector('#out')?.textContent ?? '';
  }

  function blockedReasons(): string[] {
    return getDiagnostics()
      .map((d) => d.reason)
      .filter((r) => r.startsWith('Blocked unsafe method'));
  }

  it('blocks a bracket name assembled by string concatenation', async () => {
    // Layer 1 sees no `.constructor` and no `['constructor']`; only the
    // fragment-joining layer catches this. Without it `new Function` compiles
    // the expression and `out` becomes "Object".
    expect(await runHandler('{"x":{},"out":0}', "{out = x['constr' + 'uctor'].name}")).toBe('0');
    expect(blockedReasons()).toContain('Blocked unsafe method "constructor" in handler');
  });

  it('blocks a name split across three fragments', async () => {
    expect(await runHandler('{"x":{},"out":0}', "{out = x['con' + 'struc' + 'tor'].name}")).toBe('0');
    expect(blockedReasons()).toContain('Blocked unsafe method "constructor" in handler');
  });

  it('blocks a concatenated __proto__ before it can reach Object.prototype', async () => {
    try {
      expect(await runHandler('{"x":{},"out":0}', "{x['__pro' + 'to__'].polluted = true}")).toBe('0');
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      expect(Object.prototype).not.toHaveProperty('polluted');
      expect(blockedReasons()).toContain('Blocked unsafe method "__proto__" in handler');
    } finally {
      delete (Object.prototype as Record<string, unknown>).polluted;
    }
  });

  it('blocks a concatenated name in a value expression, not just a handler', async () => {
    // buildEvaluator has its own copy of the guard; data-text goes through it.
    container.innerHTML = `
      <div data-forma-state='{"x":{}}'>
        <p id="out" data-text="{x['constr' + 'uctor'].name}"></p>
      </div>`;
    mount(container);
    await waitForEffects();

    const out = container.querySelector('#out')!;
    expect(out.textContent).toBe('');
    expect(out.getAttribute('data-forma-expr-error')).toBe('unsupported');
    expect(getDiagnostics().map((d) => d.reason)).toContain(
      'Blocked unsafe method "constructor" in expression',
    );
  });

  it('blocks a quoted bracket name in every quote style', async () => {
    for (const expr of [
      `{out = x['constructor'].name}`,
      `{out = x[&quot;constructor&quot;].name}`,
      '{out = x[`constructor`].name}',
    ]) {
      clearDiagnostics();
      expect(await runHandler('{"x":{},"out":0}', expr), expr).toBe('0');
      expect(blockedReasons(), expr).toContain('Blocked unsafe method "constructor" in handler');
      unmount(container);
    }
  });

  it('allows a bracket name concatenated from harmless fragments', async () => {
    // The mirror image: over-blocking is a bug too. This is the case that
    // proves the tests above are measuring the blocklist and not just the
    // eval fallback being off.
    expect(await runHandler('{"x":{"hello":"yes"},"out":""}', "{out = x['he' + 'llo']}")).toBe('yes');
    expect(blockedReasons()).toEqual([]);
  });

  it('does not flag an identifier that merely contains a blocked name', async () => {
    expect(
      await runHandler('{"constructorValue":5,"out":0}', '{out = [constructorValue, 1].filter(n => n > 1)[0]}'),
    ).toBe('5');
    expect(blockedReasons()).toEqual([]);
  });
});
