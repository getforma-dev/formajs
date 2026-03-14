import { describe, it, expect } from 'vitest';
import { addClass, removeClass, toggleClass, setStyle, setAttr, setText, setHTML, setHTMLUnsafe } from '../mutate';

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
});

describe('setHTML', () => {
  it('sets inner HTML', () => {
    const el = document.createElement('div');
    setHTML(el, '<strong>bold</strong>');
    expect(el.innerHTML).toBe('<strong>bold</strong>');
  });
});

describe('setHTMLUnsafe', () => {
  it('sets inner HTML (same behavior as setHTML)', () => {
    const el = document.createElement('div');
    setHTMLUnsafe(el, '<em>italic</em>');
    expect(el.innerHTML).toBe('<em>italic</em>');
  });
});
