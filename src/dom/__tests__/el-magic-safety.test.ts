import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import {
  mount,
  unmount,
  setUnsafeEval,
  setUnsafeEvalMode,
} from '../../runtime';

function waitForEffects(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('$el safe proxy', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    // These expressions require unsafe-eval (e.g. typeof, method calls).
    setUnsafeEvalMode('mutable');
    setUnsafeEval(true);
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    unmount(container);
    container.remove();
    setUnsafeEvalMode('mutable');
    setUnsafeEval(false);
  });

  it('blocks access to ownerDocument', async () => {
    container.innerHTML = `
      <div data-forma-state='{"r": ""}'>
        <p data-text="{typeof $el.ownerDocument}"></p>
      </div>
    `;
    mount(container);
    await waitForEffects();

    const p = container.querySelector('p')!;
    expect(p.textContent).toBe('undefined');
  });

  it('blocks access to parentNode', async () => {
    container.innerHTML = `
      <div data-forma-state='{"r": ""}'>
        <p data-text="{typeof $el.parentNode}"></p>
      </div>
    `;
    mount(container);
    await waitForEffects();

    const p = container.querySelector('p')!;
    expect(p.textContent).toBe('undefined');
  });

  it('allows classList.add', async () => {
    container.innerHTML = `
      <div data-forma-state='{"x": 0}'>
        <button data-on:click="{$el.classList.add('active')}">Go</button>
      </div>
    `;
    mount(container);
    await waitForEffects();

    const btn = container.querySelector('button')!;
    btn.click();
    await waitForEffects();

    expect(btn.classList.contains('active')).toBe(true);
  });

  it('allows classList.toggle', async () => {
    container.innerHTML = `
      <div data-forma-state='{"x": 0}'>
        <button data-on:click="{$el.classList.toggle('on')}">Toggle</button>
      </div>
    `;
    mount(container);
    await waitForEffects();

    const btn = container.querySelector('button')!;
    btn.click();
    await waitForEffects();
    expect(btn.classList.contains('on')).toBe(true);

    btn.click();
    await waitForEffects();
    expect(btn.classList.contains('on')).toBe(false);
  });

  it('allows dataset access', async () => {
    container.innerHTML = `
      <div data-forma-state='{"r": ""}'>
        <span data-custom="hello" data-text="{$el.dataset.custom}"></span>
      </div>
    `;
    mount(container);
    await waitForEffects();

    const span = container.querySelector('span')!;
    expect(span.textContent).toBe('hello');
  });

  it('allows id access', async () => {
    container.innerHTML = `
      <div data-forma-state='{"r": ""}'>
        <span id="myspan" data-text="{$el.id}"></span>
      </div>
    `;
    mount(container);
    await waitForEffects();

    const span = container.querySelector('span')!;
    expect(span.textContent).toBe('myspan');
  });

  it('allows style access', async () => {
    container.innerHTML = `
      <div data-forma-state='{"x": 0}'>
        <div id="styled" data-on:click="{$el.style.color = 'red'}">Color</div>
      </div>
    `;
    mount(container);
    await waitForEffects();

    const div = container.querySelector('#styled') as HTMLElement;
    div.click();
    await waitForEffects();

    expect(div.style.color).toBe('red');
  });

  it('allows focus', async () => {
    container.innerHTML = `
      <div data-forma-state='{"x": 0}'>
        <input data-on:click="{$el.focus()}">
      </div>
    `;
    mount(container);
    await waitForEffects();

    const input = container.querySelector('input')!;
    expect(() => input.click()).not.toThrow();
  });

  it('allows querySelector for safe traversal', async () => {
    container.innerHTML = `
      <div data-forma-state='{"r": ""}'>
        <div id="container">
          <span class="target">found</span>
          <p data-text="{$el.querySelector('.target')?.textContent ?? 'not found'}"></p>
        </div>
      </div>
    `;
    mount(container);
    await waitForEffects();

    // $el is the <p> itself, so querySelector('.target') on <p> won't find the span
    // This tests that querySelector is allowed, not that it finds the right element
    const p = container.querySelector('p')!;
    expect(p.textContent).toBe('not found');
  });

  it('blocks innerHTML (could be used for script injection)', async () => {
    container.innerHTML = `
      <div data-forma-state='{"r": ""}'>
        <p data-text="{typeof $el.innerHTML}"></p>
      </div>
    `;
    mount(container);
    await waitForEffects();

    const p = container.querySelector('p')!;
    expect(p.textContent).toBe('undefined');
  });
});
