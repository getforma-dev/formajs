// data-list {index} correctness + data-model completeness (1.3.0).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mount, unmount, setUnsafeEval } from '../runtime';

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('data-list {index} over duplicates and primitives (F1)', () => {
  let container: HTMLDivElement;
  beforeEach(() => {
    setUnsafeEval(true);
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => { unmount(container); container.remove(); });

  it('assigns distinct {index} to duplicate keyed object items', async () => {
    container.innerHTML =
      `<div data-forma-state='{"rows": [{"v": 1}, {"v": 1}, {"v": 1}]}'>` +
      `<ul data-list="{rows}"><li data-key="{item.v}"><span class="idx" data-text="{index}"></span></li></ul>` +
      `</div>`;
    mount(container);
    await tick();
    const idxs = Array.from(container.querySelectorAll('.idx')).map((n) => n.textContent);
    expect(idxs).toEqual(['0', '1', '2']);
  });

  it('assigns distinct {index} to primitive duplicate items', async () => {
    container.innerHTML =
      `<div data-forma-state='{"rows": ["x", "x"]}'>` +
      `<ul data-list="{rows}"><li data-key="{item}"><span class="idx" data-text="{index}"></span></li></ul>` +
      `</div>`;
    mount(container);
    await tick();
    const idxs = Array.from(container.querySelectorAll('.idx')).map((n) => n.textContent);
    expect(idxs).toEqual(['0', '1']);
  });

  it('keeps {index} correct after reordering keyed duplicates', async () => {
    container.innerHTML =
      `<div data-forma-state='{"rows": [{"id": 1, "v": 9}, {"id": 2, "v": 9}]}'>` +
      `<ul data-list="{rows}"><li data-key="{item.id}"><span class="idx" data-text="{index}"></span></li></ul>` +
      `</div>`;
    mount(container);
    await tick();
    const root = container.querySelector('[data-forma-state]') as any;
    root.__formaScope.setters.rows([{ id: 2, v: 9 }, { id: 1, v: 9 }]);
    await tick();
    const idxs = Array.from(container.querySelectorAll('.idx')).map((n) => n.textContent);
    expect(idxs).toEqual(['0', '1']);
  });
});

describe('data-model radio groups (F2)', () => {
  let container: HTMLDivElement;
  beforeEach(() => {
    setUnsafeEval(true);
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => { unmount(container); container.remove(); });

  it('reflects state into the matching radio and writes selected value back', async () => {
    container.innerHTML =
      `<div data-forma-state='{"size": "m"}'>` +
      `<input type="radio" name="size" value="s" data-model="{size}">` +
      `<input type="radio" name="size" value="m" data-model="{size}">` +
      `<input type="radio" name="size" value="l" data-model="{size}">` +
      `<p id="out" data-text="{size}"></p></div>`;
    mount(container);
    await tick();
    const radios = container.querySelectorAll('input[type=radio]') as NodeListOf<HTMLInputElement>;
    expect(radios[0].checked).toBe(false);
    expect(radios[1].checked).toBe(true);
    expect(radios[2].checked).toBe(false);
    radios[2].checked = true;
    radios[2].dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    expect(container.querySelector('#out')!.textContent).toBe('l');
  });
});

describe('data-model select multiple (F2)', () => {
  let container: HTMLDivElement;
  beforeEach(() => {
    setUnsafeEval(true);
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => { unmount(container); container.remove(); });

  it('reflects an array into option.selected and writes selected values as array', async () => {
    container.innerHTML =
      `<div data-forma-state='{"tags": ["a", "c"]}'>` +
      `<select multiple data-model="{tags}">` +
      `<option value="a">A</option><option value="b">B</option><option value="c">C</option>` +
      `</select><p id="out" data-text="{tags.join(',')}"></p></div>`;
    mount(container);
    await tick();
    const sel = container.querySelector('select') as HTMLSelectElement;
    const opts = sel.options;
    expect(opts[0].selected).toBe(true);
    expect(opts[1].selected).toBe(false);
    expect(opts[2].selected).toBe(true);
    opts[0].selected = false;
    opts[1].selected = true;
    opts[2].selected = false;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    const root = container.querySelector('[data-forma-state]') as any;
    expect(root.__formaScope.getters.tags()).toEqual(['b']);
    expect(container.querySelector('#out')!.textContent).toBe('b');
  });
});

describe('data-model number NaN guard (F2)', () => {
  let container: HTMLDivElement;
  beforeEach(() => {
    setUnsafeEval(true);
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => { unmount(container); container.remove(); });

  it('does not write NaN into state for empty or partial numeric input', async () => {
    container.innerHTML =
      `<div data-forma-state='{"qty": 5}'>` +
      `<input id="n" type="number" data-model="{qty}"><p id="out" data-text="{qty}"></p></div>`;
    mount(container);
    await tick();
    const input = container.querySelector('#n') as HTMLInputElement;
    const root = container.querySelector('[data-forma-state]') as any;
    input.value = '-';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    expect(Number.isNaN(root.__formaScope.getters.qty())).toBe(false);
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    const cleared = root.__formaScope.getters.qty();
    expect(cleared === null || cleared === '' || cleared === undefined).toBe(true);
    expect(Number.isNaN(cleared)).toBe(false);
    input.value = '42';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    expect(root.__formaScope.getters.qty()).toBe(42);
  });
});
