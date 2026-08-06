/**
 * The shop window, executed.
 *
 * README.md's headline block — "Here's what you get from a single HTML file
 * with one script tag" — is EXTRACTED FROM THE FILE AT TEST TIME and mounted.
 * Nothing here is a copy of the markup, so the README and the proof cannot
 * drift: editing the block into something the grammar does not accept fails
 * this suite, and so does deleting it.
 *
 * That matters because it already happened. The block used to contain
 * `items.filter(i => i.toLowerCase().includes(query.toLowerCase()))`; when the
 * `new Function` fallback was switched off by default, the regex parser
 * rejected the arrow function, the page rendered "Found undefined results" and
 * an empty list, and the fix of record was to rewrite the README rather than
 * the engine. This file is the mechanism that stops that being possible twice.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as runtime from '../runtime';

const README = readFileSync(resolve(process.cwd(), 'README.md'), 'utf8');

/**
 * Pull the fenced ```html block that follows the flagship heading.
 *
 * Located by the heading text rather than by line number for the obvious
 * reason: a line number is stale the first time anyone edits the file above it.
 */
function extractFlagshipBlock(markdown: string): string {
  const heading = "**Here's what you get from a single HTML file with one script tag:**";
  const at = markdown.indexOf(heading);
  if (at < 0) throw new Error('README.md no longer contains the flagship heading');
  const open = markdown.indexOf('```html', at);
  if (open < 0) throw new Error('no fenced html block follows the flagship heading');
  const start = markdown.indexOf('\n', open) + 1;
  const close = markdown.indexOf('```', start);
  if (close < 0) throw new Error('the flagship html block is unterminated');
  return markdown.slice(start, close);
}

/** The block minus its `<script src>` line — the runtime is imported instead. */
function mountableMarkup(): string {
  return extractFlagshipBlock(README)
    .split('\n')
    .filter((line) => !line.includes('<script'))
    .join('\n')
    .trim();
}

function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

describe('README flagship example', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    runtime.clearDiagnostics();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    runtime.unmount(container);
    container.remove();
    runtime.clearDiagnostics();
    localStorage.clear();
  });

  async function mountFlagship(): Promise<void> {
    container.innerHTML = mountableMarkup();
    runtime.mount(container);
    await tick();
  }

  const rows = (): string[] =>
    [...container.querySelectorAll('li')].map((li) => li.textContent ?? '');
  const countText = (): string => container.querySelectorAll('p')[0]!.textContent ?? '';
  const emptyState = (): HTMLElement => container.querySelectorAll('p')[1] as HTMLElement;

  async function type(value: string): Promise<void> {
    const input = container.querySelector('input') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
  }

  it('extracts a block that still contains the arrow-function filter', () => {
    // The guard on the guard. If someone "fixes" a failure here by deleting the
    // arrow function from the README, the extraction still succeeds and every
    // other case below still passes — so the one thing that cannot be allowed
    // to disappear quietly is asserted directly.
    const block = extractFlagshipBlock(README);
    expect(block).toContain('items.filter(i => i.toLowerCase().includes(query.toLowerCase()))');
    expect(block).toContain('data-model="{query}"');
    expect(block).toContain('data-forma-state=');
  });

  it('the README block renders exactly what the README says it renders', async () => {
    await mountFlagship();

    expect(countText()).toBe('Found 5 results');
    expect(rows()).toEqual(['Apples', 'Bananas', 'Cherries', 'Dates', 'Elderberries']);
    // "No matches found." is hidden while the query is empty.
    expect(emptyState().style.display).toBe('none');
  });

  it('typing in the data-model input filters the list and the count', async () => {
    await mountFlagship();

    await type('apple');
    expect(countText()).toBe('Found 1 results');
    expect(rows()).toEqual(['Apples']);

    await type('e');
    expect(rows()).toEqual(['Apples', 'Cherries', 'Dates', 'Elderberries']);
    expect(countText()).toBe('Found 4 results');

    await type('');
    expect(rows()).toHaveLength(5);
    expect(countText()).toBe('Found 5 results');
  });

  it('data-show reveals the empty state only when a query matches nothing', async () => {
    await mountFlagship();

    await type('zzz');
    expect(countText()).toBe('Found 0 results');
    expect(rows()).toEqual([]);
    expect(emptyState().style.display).not.toBe('none');
    expect(emptyState().textContent).toBe('No matches found.');

    await type('date');
    expect(emptyState().style.display).toBe('none');
  });

  it('data-class and data-bind both react to the same signal', async () => {
    await mountFlagship();

    const themed = container.querySelector('[data-class\\:dark]') as HTMLElement;
    const label = themed.querySelector('span') as HTMLSpanElement;
    const toggle = container.querySelector('button') as HTMLButtonElement;

    expect(themed.classList.contains('dark')).toBe(false);
    expect(themed.getAttribute('data-theme')).toBe('light');
    expect(label.textContent).toBe('Light');

    toggle.click();
    await tick();

    expect(themed.classList.contains('dark')).toBe(true);
    expect(themed.getAttribute('data-theme')).toBe('dark');
    expect(label.textContent).toBe('Dark');
  });

  it('data-persist writes darkMode to localStorage as the comment claims', async () => {
    await mountFlagship();

    (container.querySelector('button') as HTMLButtonElement).click();
    await tick();

    expect(localStorage.getItem('forma:darkMode')).toBe('true');
  });

  it('binds every directive in the block with zero diagnostics', async () => {
    await mountFlagship();

    // One unparseable expression or handler marks its element and files a
    // diagnostic. Zero of each is the whole claim.
    expect(container.querySelectorAll('[data-forma-expr-error]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-forma-handler-error]')).toHaveLength(0);
    expect(runtime.getDiagnostics()).toEqual([]);
  });
});
