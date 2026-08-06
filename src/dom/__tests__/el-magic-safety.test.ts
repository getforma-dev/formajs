/**
 * `$el`, `$refs` and `$event` through the real directive pipeline.
 *
 * These cases existed before, and every one of them called `setUnsafeEval(true)`
 * first — so the property they claimed to prove (that the `$el` allowlist blocks
 * DOM escape) was only ever exercised on the `new Function` path, and was
 * untested on the build that ships. They also asserted denial as
 * `typeof $el.ownerDocument === 'undefined'`, which is indistinguishable from
 * the property simply being absent.
 *
 * Both are fixed here: there is no eval path left to opt into, and a denial is
 * asserted as a denial — the binding writes nothing, the element is marked, and
 * a diagnostic carries the reason.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mount, unmount, getDiagnostics, clearDiagnostics, setDiagnostics } from '../../runtime';

function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

describe('$el safe proxy', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    setDiagnostics(true);
    clearDiagnostics();
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    unmount(container);
    container.remove();
    setDiagnostics(false);
    clearDiagnostics();
    vi.restoreAllMocks();
  });

  /** Mount one `data-text` binding and report what the element ended up with. */
  async function bindText(expr: string): Promise<Element> {
    container.innerHTML = `
      <div data-forma-state='{"r": ""}'>
        <p id="p" data-text="${expr}">kept</p>
      </div>
    `;
    mount(container);
    await tick();
    return container.querySelector('#p')!;
  }

  it.each([
    ['ownerDocument', '{$el.ownerDocument}'],
    ['parentNode', '{$el.parentNode}'],
    ['innerHTML', '{$el.innerHTML}'],
    ['outerHTML', '{$el.outerHTML}'],
    ['ownerDocument behind typeof', '{typeof $el.ownerDocument}'],
  ])('denies $el.%s with a diagnostic, not an undefined', async (_label, expr) => {
    const p = await bindText(expr);
    expect(p.textContent).toBe('kept');
    expect(p.getAttribute('data-forma-expr-error')).toBe('unsupported');
    expect(getDiagnostics().map((d) => d.code)).toContain('FORMA_E_PROPERTY_DENIED');
  });

  it('allows the element properties on the read list', async () => {
    container.innerHTML = `
      <div data-forma-state='{"r": ""}'>
        <span id="s" data-custom="hello" data-text="{$el.dataset.custom}"></span>
        <b id="b" data-text="{$el.id}"></b>
        <i id="i" class="a b" data-text="{$el.className}"></i>
      </div>
    `;
    mount(container);
    await tick();

    expect(container.querySelector('#s')!.textContent).toBe('hello');
    expect(container.querySelector('#b')!.textContent).toBe('b');
    expect(container.querySelector('#i')!.textContent).toBe('a b');
    expect(getDiagnostics()).toEqual([]);
  });

  it('allows classList mutation from a handler', async () => {
    container.innerHTML = `
      <div data-forma-state='{"x": 0}'>
        <button id="add" data-on:click="{$el.classList.add('active')}">Add</button>
        <button id="toggle" data-on:click="{$el.classList.toggle('on')}">Toggle</button>
      </div>
    `;
    mount(container);
    await tick();

    const add = container.querySelector('#add') as HTMLButtonElement;
    const toggle = container.querySelector('#toggle') as HTMLButtonElement;
    add.click();
    await tick();
    expect(add.classList.contains('active')).toBe(true);

    toggle.click();
    await tick();
    expect(toggle.classList.contains('on')).toBe(true);
    toggle.click();
    await tick();
    expect(toggle.classList.contains('on')).toBe(false);
    expect(getDiagnostics()).toEqual([]);
  });

  it('allows a CSSOM style write but never a cssText string', async () => {
    container.innerHTML = `
      <div data-forma-state='{"x": 0}'>
        <div id="ok" data-on:click="{$el.style.color = 'red'}">Color</div>
        <div id="bad" data-on:click="{$el.style.cssText = 'color:red'}">Bulk</div>
      </div>
    `;
    mount(container);
    await tick();

    const ok = container.querySelector('#ok') as HTMLElement;
    const bad = container.querySelector('#bad') as HTMLElement;
    ok.click();
    bad.click();
    await tick();

    expect(ok.style.color).toBe('red');
    // `cssText` is a whole-declaration string assignment — the sink a strict
    // `style-src` blocks, and the one CSP.md promises FormaJS does not use.
    expect(bad.style.color).toBe('');
    expect(bad.getAttribute('data-forma-handler-error')).toBe('unsupported');
  });

  it('allows focus() and querySelector() on the element itself', async () => {
    container.innerHTML = `
      <div data-forma-state='{"x": 0}'>
        <input id="in" data-on:click="{$el.focus()}">
        <div id="wrap">
          <span class="target">found</span>
          <p id="p" data-text="{$el.querySelector('.target')?.textContent ?? 'not found'}"></p>
        </div>
      </div>
    `;
    mount(container);
    await tick();

    const input = container.querySelector('#in') as HTMLInputElement;
    input.click();
    await tick();
    expect(document.activeElement).toBe(input);

    // `$el` is the <p>, which has no descendant matching `.target` — the point
    // is that querySelector is permitted and returns a WRAPPED element, so the
    // optional chain and `?? ` fallback both behave.
    expect(container.querySelector('#p')!.textContent).toBe('not found');
    expect(getDiagnostics()).toEqual([]);
  });

  it('a wrapped element stays wrapped across every traversal hop', async () => {
    // The allowlist would guard only the first hop if `closest()` or
    // `querySelector()` handed back a raw node. Both return element hosts, so
    // the escape is denied one step further out too.
    container.innerHTML = `
      <div data-forma-state='{"r": ""}' id="scope">
        <div id="wrap">
          <p id="leak" data-text="{$el.closest('div').ownerDocument}">kept</p>
          <p id="ok" data-text="{$el.closest('div').id}"></p>
        </div>
      </div>
    `;
    mount(container);
    await tick();

    expect(container.querySelector('#ok')!.textContent).toBe('wrap');
    expect(container.querySelector('#leak')!.textContent).toBe('kept');
    expect(container.querySelector('#leak')!.getAttribute('data-forma-expr-error'))
      .toBe('unsupported');
  });

  it('$refs hands back a wrapped element, not the live node', async () => {
    // Before the wrapper, `$refs.r` was the raw element and
    // `$refs.r.ownerDocument.location.href` read the page URL from inside a
    // "CSP-safe" expression, with no diagnostic at all.
    container.innerHTML = `
      <div data-forma-state='{"r": ""}'>
        <input data-ref="myInput">
        <p id="leak" data-text="{$refs.myInput.ownerDocument.location.href}">kept</p>
        <p id="ok" data-text="{$refs.myInput.tagName}"></p>
      </div>
    `;
    mount(container);
    await tick();

    expect(container.querySelector('#leak')!.textContent).toBe('kept');
    expect(container.querySelector('#leak')!.getAttribute('data-forma-expr-error'))
      .toBe('unsupported');
    expect(container.querySelector('#ok')!.textContent).toBe('INPUT');
  });

  it('$event exposes the allowlisted properties and nothing beyond them', async () => {
    container.innerHTML = `
      <div data-forma-state='{"q":"","k":"","leak":"kept"}'>
        <input id="in" data-on:input="{q = $event.target.value}"
               data-on:keydown="{k = $event.key}">
        <button id="escape" data-on:click="{leak = $event.view}">escape</button>
        <p id="q" data-text="{q}"></p>
        <p id="k" data-text="{k}"></p>
        <p id="leak" data-text="{leak}"></p>
      </div>
    `;
    mount(container);
    await tick();

    const input = container.querySelector('#in') as HTMLInputElement;
    input.value = 'typed';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    (container.querySelector('#escape') as HTMLButtonElement).click();
    await tick();

    expect(container.querySelector('#q')!.textContent).toBe('typed');
    expect(container.querySelector('#k')!.textContent).toBe('Enter');
    expect(container.querySelector('#leak')!.textContent).toBe('kept');
    expect(container.querySelector('#escape')!.getAttribute('data-forma-handler-error'))
      .toBe('unsupported');
  });
});
