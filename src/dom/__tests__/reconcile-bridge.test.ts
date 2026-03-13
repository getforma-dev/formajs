import { describe, it, expect } from 'vitest';
import { reconcileSsr } from '../reconcile-bridge';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a container with SSR-like content and the data-forma-ssr marker. */
function ssrContainer(innerHTML: string): HTMLDivElement {
  const el = document.createElement('div');
  el.setAttribute('id', 'app');
  el.setAttribute('data-forma-ssr', '');
  el.innerHTML = innerHTML;
  return el;
}

/** Build a client-side element tree. */
function clientEl(tag: string, attrs: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  for (const child of children) {
    if (typeof child === 'string') {
      el.appendChild(document.createTextNode(child));
    } else {
      el.appendChild(child);
    }
  }
  return el;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('reconcileSsr', () => {
  it('patches text content without replacing the element', () => {
    const container = ssrContainer('<div class="card">Server text</div>');
    const ssrDiv = container.firstElementChild!;

    const client = clientEl('div', { class: 'card' }, 'Client text');
    reconcileSsr(container, client);

    // The same DOM element should still be in the container (patched in place)
    expect(container.firstElementChild).toBe(ssrDiv);
    expect(container.firstElementChild!.textContent).toBe('Client text');
  });

  it('falls back to full replace when root tag differs', () => {
    const container = ssrContainer('<div>Old</div>');
    const ssrDiv = container.firstElementChild!;

    const client = clientEl('section', {}, 'New');
    reconcileSsr(container, client);

    // Should have replaced entirely — different element reference
    expect(container.firstElementChild).not.toBe(ssrDiv);
    expect(container.firstElementChild!.tagName).toBe('SECTION');
    expect(container.firstElementChild!.textContent).toBe('New');
  });

  it('removes data-forma-ssr attribute after reconciliation', () => {
    const container = ssrContainer('<div>Hello</div>');
    expect(container.hasAttribute('data-forma-ssr')).toBe(true);

    reconcileSsr(container, clientEl('div', {}, 'Hello'));

    expect(container.hasAttribute('data-forma-ssr')).toBe(false);
  });

  it('removes data-forma-ssr even on full-replace path', () => {
    const container = ssrContainer('<div>Hello</div>');
    reconcileSsr(container, clientEl('section', {}, 'Hello'));

    expect(container.hasAttribute('data-forma-ssr')).toBe(false);
  });

  it('handles empty SSR container gracefully', () => {
    const container = ssrContainer('');
    const client = clientEl('div', {}, 'Fresh');
    reconcileSsr(container, client);

    expect(container.firstElementChild!.tagName).toBe('DIV');
    expect(container.firstElementChild!.textContent).toBe('Fresh');
    expect(container.hasAttribute('data-forma-ssr')).toBe(false);
  });

  it('handles text-only SSR container (no element child)', () => {
    const container = ssrContainer('bare text');
    const client = clientEl('div', {}, 'Replaced');
    reconcileSsr(container, client);

    expect(container.firstElementChild!.tagName).toBe('DIV');
    expect(container.textContent).toBe('Replaced');
    expect(container.hasAttribute('data-forma-ssr')).toBe(false);
  });

  it('patches attributes correctly — add, update, remove', () => {
    const container = ssrContainer('<div class="old" data-x="remove-me">Hi</div>');
    const client = clientEl('div', { class: 'new', id: 'added' }, 'Hi');

    reconcileSsr(container, client);

    const el = container.firstElementChild!;
    expect(el.getAttribute('class')).toBe('new');
    expect(el.getAttribute('id')).toBe('added');
    expect(el.hasAttribute('data-x')).toBe(false);
  });

  it('patches nested children recursively', () => {
    const container = ssrContainer(
      '<div><span>Old span</span><p>Old para</p></div>',
    );
    const ssrDiv = container.firstElementChild!;
    const ssrSpan = ssrDiv.querySelector('span')!;

    const client = clientEl(
      'div',
      {},
      clientEl('span', {}, 'New span'),
      clientEl('p', { class: 'updated' }, 'New para'),
    );

    reconcileSsr(container, client);

    // Root div should be the same reference (patched in place)
    expect(container.firstElementChild).toBe(ssrDiv);
    // Span should be the same reference (same tag, patched)
    expect(container.firstElementChild!.querySelector('span')).toBe(ssrSpan);
    expect(ssrSpan.textContent).toBe('New span');
    // p should be patched too
    const p = container.firstElementChild!.querySelector('p')!;
    expect(p.textContent).toBe('New para');
    expect(p.getAttribute('class')).toBe('updated');
  });

  it('adds extra client children that SSR did not have', () => {
    const container = ssrContainer('<div><span>Only child</span></div>');

    const client = clientEl(
      'div',
      {},
      clientEl('span', {}, 'First'),
      clientEl('em', {}, 'Second'),
    );

    reconcileSsr(container, client);

    const children = container.firstElementChild!.children;
    expect(children.length).toBe(2);
    expect(children[0]!.tagName).toBe('SPAN');
    expect(children[1]!.tagName).toBe('EM');
  });

  it('removes extra SSR children not present in client tree', () => {
    const container = ssrContainer(
      '<div><span>One</span><span>Two</span><span>Three</span></div>',
    );

    const client = clientEl('div', {}, clientEl('span', {}, 'One'));

    reconcileSsr(container, client);

    const children = container.firstElementChild!.children;
    expect(children.length).toBe(1);
    expect(children[0]!.textContent).toBe('One');
  });

  it('handles non-element clientRoot by doing full replace', () => {
    const container = ssrContainer('<div>SSR</div>');
    const textNode = document.createTextNode('Plain text');

    reconcileSsr(container, textNode);

    // Should have cleared and appended the text node
    expect(container.firstElementChild).toBeNull();
    expect(container.textContent).toBe('Plain text');
    expect(container.hasAttribute('data-forma-ssr')).toBe(false);
  });
});
