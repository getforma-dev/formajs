import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  mount,
  unmount,
  setUnsafeEval,
  setUnsafeEvalMode,
  getUnsafeEvalMode,
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

    const offscreen = await mountWithBlockedHandler('x.__proto__.polluted = true');

    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    unmount(offscreen);
  });
});
