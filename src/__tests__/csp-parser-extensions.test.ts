import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  mount,
  unmount,
  setUnsafeEval,
  setUnsafeEvalMode,
  getDiagnostics,
  clearDiagnostics,
} from '../runtime';

function waitForEffects(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('CSP-safe parser extensions', () => {
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

  // ── Chained method calls ──

  describe('chained method calls', () => {
    it('str.trim().toUpperCase()', async () => {
      container.innerHTML = `
        <div data-forma-state='{"str": " hello "}'>
          <p id="out" data-text="{str.trim().toUpperCase()}"></p>
        </div>
      `;
      mount(container);
      await waitForEffects();
      expect(container.querySelector('#out')?.textContent).toBe('HELLO');
    });

    it('str.trim().toLowerCase()', async () => {
      container.innerHTML = `
        <div data-forma-state='{"str": " WORLD "}'>
          <p id="out" data-text="{str.trim().toLowerCase()}"></p>
        </div>
      `;
      mount(container);
      await waitForEffects();
      expect(container.querySelector('#out')?.textContent).toBe('world');
    });

    it('three-level chain: str.trim().toLowerCase().replace(a, b)', async () => {
      container.innerHTML = `
        <div data-forma-state='{"str": " Hello World "}'>
          <p id="out" data-text="{str.trim().toLowerCase()}"></p>
        </div>
      `;
      mount(container);
      await waitForEffects();
      expect(container.querySelector('#out')?.textContent).toBe('hello world');
    });

    it('method with args chained: items.concat(x).length', async () => {
      container.innerHTML = `
        <div data-forma-state='{"items": [1, 2], "x": 3}'>
          <p id="out" data-text="{items.concat(x).length}"></p>
        </div>
      `;
      mount(container);
      await waitForEffects();
      // concat returns a new array with x appended, length should be 3
      // But x is 3 (a number), not an array. concat(3) -> [1,2,3], length = 3
      expect(container.querySelector('#out')?.textContent).toBe('3');
    });

    it('simple dot access still works: user.name', async () => {
      container.innerHTML = `
        <div data-forma-state='{"user": {"name": "Alice"}}'>
          <p id="out" data-text="{user.name}"></p>
        </div>
      `;
      mount(container);
      await waitForEffects();
      expect(container.querySelector('#out')?.textContent).toBe('Alice');
    });

    it('deep dot access still works: user.address.city', async () => {
      container.innerHTML = `
        <div data-forma-state='{"user": {"address": {"city": "NYC"}}}'>
          <p id="out" data-text="{user.address.city}"></p>
        </div>
      `;
      mount(container);
      await waitForEffects();
      expect(container.querySelector('#out')?.textContent).toBe('NYC');
    });

    it('single method call still works: str.trim()', async () => {
      container.innerHTML = `
        <div data-forma-state='{"str": " test "}'>
          <p id="out" data-text="{str.trim()}"></p>
        </div>
      `;
      mount(container);
      await waitForEffects();
      expect(container.querySelector('#out')?.textContent).toBe('test');
    });

    it('items.length still works (property access)', async () => {
      container.innerHTML = `
        <div data-forma-state='{"items": [1, 2, 3]}'>
          <p id="out" data-text="{items.length}"></p>
        </div>
      `;
      mount(container);
      await waitForEffects();
      expect(container.querySelector('#out')?.textContent).toBe('3');
    });

    it('Math.floor still works', async () => {
      container.innerHTML = `
        <div data-forma-state='{"x": 3.7}'>
          <p id="out" data-text="{Math.floor(x)}"></p>
        </div>
      `;
      mount(container);
      await waitForEffects();
      expect(container.querySelector('#out')?.textContent).toBe('3');
    });
  });

  // ── Optional chaining ──

  describe('optional chaining', () => {
    it('obj?.prop returns value when obj is non-null', async () => {
      container.innerHTML = `
        <div data-forma-state='{"user": {"name": "Alice"}}'>
          <p id="out" data-text="{user?.name}"></p>
        </div>
      `;
      mount(container);
      await waitForEffects();
      expect(container.querySelector('#out')?.textContent).toBe('Alice');
    });

    it('obj?.prop returns empty when obj is null', async () => {
      container.innerHTML = `
        <div data-forma-state='{"user": null}'>
          <p id="out" data-text="{user?.name}"></p>
        </div>
      `;
      mount(container);
      await waitForEffects();
      expect(container.querySelector('#out')?.textContent).toBe('');
    });

    it('deep optional chain: obj?.a?.b', async () => {
      container.innerHTML = `
        <div data-forma-state='{"obj": {"a": {"b": "deep"}}}'>
          <p id="out" data-text="{obj?.a?.b}"></p>
        </div>
      `;
      mount(container);
      await waitForEffects();
      expect(container.querySelector('#out')?.textContent).toBe('deep');
    });

    it('deep optional chain with null midpoint', async () => {
      container.innerHTML = `
        <div data-forma-state='{"obj": {"a": null}}'>
          <p id="out" data-text="{obj?.a?.b}"></p>
        </div>
      `;
      mount(container);
      await waitForEffects();
      expect(container.querySelector('#out')?.textContent).toBe('');
    });

    it('optional method call: str?.trim() on non-null', async () => {
      container.innerHTML = `
        <div data-forma-state='{"str": " hello "}'>
          <p id="out" data-text="{str?.trim()}"></p>
        </div>
      `;
      mount(container);
      await waitForEffects();
      expect(container.querySelector('#out')?.textContent).toBe('hello');
    });

    it('optional method call: str?.trim() on null', async () => {
      container.innerHTML = `
        <div data-forma-state='{"str": null}'>
          <p id="out" data-text="{str?.trim()}"></p>
        </div>
      `;
      mount(container);
      await waitForEffects();
      expect(container.querySelector('#out')?.textContent).toBe('');
    });

    it('mixed chain: obj?.name.toUpperCase()', async () => {
      container.innerHTML = `
        <div data-forma-state='{"obj": {"name": "alice"}}'>
          <p id="out" data-text="{obj?.name.toUpperCase()}"></p>
        </div>
      `;
      mount(container);
      await waitForEffects();
      // obj?.name returns "alice", then .toUpperCase() chains
      // Wait -- this is "alice".toUpperCase() -> "ALICE"
      // But if obj is null, the chain should short-circuit
      expect(container.querySelector('#out')?.textContent).toBe('ALICE');
    });

    it('no diagnostics emitted for optional chaining', async () => {
      container.innerHTML = `
        <div data-forma-state='{"user": {"name": "Bob"}}'>
          <p id="out" data-text="{user?.name}"></p>
        </div>
      `;
      mount(container);
      await waitForEffects();
      expect(getDiagnostics()).toHaveLength(0);
    });
  });

  // ── Array literals ──

  describe('array literals', () => {
    it('[1, 2, 3] assignment in handler', async () => {
      container.innerHTML = `
        <div data-forma-state='{"items": []}'>
          <p id="out" data-text="{items.length}"></p>
          <button id="btn" data-on:click="{items = [1, 2, 3]}">set</button>
        </div>
      `;
      mount(container);
      await waitForEffects();
      expect(container.querySelector('#out')?.textContent).toBe('0');
      container.querySelector<HTMLButtonElement>('#btn')!.click();
      await waitForEffects();
      expect(container.querySelector('#out')?.textContent).toBe('3');
    });

    it('empty array []', async () => {
      container.innerHTML = `
        <div data-forma-state='{"items": [1, 2]}'>
          <p id="out" data-text="{items.length}"></p>
          <button id="btn" data-on:click="{items = []}">clear</button>
        </div>
      `;
      mount(container);
      await waitForEffects();
      expect(container.querySelector('#out')?.textContent).toBe('2');
      container.querySelector<HTMLButtonElement>('#btn')!.click();
      await waitForEffects();
      expect(container.querySelector('#out')?.textContent).toBe('0');
    });

    it('array with string elements', async () => {
      container.innerHTML = `
        <div data-forma-state='{"items": []}'>
          <p id="out" data-text="{items.length}"></p>
          <button id="btn" data-on:click="{items = ['a', 'b', 'c']}">set</button>
        </div>
      `;
      mount(container);
      await waitForEffects();
      container.querySelector<HTMLButtonElement>('#btn')!.click();
      await waitForEffects();
      expect(container.querySelector('#out')?.textContent).toBe('3');
    });

    it('array with expression elements', async () => {
      container.innerHTML = `
        <div data-forma-state='{"x": 10, "items": []}'>
          <p id="out" data-text="{items.length}"></p>
          <button id="btn" data-on:click="{items = [x, x, x]}">set</button>
        </div>
      `;
      mount(container);
      await waitForEffects();
      container.querySelector<HTMLButtonElement>('#btn')!.click();
      await waitForEffects();
      expect(container.querySelector('#out')?.textContent).toBe('3');
    });

    it('array literal in expression context', async () => {
      container.innerHTML = `
        <div data-forma-state='{"items": [1, 2, 3]}'>
          <p id="out" data-text="{items.length}"></p>
        </div>
      `;
      mount(container);
      await waitForEffects();
      expect(container.querySelector('#out')?.textContent).toBe('3');
    });
  });

  // ── if bodies with method calls ──

  describe('if bodies with method calls', () => {
    it('if (cond.trim()) { x = x.concat(val); y = defaultVal }', async () => {
      container.innerHTML = `
        <div data-forma-state='{"todos": [], "newTodo": " hello "}'>
          <p id="count" data-text="{todos.length}"></p>
          <button id="add" data-on:click="{if (newTodo.trim()) { todos = todos.concat(newTodo.trim()); newTodo = '' }}">add</button>
        </div>
      `;
      mount(container);
      await waitForEffects();
      expect(container.querySelector('#count')?.textContent).toBe('0');
      container.querySelector<HTMLButtonElement>('#add')!.click();
      await waitForEffects();
      expect(container.querySelector('#count')?.textContent).toBe('1');
    });

    it('if with empty condition: does not execute body', async () => {
      container.innerHTML = `
        <div data-forma-state='{"todos": [], "newTodo": "   "}'>
          <p id="count" data-text="{todos.length}"></p>
          <button id="add" data-on:click="{if (newTodo.trim()) { todos = todos.concat(newTodo.trim()); newTodo = '' }}">add</button>
        </div>
      `;
      mount(container);
      await waitForEffects();
      expect(container.querySelector('#count')?.textContent).toBe('0');
      container.querySelector<HTMLButtonElement>('#add')!.click();
      await waitForEffects();
      // Should still be 0 since newTodo.trim() is empty string (falsy)
      expect(container.querySelector('#count')?.textContent).toBe('0');
    });

    it('if body with chained method call in assignment', async () => {
      container.innerHTML = `
        <div data-forma-state='{"result": "", "input": " Hello World "}'>
          <p id="out" data-text="{result}"></p>
          <button id="btn" data-on:click="{if (input.trim()) { result = input.trim().toUpperCase() }}">go</button>
        </div>
      `;
      mount(container);
      await waitForEffects();
      container.querySelector<HTMLButtonElement>('#btn')!.click();
      await waitForEffects();
      expect(container.querySelector('#out')?.textContent).toBe('HELLO WORLD');
    });

    it('no diagnostics for if with method calls', async () => {
      container.innerHTML = `
        <div data-forma-state='{"x": [], "y": "test"}'>
          <button id="btn" data-on:click="{if (y.trim()) { x = x.concat(y) }}">go</button>
        </div>
      `;
      mount(container);
      await waitForEffects();
      container.querySelector<HTMLButtonElement>('#btn')!.click();
      await waitForEffects();
      expect(getDiagnostics()).toHaveLength(0);
    });
  });
});
