/**
 * The headline promise: the runtime you actually ship does not call
 * `new Function()` unless you ask it to.
 *
 * Every test here loads a FRESH copy of the runtime module and asserts the
 * state it comes up in — nothing calls setUnsafeEval() first, because a test
 * that flips the switch proves nothing about the default. The build variants
 * differ only in the `__FORMA_UNSAFE_EVAL_MODE__` value tsup defines, so each
 * one is reproduced here by setting that global before the import:
 *
 *   undefined    → source / vitest / any consumer importing src
 *   "mutable"    → dist/runtime.js, dist/runtime.cjs, formajs-runtime.global.js
 *   "locked-off" → dist/runtime-hardened.js, formajs-runtime-hardened.global.js
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type RuntimeModule = typeof import('../runtime');

const BUILD_MODES = [
  ['source / vitest (no define)', undefined],
  ['standard build (define "mutable")', 'mutable'],
  ['hardened build (define "locked-off")', 'locked-off'],
] as const;

// Expressions the CSP-safe parser refuses; only `new Function` can run them.
const EVAL_ONLY_EXPR = '{items.filter(i => i > 1).length}';
const EVAL_ONLY_HANDLER = '{count = [1,2,3].filter(n => n > 2)[0]}';

const loaded: RuntimeModule[] = [];

async function loadRuntime(buildMode?: string): Promise<RuntimeModule> {
  vi.resetModules();
  if (buildMode === undefined) {
    delete (globalThis as Record<string, unknown>).__FORMA_UNSAFE_EVAL_MODE__;
  } else {
    (globalThis as Record<string, unknown>).__FORMA_UNSAFE_EVAL_MODE__ = buildMode;
  }
  const mod = (await import('../runtime')) as RuntimeModule;
  loaded.push(mod);
  return mod;
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Run `fn` with the Function constructor throwing EvalError — exactly what a
 * `script-src` without 'unsafe-eval' does to `new Function()`. Synchronous so
 * the stub is never live across a task boundary.
 */
function withEvalBlockedByCsp<T>(fn: () => T): T {
  const realFunction = globalThis.Function;
  const blocked = function blockedFunction(): never {
    throw new EvalError("call to Function() blocked by Content-Security-Policy");
  };
  blocked.prototype = realFunction.prototype;
  (globalThis as { Function: FunctionConstructor }).Function =
    blocked as unknown as FunctionConstructor;
  try {
    return fn();
  } finally {
    (globalThis as { Function: FunctionConstructor }).Function = realFunction;
  }
}

/** A scope with one expression only `new Function` can evaluate, plus a plain sibling. */
function evalOnlyMarkup(): string {
  return `
    <div data-forma-state='{"items":[1,2,3],"label":"bound"}'>
      <p id="hard" data-text="${EVAL_ONLY_EXPR}"></p>
      <p id="easy" data-text="{label}"></p>
    </div>
  `;
}

describe('CSP-safe by default', () => {
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
    vi.restoreAllMocks();
  });

  it('every build ships with the new Function fallback disabled', async () => {
    for (const [label, buildMode] of BUILD_MODES) {
      const runtime = await loadRuntime(buildMode);
      expect(runtime.isUnsafeEvalAllowed(), label).toBe(false);
      expect(runtime.getUnsafeEvalMode(), label).toBe(buildMode === 'locked-off' ? 'locked-off' : 'mutable');
    }
  });

  it('is disabled by default in SSR/Node too (no window, no document)', async () => {
    // readRuntimeConfig() reads window/document; a Node import must still land
    // in the same state rather than skipping the config path into a different one.
    const realWindow = globalThis.window;
    const realDocument = globalThis.document;
    (globalThis as Record<string, unknown>).window = undefined;
    (globalThis as Record<string, unknown>).document = undefined;
    let runtime: RuntimeModule;
    try {
      vi.resetModules();
      (globalThis as Record<string, unknown>).__FORMA_UNSAFE_EVAL_MODE__ = 'mutable';
      runtime = (await import('../runtime')) as RuntimeModule;
    } finally {
      (globalThis as Record<string, unknown>).window = realWindow;
      (globalThis as Record<string, unknown>).document = realDocument;
    }
    expect(runtime.isUnsafeEvalAllowed()).toBe(false);
    expect(runtime.getUnsafeEvalMode()).toBe('mutable');
    // Not pushed to `loaded`: it never installed an observer (no document).
  });

  it('never reaches new Function for an unparseable expression by default', async () => {
    const runtime = await loadRuntime('mutable');
    container.innerHTML = evalOnlyMarkup();

    // If the default were "enabled", the stub below would be hit and this
    // would throw out of mount() instead of degrading.
    withEvalBlockedByCsp(() => runtime.mount(container));
    await tick();

    expect(container.querySelector('#hard')!.textContent).toBe('');
    expect(container.querySelector('#easy')!.textContent).toBe('bound');
    const reasons = runtime.getDiagnostics().map((d) => d.reason);
    expect(reasons.some((r) => /arrow function detected/.test(r))).toBe(true);
    expect(reasons.some((r) => /Content-Security-Policy/.test(r))).toBe(false);
  });

  it('never reaches new Function for an unparseable handler by default', async () => {
    const runtime = await loadRuntime('mutable');
    container.innerHTML = `
      <div data-forma-state='{"count":0}'>
        <button id="btn" data-on:click="${EVAL_ONLY_HANDLER}">go</button>
        <p id="out" data-text="{count}"></p>
      </div>
    `;

    withEvalBlockedByCsp(() => runtime.mount(container));
    await tick();
    (container.querySelector('#btn') as HTMLButtonElement).click();
    await tick();

    expect(container.querySelector('#out')!.textContent).toBe('0');
    expect(container.querySelector('#btn')!.getAttribute('data-forma-handler-error'))
      .toBe('unsupported');
    // The parser rejected it; the Function constructor was never reached, so
    // the diagnostic must be the parser's hint and not the CSP-blocked one.
    const reasons = runtime.getDiagnostics()
      .filter((d) => d.kind === 'handler-unsupported')
      .map((d) => d.reason);
    expect(reasons.some((r) => /arrow function detected/.test(r))).toBe(true);
    expect(reasons.some((r) => /Content-Security-Policy/.test(r))).toBe(false);
  });

  it('marks the element with data-forma-expr-error when an expression cannot be compiled', async () => {
    const runtime = await loadRuntime('mutable');
    container.innerHTML = evalOnlyMarkup();

    runtime.mount(container);
    await tick();

    expect(container.querySelector('#hard')!.getAttribute('data-forma-expr-error'))
      .toBe('unsupported');
    expect(container.querySelector('#easy')!.hasAttribute('data-forma-expr-error')).toBe(false);
  });

  it('compiles $event handlers without eval instead of assigning undefined', async () => {
    // The failure this replaces was silent: the CSP-safe parser recognised the
    // assignment, read the unknown identifier `$event` as undefined and stored
    // that — no diagnostic, no marker, just lost input.
    const runtime = await loadRuntime('mutable');
    container.innerHTML = `
      <div data-forma-state='{"q":"start"}'>
        <input id="in" data-on:input="{q = $event.target.value}">
        <p id="out" data-text="{q}"></p>
      </div>
    `;

    withEvalBlockedByCsp(() => runtime.mount(container));
    const input = container.querySelector('#in') as HTMLInputElement;
    input.value = 'typed';
    input.dispatchEvent(new Event('input'));
    await tick();

    expect(container.querySelector('#out')!.textContent).toBe('typed');
    expect(input.hasAttribute('data-forma-handler-error')).toBe(false);
    expect(runtime.getDiagnostics()).toHaveLength(0);
  });

  it('compiles if (event…) handlers without eval', async () => {
    const runtime = await loadRuntime('mutable');
    container.innerHTML = `
      <div data-forma-state='{"n":0}'>
        <input id="in" data-on:keydown="if (event.key === 'Enter') { n = 5 }">
        <p id="out" data-text="{n}"></p>
      </div>
    `;

    withEvalBlockedByCsp(() => runtime.mount(container));
    const input = container.querySelector('#in') as HTMLInputElement;

    input.dispatchEvent(Object.assign(new Event('keydown'), { key: 'a' }));
    await tick();
    expect(container.querySelector('#out')!.textContent).toBe('0');

    input.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Enter' }));
    await tick();
    expect(container.querySelector('#out')!.textContent).toBe('5');
    expect(runtime.getDiagnostics()).toHaveLength(0);
  });

  it('does not leak the Event between dispatches', async () => {
    const runtime = await loadRuntime('mutable');
    container.innerHTML = `
      <div data-forma-state='{"q":""}'>
        <input id="in" data-on:input="{q = $event.target.value}">
      </div>
    `;
    runtime.mount(container);
    const input = container.querySelector('#in') as HTMLInputElement;
    input.value = 'first';
    input.dispatchEvent(new Event('input'));
    await tick();

    const scope = (container.firstElementChild as unknown as { __formaScope: { getters: Record<string, () => unknown> } })
      .__formaScope;
    expect(scope.getters.q!()).toBe('first');
    // The compiled handler must not still be holding the Event afterwards.
    expect(scope.getters.$event).toBeUndefined();
  });

  it('opting in with setUnsafeEval(true) enables the fallback', async () => {
    const runtime = await loadRuntime('mutable');
    expect(runtime.isUnsafeEvalAllowed()).toBe(false);

    runtime.setUnsafeEval(true);
    expect(runtime.isUnsafeEvalAllowed()).toBe(true);

    container.innerHTML = evalOnlyMarkup();
    runtime.mount(container);
    await tick();

    expect(container.querySelector('#hard')!.textContent).toBe('2');
    expect(container.querySelector('#hard')!.hasAttribute('data-forma-expr-error')).toBe(false);
  });

  it('warns once when the unsafe fallback is switched on', async () => {
    const runtime = await loadRuntime('mutable');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    runtime.setUnsafeEval(true);
    runtime.setUnsafeEval(false);
    runtime.setUnsafeEval(true);

    const enableWarnings = warn.mock.calls
      .map((args) => String(args[0]))
      .filter((msg) => msg.includes('unsafe-eval fallback ENABLED'));
    expect(enableWarnings).toHaveLength(1);
    expect(enableWarnings[0]).toContain("'unsafe-eval'");
  });

  it('honours the data-forma-unsafe-eval script attribute when document.currentScript is null (ESM builds)', async () => {
    // document.currentScript is null while a module script runs, so the ESM
    // builds have to find their config script by attribute or the switch is
    // dead in exactly the builds most apps import.
    expect(document.currentScript).toBeNull();
    const script = document.createElement('script');
    script.setAttribute('data-forma-unsafe-eval', 'true');
    document.head.appendChild(script);
    try {
      const runtime = await loadRuntime('mutable');
      expect(runtime.isUnsafeEvalAllowed()).toBe(true);
      expect(runtime.getUnsafeEvalMode()).toBe('mutable');
    } finally {
      script.remove();
    }
  });

  it('a locked-off build cannot be talked into eval by any configuration', async () => {
    (window as unknown as Record<string, unknown>).__FORMA_RUNTIME_CONFIG = {
      allowUnsafeEval: true,
      unsafeEvalMode: 'locked-on',
    };
    const script = document.createElement('script');
    script.setAttribute('data-forma-unsafe-eval', 'true');
    document.head.appendChild(script);
    try {
      const runtime = await loadRuntime('locked-off');
      // Config asked for locked-on; __EVAL_CAPABLE__ is compiled out, so the
      // answer to "will this runtime call new Function" stays false.
      expect(runtime.isUnsafeEvalAllowed()).toBe(false);

      runtime.setUnsafeEval(true);
      expect(runtime.isUnsafeEvalAllowed()).toBe(false);

      container.innerHTML = evalOnlyMarkup();
      withEvalBlockedByCsp(() => runtime.mount(container));
      await tick();
      expect(container.querySelector('#hard')!.textContent).toBe('');
      expect(container.querySelector('#easy')!.textContent).toBe('bound');
    } finally {
      script.remove();
      delete (window as unknown as Record<string, unknown>).__FORMA_RUNTIME_CONFIG;
    }
  });

  it('reports a CSP diagnostic and stops using new Function when the page CSP blocks it', async () => {
    const runtime = await loadRuntime('mutable');
    runtime.setUnsafeEval(true);
    expect(runtime.isUnsafeEvalAllowed()).toBe(true);

    container.innerHTML = evalOnlyMarkup();
    withEvalBlockedByCsp(() => runtime.mount(container));
    await tick();

    // The expression is not evaluated — but it says so, in the diagnostic and
    // on the element, instead of silently rendering nothing.
    const reasons = runtime.getDiagnostics().map((d) => d.reason);
    expect(reasons.some((r) => /Content-Security-Policy blocks/.test(r))).toBe(true);
    expect(container.querySelector('#hard')!.getAttribute('data-forma-expr-error'))
      .toBe('unsupported');
    // …the rest of the scope still bound…
    expect(container.querySelector('#easy')!.textContent).toBe('bound');
    // …and the runtime stopped claiming a capability the environment denies.
    expect(runtime.isUnsafeEvalAllowed()).toBe(false);
  });
});
