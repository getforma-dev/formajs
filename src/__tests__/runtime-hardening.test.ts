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
});
