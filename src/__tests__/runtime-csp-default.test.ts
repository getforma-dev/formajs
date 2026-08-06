/**
 * The headline promise, at the runtime boundary: this library does not call
 * `new Function()`. Not "unless you opt in", not "in the hardened build" — at
 * all, in every build, with every configuration.
 *
 * The suite this replaces tested a three-valued build define
 * (`mutable` / `locked-off` / `locked-on`) and an exported `setUnsafeEval()`
 * switch. Both are gone: the `new Function` fallback was deleted from the
 * source when the allowlist AST interpreter became the only expression engine,
 * so there is no posture to configure and no switch to leave on. What is left
 * to prove is that nothing reaches the Function constructor anyway — which is
 * checked here by making the constructor itself fatal, exactly as a
 * `script-src` without `'unsafe-eval'` does.
 *
 * The artifact-level equivalents live in build-artifacts.test.ts (the emitted
 * bytes) and scripts/verify-dist.mjs (every published file).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as runtime from '../runtime';

function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

/**
 * Run `fn` with the Function constructor throwing EvalError — what a
 * `script-src` without 'unsafe-eval' does to `new Function()`. Synchronous, so
 * the stub is never live across a task boundary.
 */
function withEvalBlockedByCsp<T>(fn: () => T): T {
  const realFunction = globalThis.Function;
  const blocked = function blockedFunction(): never {
    throw new EvalError('call to Function() blocked by Content-Security-Policy');
  };
  blocked.prototype = realFunction.prototype;
  (globalThis as { Function: FunctionConstructor }).Function = blocked as unknown as FunctionConstructor;
  try {
    return fn();
  } finally {
    (globalThis as { Function: FunctionConstructor }).Function = realFunction;
  }
}

/** A scope mixing an expression the grammar accepts with one it refuses. */
const MIXED_MARKUP = `
  <div data-forma-state='{"items":[1,2,3],"label":"bound","q":""}'>
    <p id="hard" data-text="{items.push(4)}">untouched</p>
    <p id="easy" data-text="{items.filter(i => i > 1).length}"></p>
    <p id="plain" data-text="{label}"></p>
    <input id="in" data-on:input="{q = $event.target.value}">
    <p id="typed" data-text="{q}"></p>
  </div>
`;

describe('CSP-safe by construction', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    runtime.clearDiagnostics();
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    runtime.unmount(container);
    container.remove();
    runtime.clearDiagnostics();
    vi.restoreAllMocks();
  });

  it('no build can reach new Function, with any configuration', async () => {
    // There is no posture left to set. The module surface is asserted first,
    // because an exported switch is what a consumer would have to call to get
    // an eval path back, and there is none to call.
    for (const gone of ['setUnsafeEval', 'isUnsafeEvalAllowed', 'setUnsafeEvalMode', 'getUnsafeEvalMode']) {
      expect(Object.keys(runtime), `${gone} must not come back`).not.toContain(gone);
    }

    // The config object and the script attribute are read ONCE, at module
    // evaluation, so asking for eval has to be set up BEFORE the import or the
    // test proves nothing. Both channels are loaded together and ignored.
    (window as unknown as Record<string, unknown>).__FORMA_RUNTIME_CONFIG = {
      allowUnsafeEval: true,
      unsafeEvalMode: 'locked-on',
    };
    const script = document.createElement('script');
    script.setAttribute('data-forma-unsafe-eval', 'true');
    document.head.appendChild(script);
    const el = document.createElement('div');
    document.body.appendChild(el);
    try {
      vi.resetModules();
      const mod = await import('../runtime');
      expect(Object.keys(mod)).not.toContain('setUnsafeEval');
      withEvalBlockedByCsp(() => {
        el.innerHTML = MIXED_MARKUP;
        mod.mount(el);
      });
      // It bound the whole scope with the Function constructor fatal, and the
      // one expression outside the grammar is refused rather than evaluated.
      expect(el.querySelector('#plain')!.textContent).toBe('bound');
      expect(el.querySelector('#hard')!.getAttribute('data-forma-expr-error')).toBe('unsupported');
      mod.unmount(el);
      mod.clearDiagnostics();
    } finally {
      el.remove();
      script.remove();
      delete (window as unknown as Record<string, unknown>).__FORMA_RUNTIME_CONFIG;
      vi.resetModules();
    }
  });

  it('mounts, binds, filters and handles events with the Function constructor fatal', async () => {
    // The whole flagship shape — an arrow-function callback in a value
    // expression, a $event handler — under a Function constructor that throws.
    withEvalBlockedByCsp(() => {
      container.innerHTML = MIXED_MARKUP;
      runtime.mount(container);
    });
    await tick();

    expect(container.querySelector('#easy')!.textContent).toBe('2');
    expect(container.querySelector('#plain')!.textContent).toBe('bound');

    const input = container.querySelector('#in') as HTMLInputElement;
    input.value = 'typed';
    withEvalBlockedByCsp(() => input.dispatchEvent(new Event('input', { bubbles: true })));
    await tick();
    expect(container.querySelector('#typed')!.textContent).toBe('typed');
  });

  it('never constructs a function, not even one that would have succeeded', async () => {
    // Stronger than "does not throw under a blocked constructor": the
    // constructor is not INVOKED. A spy catches a build that quietly kept a
    // `new Function` on a path a blocked-constructor test happens not to hit.
    const realFunction = globalThis.Function;
    const calls: unknown[][] = [];
    const spy = function spied(...args: unknown[]): unknown {
      calls.push(args);
      return Reflect.construct(realFunction, args);
    };
    spy.prototype = realFunction.prototype;
    (globalThis as { Function: FunctionConstructor }).Function = spy as unknown as FunctionConstructor;
    try {
      container.innerHTML = MIXED_MARKUP;
      runtime.mount(container);
      await tick();
      (container.querySelector('#in') as HTMLInputElement)
        .dispatchEvent(new Event('input', { bubbles: true }));
      await tick();
    } finally {
      (globalThis as { Function: FunctionConstructor }).Function = realFunction;
    }
    expect(calls).toEqual([]);
  });

  it('marks the element with data-forma-expr-error when an expression cannot be compiled', async () => {
    container.innerHTML = MIXED_MARKUP;
    runtime.mount(container);
    await tick();

    expect(container.querySelector('#hard')!.getAttribute('data-forma-expr-error'))
      .toBe('unsupported');
    expect(container.querySelector('#easy')!.hasAttribute('data-forma-expr-error')).toBe(false);
    // The refused binding wrote nothing at all.
    expect(container.querySelector('#hard')!.textContent).toBe('untouched');
  });

  it('is importable with no window and no document (SSR/Node)', async () => {
    // readRuntimeConfig() reads window/document; a Node import must land in the
    // same state rather than skipping the config path into a different one.
    const realWindow = globalThis.window;
    const realDocument = globalThis.document;
    (globalThis as Record<string, unknown>).window = undefined;
    (globalThis as Record<string, unknown>).document = undefined;
    try {
      vi.resetModules();
      const mod = await import('../runtime');
      expect(typeof mod.mount).toBe('function');
      expect(Object.keys(mod)).not.toContain('setUnsafeEval');
    } finally {
      (globalThis as Record<string, unknown>).window = realWindow;
      (globalThis as Record<string, unknown>).document = realDocument;
      vi.resetModules();
    }
  });

  it('compiles $event handlers without eval instead of assigning undefined', async () => {
    // The failure this replaces was silent: the CSP-safe parser recognised the
    // assignment, read the unknown identifier `$event` as undefined and stored
    // that — no diagnostic, no marker, just lost input.
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

    const scope = (container.firstElementChild as unknown as {
      __formaScope: { getters: Record<string, () => unknown> };
    }).__formaScope;
    expect(scope.getters.q!()).toBe('first');
    // The compiled handler must not still be holding the Event afterwards.
    expect(scope.getters.$event).toBeUndefined();
  });

  it('honours a data-forma-* script attribute when document.currentScript is null (ESM builds)', async () => {
    // document.currentScript is null by spec while a `<script type="module">`
    // runs, so the ESM builds have to find their config script by attribute or
    // every `data-forma-*` switch is dead in exactly the builds most apps
    // import. `data-forma-expr-budget` is the switch used here because it is
    // observable: a budget of 1 refuses everything.
    expect(document.currentScript).toBeNull();
    const script = document.createElement('script');
    script.setAttribute('data-forma-expr-budget', '1');
    document.head.appendChild(script);
    try {
      vi.resetModules();
      const mod = await import('../runtime');
      const el = document.createElement('div');
      document.body.appendChild(el);
      try {
        el.innerHTML = `<div data-forma-state='{"a":1,"b":2}'><p id="p" data-text="{a + b}">kept</p></div>`;
        mod.mount(el);
        await tick();
        expect(el.querySelector('#p')!.textContent).toBe('kept');
        expect(mod.getDiagnostics().map((d) => d.code)).toContain('FORMA_E_BUDGET');
      } finally {
        mod.unmount(el);
        mod.clearDiagnostics();
        el.remove();
      }
    } finally {
      script.remove();
      vi.resetModules();
    }
  });
});
