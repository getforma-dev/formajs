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

  it('blocks constructor in new Function path', () => {
    setUnsafeEvalMode('mutable');
    setUnsafeEval(true);

    // Build container off-document to avoid MutationObserver auto-mount race
    const offscreen = document.createElement('div');
    offscreen.innerHTML = `
      <div data-forma-state='{"x":0}'>
        <button id="btn" data-on:click="{x.constructor('alert(1)')()}">hack</button>
      </div>
    `;

    expect(() => {
      mount(offscreen);
    }).toThrow(/Blocked unsafe method "constructor"/);
  });

  it('catches template literal bracket access bypass attempt', () => {
    setUnsafeEvalMode('mutable');
    setUnsafeEval(true);

    const offscreen = document.createElement('div');
    offscreen.innerHTML = `
      <div data-forma-state='{"x":0}'>
        <button id="btn" data-on:click="{x[\`constructor\`]('alert(1)')()}">hack</button>
      </div>
    `;

    expect(() => {
      mount(offscreen);
    }).toThrow(/Blocked unsafe method "constructor"/);
  });

  it('catches comment injection bypass attempt', () => {
    setUnsafeEvalMode('mutable');
    setUnsafeEval(true);

    const offscreen = document.createElement('div');
    offscreen.innerHTML = `
      <div data-forma-state='{"x":0}'>
        <button id="btn" data-on:click="{x./**/constructor('alert(1)')()}">hack</button>
      </div>
    `;

    expect(() => {
      mount(offscreen);
    }).toThrow(/Blocked unsafe method "constructor"/);
  });

  it('blocks .Function() access in handler', () => {
    setUnsafeEvalMode('mutable');
    setUnsafeEval(true);

    const offscreen = document.createElement('div');
    offscreen.innerHTML = `
      <div data-forma-state='{"x": 0}'>
        <button id="btn" data-on:click="x.Function('return 1')()">go</button>
      </div>
    `;

    expect(() => {
      mount(offscreen);
    }).toThrow(/Blocked unsafe method "Function"/);
  });

  it('blocks .__proto__ access in handler', () => {
    setUnsafeEvalMode('mutable');
    setUnsafeEval(true);

    const offscreen = document.createElement('div');
    offscreen.innerHTML = `
      <div data-forma-state='{"x": 0}'>
        <button id="btn" data-on:click="x.__proto__.polluted = true">go</button>
      </div>
    `;

    expect(() => {
      mount(offscreen);
    }).toThrow(/Blocked unsafe method "__proto__"/);
  });
});
