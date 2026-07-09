// CSP parser (1.3.0): operators inside string literals must not be mis-split.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mount, unmount, setUnsafeEval, setUnsafeEvalMode, clearDiagnostics } from '../runtime';

function waitForEffects(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('CSP parser: operators inside string literals (1.3.0)', () => {
  let container: HTMLDivElement;
  beforeEach(() => {
    setUnsafeEvalMode('locked-off'); // no new Function fallback — parser must handle it
    setUnsafeEval(false);
    clearDiagnostics();
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    unmount(container);
    container.remove();
    setUnsafeEvalMode('mutable');
    setUnsafeEval(false);
  });

  it("'a' + '-' + 'b' evaluates to a-b (dash inside literal is not an operator)", async () => {
    container.innerHTML = `<div data-forma-state='{}'><p id="out" data-text="{'a' + '-' + 'b'}"></p></div>`;
    mount(container);
    await waitForEffects();
    expect(container.querySelector('#out')!.textContent).toBe('a-b');
  });

  it("'Total: ' + amount concatenates without splitting the literal", async () => {
    container.innerHTML = `<div data-forma-state='{"amount": 42}'><p id="out" data-text="{'Total: ' + amount}"></p></div>`;
    mount(container);
    await waitForEffects();
    expect(container.querySelector('#out')!.textContent).toBe('Total: 42');
  });

  it("a '*' inside a literal is not treated as multiplication", async () => {
    container.innerHTML = `<div data-forma-state='{}'><p id="out" data-text="{'a*b'}"></p></div>`;
    mount(container);
    await waitForEffects();
    expect(container.querySelector('#out')!.textContent).toBe('a*b');
  });

  it('real arithmetic still splits at the top level: a + b === 5', async () => {
    container.innerHTML = `<div data-forma-state='{"a": 2, "b": 3}'><p id="out" data-text="{a + b}"></p></div>`;
    mount(container);
    await waitForEffects();
    expect(container.querySelector('#out')!.textContent).toBe('5');
  });
});
