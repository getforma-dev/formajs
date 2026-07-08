/**
 * Security: data-bind:* and list-template attribute interpolation must not be
 * able to inject javascript: URLs or inline event handlers, in EITHER the
 * standard or hardened build (the setAttribute sink is identical in both).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mount, unmount } from '../runtime';

describe('data-bind: attribute injection', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    unmount(container);
    container.remove();
  });

  it('does not set a javascript: URL from data-bind:href', () => {
    container.innerHTML = `
      <div data-forma-state='{"u": "javascript:alert(document.cookie)"}'>
        <a id="t" data-bind:href="{u}">link</a>
      </div>`;
    mount(container);
    const a = container.querySelector('#t')!;
    expect(a.getAttribute('href') ?? '').not.toMatch(/script:/i);
  });

  it('does not set a control-char-obfuscated javascript: URL', () => {
    // JSON-escaped tab (\\t in the template → literal \t in the JSON string →
    // a real TAB inside the parsed value). Valid JSON, unlike a raw tab.
    container.innerHTML = `
      <div data-forma-state='{"u": "java\\tscript:alert(1)"}'>
        <a id="t" data-bind:href="{u}">link</a>
      </div>`;
    mount(container);
    const a = container.querySelector('#t')!;
    // sanity: the payload actually parsed into state (tab present in the value)
    // is not directly observable here, but href must never carry the scheme.
    expect(a.getAttribute('href') ?? '').not.toMatch(/script:/i);
  });

  it('does not set an inline event-handler attribute via data-bind:onclick', () => {
    container.innerHTML = `
      <div data-forma-state='{"code": "alert(1)"}'>
        <div id="t" data-bind:onclick="{code}">x</div>
      </div>`;
    mount(container);
    const el = container.querySelector('#t')! as HTMLElement;
    expect(el.getAttribute('onclick')).toBeNull();
  });

  it('still binds safe attributes and URLs', () => {
    container.innerHTML = `
      <div data-forma-state='{"u": "https://example.com", "t": "hello"}'>
        <a id="t" data-bind:href="{u}" data-bind:title="{t}">link</a>
      </div>`;
    mount(container);
    const a = container.querySelector('#t')!;
    expect(a.getAttribute('href')).toBe('https://example.com');
    expect(a.getAttribute('title')).toBe('hello');
  });
});

describe('data-list row-template attribute injection', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    unmount(container);
    container.remove();
  });

  it('does not interpolate a javascript: URL into a row href', async () => {
    container.innerHTML = `
      <div data-forma-state='{"items": [{"id": 1, "url": "javascript:alert(1)", "label": "go"}]}'>
        <ul data-list="{items}">
          <li data-key="{item.id}"><a href="{item.url}" data-text="{item.label}"></a></li>
        </ul>
      </div>`;
    mount(container);
    await new Promise((r) => setTimeout(r, 0));
    const a = container.querySelector('li a');
    expect(a).not.toBeNull(); // row rendered
    expect(a!.getAttribute('href') ?? '').not.toMatch(/script:/i);
  });
});
