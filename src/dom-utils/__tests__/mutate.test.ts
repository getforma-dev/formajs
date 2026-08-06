import { describe, it, expect } from 'vitest';
import { addClass, removeClass, toggleClass, setStyle, setAttr, setText, setHTMLUnsafe } from '../mutate';

describe('addClass', () => {
  it('adds a single class', () => {
    const el = document.createElement('div');
    addClass(el, 'active');
    expect(el.classList.contains('active')).toBe(true);
  });

  it('adds multiple classes', () => {
    const el = document.createElement('div');
    addClass(el, 'a', 'b', 'c');
    expect(el.classList.contains('a')).toBe(true);
    expect(el.classList.contains('b')).toBe(true);
    expect(el.classList.contains('c')).toBe(true);
  });
});

describe('removeClass', () => {
  it('removes a class', () => {
    const el = document.createElement('div');
    el.className = 'active visible';
    removeClass(el, 'active');
    expect(el.classList.contains('active')).toBe(false);
    expect(el.classList.contains('visible')).toBe(true);
  });
});

describe('toggleClass', () => {
  it('toggles a class on and off', () => {
    const el = document.createElement('div');
    const result1 = toggleClass(el, 'open');
    expect(result1).toBe(true);
    expect(el.classList.contains('open')).toBe(true);

    const result2 = toggleClass(el, 'open');
    expect(result2).toBe(false);
    expect(el.classList.contains('open')).toBe(false);
  });

  it('force parameter controls outcome', () => {
    const el = document.createElement('div');
    toggleClass(el, 'x', true);
    expect(el.classList.contains('x')).toBe(true);

    toggleClass(el, 'x', true); // already present, stays
    expect(el.classList.contains('x')).toBe(true);

    toggleClass(el, 'x', false);
    expect(el.classList.contains('x')).toBe(false);
  });
});

describe('setStyle', () => {
  it('sets multiple style properties', () => {
    const el = document.createElement('div');
    setStyle(el, { color: 'red', fontSize: '14px' });
    expect(el.style.color).toBe('red');
    expect(el.style.fontSize).toBe('14px');
  });

  it('ignores undefined values', () => {
    const el = document.createElement('div');
    el.style.color = 'blue';
    setStyle(el, { color: undefined });
    expect(el.style.color).toBe('blue');
  });

  it('an undefined value in a mixed batch leaves that property alone and applies the rest', () => {
    // The single-property fixture above is satisfied by a guard that skips the
    // whole call. Only a mixed batch shows that the guard is per-property, and
    // only reading the serialised cssText shows that nothing was written as the
    // literal string "undefined".
    const el = document.createElement('div');
    el.style.color = 'blue';
    el.style.fontSize = '10px';
    setStyle(el, { color: undefined, fontSize: '20px', opacity: '0.5' });
    expect(el.style.color).toBe('blue');
    expect(el.style.fontSize).toBe('20px');
    expect(el.style.opacity).toBe('0.5');
    expect(el.getAttribute('style')).not.toContain('undefined');
  });
});

describe('setAttr', () => {
  it('sets string attributes', () => {
    const el = document.createElement('input');
    setAttr(el, { type: 'email', placeholder: 'Enter email' });
    expect(el.getAttribute('type')).toBe('email');
    expect(el.getAttribute('placeholder')).toBe('Enter email');
  });

  it('true sets empty attribute', () => {
    const el = document.createElement('input');
    setAttr(el, { disabled: true });
    expect(el.hasAttribute('disabled')).toBe(true);
    expect(el.getAttribute('disabled')).toBe('');
  });

  it('false removes attribute', () => {
    const el = document.createElement('input');
    el.setAttribute('disabled', '');
    setAttr(el, { disabled: false });
    expect(el.hasAttribute('disabled')).toBe(false);
  });

  it('null removes attribute', () => {
    const el = document.createElement('div');
    el.setAttribute('data-x', 'y');
    setAttr(el, { 'data-x': null });
    expect(el.hasAttribute('data-x')).toBe(false);
  });
});

describe('setText', () => {
  it('sets text content', () => {
    const el = document.createElement('p');
    setText(el, 'Hello world');
    expect(el.textContent).toBe('Hello world');
  });

  // `setText` is documented "Safe for user-controlled strings" and is the
  // recommended alternative to `setHTMLUnsafe`. Swapping its body to
  // `el.innerHTML = text` turned it into an XSS sink and left the file at 100%
  // statements / 100% branches / 100% lines with the suite green, because the
  // only fixture was a string with no markup in it.
  it.each([
    ['<script>alert(1)</script>'],
    ['<img src=x onerror=alert(1)>'],
    ['</p><b>bold</b>'],
    ['5 > 3 && 2 < 4'],
    [`it's a "quote" & an ampersand`],
  ])('renders %j as text, never as markup', (payload) => {
    const el = document.createElement('p');
    setText(el, payload);
    expect(el.textContent).toBe(payload);
    expect(el.children).toHaveLength(0);
    expect(el.querySelector('script')).toBeNull();
    expect(el.querySelector('img')).toBeNull();
    // The characters survive escaped in the serialised form, which is the
    // difference between a text node and parsed markup.
    expect(el.innerHTML).not.toBe(payload);
  });

  it('replaces existing children rather than appending to them', () => {
    const el = document.createElement('p');
    el.innerHTML = '<b>old</b>';
    setText(el, 'new');
    expect(el.textContent).toBe('new');
    expect(el.children).toHaveLength(0);
  });
});

describe('setHTMLUnsafe', () => {
  it('sets inner HTML', () => {
    const el = document.createElement('div');
    setHTMLUnsafe(el, '<em>italic</em>');
    expect(el.innerHTML).toBe('<em>italic</em>');
  });

  it('really does parse markup — that is the whole difference from setText', () => {
    // The pair has to be asserted together: if setText silently became
    // innerHTML, the two functions would be indistinguishable and the docs that
    // tell users to prefer setText would be wrong.
    const unsafe = document.createElement('div');
    const safe = document.createElement('div');
    setHTMLUnsafe(unsafe, '<b>x</b>');
    setText(safe, '<b>x</b>');
    expect(unsafe.children).toHaveLength(1);
    expect(unsafe.querySelector('b')).not.toBeNull();
    expect(safe.children).toHaveLength(0);
    expect(safe.textContent).toBe('<b>x</b>');
  });
});
