/**
 * What the `with (__scope) { … }` + `Proxy` wrapper around the opt-in Function
 * constructor fallback actually does.
 *
 * SECURITY.md used to call this wrapper a sandbox. It is not one, and these
 * tests are the reason the wording changed: the proxy's `has` trap answers
 * `key in scope.getters`, so any identifier that is NOT declared state reports
 * `false` and `with()` falls straight through to the real global object. The
 * only thing the wrapper enforces is the `UNSAFE_METHOD_NAMES` blocklist.
 *
 * These tests deliberately opt IN (`setUnsafeEval(true)`); nothing here is
 * reachable in a default build, which is exactly why the fallback is opt-in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type RuntimeModule = typeof import('../runtime');

const loaded: RuntimeModule[] = [];

async function loadRuntime(): Promise<RuntimeModule> {
  vi.resetModules();
  (globalThis as Record<string, unknown>).__FORMA_UNSAFE_EVAL_MODE__ = 'mutable';
  const mod = (await import('../runtime')) as RuntimeModule;
  loaded.push(mod);
  return mod;
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('the with() + Proxy wrapper is a blocklist, not a sandbox', () => {
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
    delete (globalThis as Record<string, unknown>).formaProbeSecret;
    delete (globalThis as Record<string, unknown>).formaProbeSend;
    vi.restoreAllMocks();
  });

  it('reads a real global that was never declared as state', async () => {
    const runtime = await loadRuntime();
    runtime.setUnsafeEval(true);
    (globalThis as Record<string, unknown>).formaProbeSecret = 'from-the-real-global-scope';

    // An arrow function — the parser rejects it, so this expression can only be
    // evaluated by the Function constructor path. `formaProbeSecret` appears
    // nowhere in data-forma-state.
    container.innerHTML = `
      <div data-forma-state='{"nums":[1]}'>
        <p id="leak" data-text="{nums.map(n => formaProbeSecret)[0]}"></p>
      </div>
    `;
    runtime.mount(container);
    await tick();

    expect(container.querySelector('#leak')!.textContent).toBe('from-the-real-global-scope');
  });

  it('calls a real global function that was never declared as state', async () => {
    const runtime = await loadRuntime();
    runtime.setUnsafeEval(true);
    const send = vi.fn(() => 'sent');
    (globalThis as Record<string, unknown>).formaProbeSend = send;

    container.innerHTML = `
      <div data-forma-state='{"nums":[1],"token":"s3cret"}'>
        <p id="call" data-text="{nums.map(n => formaProbeSend(token))[0]}"></p>
      </div>
    `;
    runtime.mount(container);
    await tick();

    // This is the exfiltration shape the docs must not claim is prevented:
    // declared state handed to an undeclared global.
    expect(send).toHaveBeenCalledWith('s3cret');
    expect(container.querySelector('#call')!.textContent).toBe('sent');
  });

  it('still blocks the UNSAFE_METHOD_NAMES blocklist on the same path', async () => {
    const runtime = await loadRuntime();
    runtime.setUnsafeEval(true);

    container.innerHTML = `
      <div data-forma-state='{"nums":[1]}'>
        <p id="blocked" data-text="{nums.map(n => n.constructor)[0]}"></p>
      </div>
    `;
    runtime.mount(container);
    await tick();

    expect(container.querySelector('#blocked')!.textContent).toBe('');
    expect(container.querySelector('#blocked')!.getAttribute('data-forma-expr-error'))
      .toBe('unsupported');
    const reasons = runtime.getDiagnostics().map((d) => d.reason);
    expect(reasons.some((r) => /Blocked unsafe method "constructor"/.test(r))).toBe(true);
  });

  it('none of the above is reachable without opting in', async () => {
    const runtime = await loadRuntime();
    (globalThis as Record<string, unknown>).formaProbeSecret = 'from-the-real-global-scope';

    container.innerHTML = `
      <div data-forma-state='{"nums":[1]}'>
        <p id="leak" data-text="{nums.map(n => formaProbeSecret)[0]}"></p>
      </div>
    `;
    runtime.mount(container);
    await tick();

    expect(runtime.isUnsafeEvalAllowed()).toBe(false);
    expect(container.querySelector('#leak')!.textContent).toBe('');
    expect(container.querySelector('#leak')!.getAttribute('data-forma-expr-error'))
      .toBe('unsupported');
  });
});
