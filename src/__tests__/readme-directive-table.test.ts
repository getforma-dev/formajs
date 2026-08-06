/**
 * The README's "Full directive reference" table, executed row by row.
 *
 * Every `Example` cell is EXTRACTED FROM README.md AT TEST TIME, mounted on a
 * real element inside a scope that declares the state it names, and required to
 * bind with no diagnostic. A documentation table is a list of promises; this is
 * the file that keeps them.
 *
 * Three rows — `$el`, `$dispatch`, `$refs` — used to carry a dagger and a
 * footnote saying they only worked with the `new Function` fallback switched
 * on, because a handler whose whole body is a method call had no branch in the
 * regex parser. The allowlist interpreter has one, so the dagger is gone and
 * those rows are asserted here like every other.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as runtime from '../runtime';

const README = readFileSync(resolve(process.cwd(), 'README.md'), 'utf8');

interface Row {
  directive: string;
  example: string;
}

/** Pull `| directive | description | example |` rows out of the reference table. */
function extractDirectiveRows(markdown: string): Row[] {
  const open = markdown.indexOf('<summary><strong>Full directive reference</strong></summary>');
  if (open < 0) throw new Error('README.md no longer has a "Full directive reference" section');
  const close = markdown.indexOf('</details>', open);
  const table = markdown.slice(open, close);

  const rows: Row[] = [];
  for (const line of table.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length !== 3) continue;
    if (cells[0] === 'Directive' || /^-+$/.test(cells[0]!)) continue;
    const example = cells[2]!.replace(/^`|`$/g, '');
    rows.push({ directive: cells[0]!.replace(/`/g, ''), example });
  }
  return rows;
}

const ROWS = extractDirectiveRows(README);

/**
 * State every example in the table names, in one scope. Keys are deliberately
 * shared: if a row starts referring to something undeclared, the interpreter
 * raises FORMA_E_UNRESOLVED and this suite fails, which is the point — the
 * grammar has no silent-undefined identifier.
 */
const SCOPE_STATE = {
  count: 0,
  isOpen: true,
  loggedIn: true,
  email: '',
  isActive: true,
  url: '/docs',
  items: ['a', 'b'],
  q: '',
  id: 7,
};

/** Wrap one example attribute in the element shape that directive needs. */
function elementFor(row: Row, index: number): string {
  const attr = row.example;
  const id = ` id="row${index}"`;
  if (attr.startsWith('data-forma-state')) {
    // The scope declaration itself: a nested scope of its own.
    return `<div${id} ${attr}><span data-text="{count}"></span></div>`;
  }
  if (attr.startsWith('data-model')) return `<input${id} ${attr}>`;
  if (attr.startsWith('data-list')) return `<ul${id} ${attr}><li>{item}</li></ul>`;
  if (attr.startsWith('data-on:')) return `<button${id} ${attr}>go</button>`;
  return `<div${id} ${attr}></div>`;
}

function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

describe('README directive reference table', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    runtime.clearDiagnostics();
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => [{ id: 1 }] })));
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    runtime.unmount(container);
    container.remove();
    runtime.clearDiagnostics();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('the table still has a row per documented directive', () => {
    // A table that lost its rows would make every assertion below vacuous.
    expect(ROWS.length).toBeGreaterThanOrEqual(20);
    const named = ROWS.map((r) => r.directive);
    for (const required of ['data-text', 'data-list', '$el', '$dispatch', '$refs', '$event']) {
      expect(named, `${required} row`).toContain(required);
    }
  });

  it('every Example cell in the directive table parses clean', async () => {
    container.innerHTML = `
      <div data-forma-state='${JSON.stringify(SCOPE_STATE)}'>
        <input data-ref="myInput">
        ${ROWS.map((row, i) => elementFor(row, i)).join('\n')}
      </div>
    `;
    runtime.mount(container);
    await tick();

    // Attribute the failure to its row rather than reporting "something on the
    // page is broken" — the whole value of extracting the table is that a
    // failure names the documentation line that caused it.
    for (const [i, row] of ROWS.entries()) {
      const el = container.querySelector(`#row${i}`)!;
      expect(el.getAttribute('data-forma-expr-error'), `${row.directive}: ${row.example}`).toBeNull();
      expect(el.getAttribute('data-forma-handler-error'), `${row.directive}: ${row.example}`).toBeNull();
    }
    expect(runtime.getDiagnostics()).toEqual([]);
  });

  it('the three magic-variable rows actually do what the table says', async () => {
    // Parsing clean is necessary but not sufficient: these are the rows that
    // were documented as broken, so they are also run.
    const el = ROWS.find((r) => r.directive === '$el')!.example;
    const dispatch = ROWS.find((r) => r.directive === '$dispatch')!.example;
    const refs = ROWS.find((r) => r.directive === '$refs')!.example;

    container.innerHTML = `
      <div data-forma-state='{"id": 7}'>
        <input data-ref="myInput">
        <button id="el" ${el}>el</button>
        <button id="dispatch" ${dispatch}>dispatch</button>
        <button id="refs" ${refs}>refs</button>
      </div>
    `;
    const seen: unknown[] = [];
    container.addEventListener('selected', (e) => seen.push((e as CustomEvent).detail));
    runtime.mount(container);
    await tick();

    const click = (id: string): void => (container.querySelector(id) as HTMLButtonElement).click();

    click('#el');
    expect(container.querySelector('#el')!.classList.contains('active')).toBe(true);
    click('#el');
    expect(container.querySelector('#el')!.classList.contains('active')).toBe(false);

    click('#dispatch');
    expect(seen).toEqual([{ id: 7 }]);

    click('#refs');
    expect(document.activeElement).toBe(container.querySelector('[data-ref="myInput"]'));

    expect(container.querySelectorAll('[data-forma-handler-error]')).toHaveLength(0);
    expect(runtime.getDiagnostics()).toEqual([]);
  });

  it('the $event row writes the typed value, not undefined', async () => {
    // This row parsed clean under the regex parser too — and then wrote
    // `undefined`, because `$event` was not a name the CSP-safe path resolved
    // and an unresolved identifier silently answered undefined. Parsing clean
    // is exactly what made that invisible, so the row is exercised.
    const example = ROWS.find((r) => r.directive === '$event')!.example;
    container.innerHTML = `
      <div data-forma-state='{"q": ""}'>
        <input id="in" ${example}>
        <p id="out" data-text="{q}"></p>
      </div>
    `;
    runtime.mount(container);
    await tick();

    const input = container.querySelector('#in') as HTMLInputElement;
    input.value = 'typed';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();

    expect(container.querySelector('#out')!.textContent).toBe('typed');
    expect(runtime.getDiagnostics()).toEqual([]);
  });
});
