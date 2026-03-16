import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  mount,
  unmount,
  setUnsafeEval,
  setUnsafeEvalMode,
  clearDiagnostics,
} from '../runtime';

function waitForEffects(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('CSP parser operator precedence', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    setUnsafeEvalMode('locked-off');
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

  it('a + b > c evaluates as (a + b) > c', async () => {
    container.innerHTML = `
      <div data-forma-state='{"a": 3, "b": 2, "c": 4}'>
        <p id="out" data-text="{a + b > c}"></p>
      </div>
    `;
    mount(container);
    await waitForEffects();
    // (3 + 2) = 5 > 4 = true
    expect(container.querySelector('#out')?.textContent).toBe('true');
  });

  it('a * b + c evaluates as (a * b) + c', async () => {
    container.innerHTML = `
      <div data-forma-state='{"a": 2, "b": 3, "c": 1}'>
        <p id="out" data-text="{a * b + c}"></p>
      </div>
    `;
    mount(container);
    await waitForEffects();
    // (2 * 3) + 1 = 7
    expect(container.querySelector('#out')?.textContent).toBe('7');
  });

  it('a - b * c evaluates as a - (b * c)', async () => {
    container.innerHTML = `
      <div data-forma-state='{"a": 10, "b": 3, "c": 2}'>
        <p id="out" data-text="{a - b * c}"></p>
      </div>
    `;
    mount(container);
    await waitForEffects();
    // 10 - (3 * 2) = 4
    expect(container.querySelector('#out')?.textContent).toBe('4');
  });

  it('a || b && c evaluates as a || (b && c)', async () => {
    container.innerHTML = `
      <div data-forma-state='{"a": 0, "b": 1, "c": 0}'>
        <p id="out" data-text="{a || b && c}"></p>
      </div>
    `;
    mount(container);
    await waitForEffects();
    // 0 || (1 && 0) = 0 || 0 = 0
    expect(container.querySelector('#out')?.textContent).toBe('0');
  });

  it('a > b && c < d evaluates as (a > b) && (c < d)', async () => {
    container.innerHTML = `
      <div data-forma-state='{"a": 5, "b": 3, "c": 1, "d": 2}'>
        <p id="out" data-text="{a > b && c < d}"></p>
      </div>
    `;
    mount(container);
    await waitForEffects();
    // (5 > 3) && (1 < 2) = true && true = true
    expect(container.querySelector('#out')?.textContent).toBe('true');
  });

  it('a + b === c evaluates as (a + b) === c', async () => {
    container.innerHTML = `
      <div data-forma-state='{"a": 2, "b": 3, "c": 5}'>
        <p id="out" data-text="{a + b === c}"></p>
      </div>
    `;
    mount(container);
    await waitForEffects();
    // (2 + 3) === 5 = true
    expect(container.querySelector('#out')?.textContent).toBe('true');
  });
});
