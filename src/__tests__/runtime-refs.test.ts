/**
 * $refs magic — data-ref directive tests.
 *
 * $refs provides named element references within a data-forma-state scope,
 * similar to Alpine.js's x-ref / $refs pattern.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mount, unmount, setUnsafeEvalMode, setUnsafeEval } from '../runtime';

describe('$refs magic', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    unmount(container);
    container.remove();
  });

  it('resolves data-ref elements by name', () => {
    container.innerHTML = `
      <div data-forma-state='{"x": 0}'>
        <input data-ref="search" type="text" value="hello">
        <p data-text="{$refs.search.value}"></p>
      </div>
    `;
    mount(container);
    const p = container.querySelector('p')!;
    expect(p.textContent).toBe('hello');
  });

  it('allows focusing a ref from a handler', () => {
    container.innerHTML = `
      <div data-forma-state='{"x": 0}'>
        <input data-ref="nameInput" type="text">
        <button data-on:click="{$refs.nameInput.focus()}">Focus</button>
      </div>
    `;
    mount(container);
    const btn = container.querySelector('button')!;
    expect(() => btn.click()).not.toThrow();
  });

  it('returns undefined for non-existent ref (no crash)', () => {
    container.innerHTML = `
      <div data-forma-state='{"x": 0}'>
        <p data-text="{$refs.missing ?? 'none'}"></p>
      </div>
    `;
    mount(container);
    const p = container.querySelector('p')!;
    // $refs.missing is undefined, nullish coalescing falls through to 'none'
    expect(p.textContent).toBe('none');
  });

  it('supports multiple refs in the same scope', () => {
    container.innerHTML = `
      <div data-forma-state='{"x": 0}'>
        <input data-ref="first" value="A">
        <input data-ref="second" value="B">
        <p id="out1" data-text="{$refs.first.value}"></p>
        <p id="out2" data-text="{$refs.second.value}"></p>
      </div>
    `;
    mount(container);
    expect(container.querySelector('#out1')!.textContent).toBe('A');
    expect(container.querySelector('#out2')!.textContent).toBe('B');
  });

  it('works with classList on ref element (unsafe-eval path)', () => {
    // Deep chained calls like $refs.panel.classList.toggle('open') require
    // the unsafe-eval path since the CSP-safe parser has limits on chain depth.
    setUnsafeEvalMode('mutable');
    setUnsafeEval(true);

    container.innerHTML = `
      <div data-forma-state='{"x": 0}'>
        <div data-ref="panel" class="panel">Content</div>
        <button data-on:click="{$refs.panel.classList.toggle('open')}">Toggle</button>
      </div>
    `;
    mount(container);
    const panel = container.querySelector('.panel')!;
    const btn = container.querySelector('button')!;

    expect(panel.classList.contains('open')).toBe(false);
    btn.click();
    expect(panel.classList.contains('open')).toBe(true);
    btn.click();
    expect(panel.classList.contains('open')).toBe(false);

    setUnsafeEval(false);
  });

  it('works with reading dataset from ref', () => {
    container.innerHTML = `
      <div data-forma-state='{"x": 0}'>
        <div data-ref="info" data-custom="metadata">Info</div>
        <p data-text="{$refs.info.dataset.custom}"></p>
      </div>
    `;
    mount(container);
    const p = container.querySelector('p')!;
    expect(p.textContent).toBe('metadata');
  });

  it('refs are scoped to their data-forma-state parent', () => {
    container.innerHTML = `
      <div data-forma-state='{"x": 0}'>
        <input data-ref="shared" value="scope1">
        <p id="p1" data-text="{$refs.shared.value}"></p>
      </div>
      <div data-forma-state='{"x": 0}'>
        <input data-ref="shared" value="scope2">
        <p id="p2" data-text="{$refs.shared.value}"></p>
      </div>
    `;
    mount(container);
    expect(container.querySelector('#p1')!.textContent).toBe('scope1');
    expect(container.querySelector('#p2')!.textContent).toBe('scope2');
  });
});
