import { describe, it, expect, vi } from 'vitest';
import { h, Fragment, fragment, cleanup } from '../element';
import { createSignal } from '../../reactive/signal';
import { createRoot } from '../../reactive/root';

describe('h() — HTML elements', () => {
  it('creates a div element', () => {
    const el = h('div');
    expect(el).toBeInstanceOf(HTMLDivElement);
  });

  it('creates various HTML elements', () => {
    expect(h('span')).toBeInstanceOf(HTMLSpanElement);
    expect(h('button')).toBeInstanceOf(HTMLButtonElement);
    expect(h('input')).toBeInstanceOf(HTMLInputElement);
    expect(h('p')).toBeInstanceOf(HTMLParagraphElement);
    expect(h('a')).toBeInstanceOf(HTMLAnchorElement);
  });

  it('creates uncommon elements not in the prototype cache', () => {
    const el = h('custom-element');
    expect(el).toBeInstanceOf(HTMLElement);
    expect(el.tagName.toLowerCase()).toBe('custom-element');
  });
});

describe('h() — static props', () => {
  it('sets class attribute', () => {
    const el = h('div', { class: 'container' });
    expect(el.className).toBe('container');
  });

  it('sets className (React-style)', () => {
    const el = h('div', { className: 'wrapper' });
    expect(el.className).toBe('wrapper');
  });

  it('sets style as string', () => {
    const el = h('div', { style: 'color: red' });
    expect(el.style.color).toBe('red');
  });

  it('sets style as object', () => {
    const el = h('div', { style: { color: 'blue', fontSize: '14px' } });
    expect(el.style.color).toBe('blue');
    expect(el.style.fontSize).toBe('14px');
  });

  it('sets data attributes', () => {
    const el = h('div', { 'data-id': '42', 'data-name': 'test' });
    expect(el.getAttribute('data-id')).toBe('42');
    expect(el.getAttribute('data-name')).toBe('test');
  });

  it('sets boolean attributes (disabled)', () => {
    const el = h('input', { disabled: true });
    expect(el.hasAttribute('disabled')).toBe(true);
  });

  it('does not set false boolean attributes', () => {
    const el = h('input', { disabled: false });
    expect(el.hasAttribute('disabled')).toBe(false);
  });

  it('sets id attribute', () => {
    const el = h('div', { id: 'main' });
    expect(el.getAttribute('id')).toBe('main');
  });

  it('skips null/undefined/false values', () => {
    const el = h('div', { 'data-a': null, 'data-b': undefined, 'data-c': false });
    expect(el.hasAttribute('data-a')).toBe(false);
    expect(el.hasAttribute('data-b')).toBe(false);
    expect(el.hasAttribute('data-c')).toBe(false);
  });

  it('true value sets empty attribute', () => {
    const el = h('div', { 'aria-hidden': true });
    expect(el.getAttribute('aria-hidden')).toBe('');
  });

  it('sets dangerouslySetInnerHTML', () => {
    const el = h('div', { dangerouslySetInnerHTML: { __html: '<b>bold</b>' } });
    expect(el.innerHTML).toBe('<b>bold</b>');
  });

  it('null props is valid', () => {
    const el = h('div', null);
    expect(el).toBeInstanceOf(HTMLDivElement);
  });

  it('no props is valid', () => {
    const el = h('div');
    expect(el).toBeInstanceOf(HTMLDivElement);
  });
});

describe('h() — event handlers', () => {
  it('attaches onClick handler', () => {
    const spy = vi.fn();
    const el = h('button', { onClick: spy });
    el.click();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('multiple event handlers', () => {
    const clickSpy = vi.fn();
    const mouseoverSpy = vi.fn();
    const el = h('div', { onClick: clickSpy, onMouseover: mouseoverSpy });

    el.click();
    expect(clickSpy).toHaveBeenCalledTimes(1);

    el.dispatchEvent(new Event('mouseover'));
    expect(mouseoverSpy).toHaveBeenCalledTimes(1);
  });
});

describe('h() — children', () => {
  it('sets single string child via textContent', () => {
    const el = h('p', null, 'Hello');
    expect(el.textContent).toBe('Hello');
  });

  it('sets single number child via textContent', () => {
    const el = h('span', null, 42);
    expect(el.textContent).toBe('42');
  });

  it('appends multiple children', () => {
    const el = h('ul', null,
      h('li', null, 'A'),
      h('li', null, 'B'),
    );
    expect(el.children.length).toBe(2);
    expect(el.children[0]!.textContent).toBe('A');
    expect(el.children[1]!.textContent).toBe('B');
  });

  it('handles nested elements', () => {
    const el = h('div', null,
      h('header', null, h('h1', null, 'Title')),
      h('main', null, 'Content'),
    );
    expect(el.querySelector('h1')!.textContent).toBe('Title');
    expect(el.querySelector('main')!.textContent).toBe('Content');
  });

  it('skips null/false/true children', () => {
    const el = h('div', null, null, false, true, 'visible');
    expect(el.textContent).toBe('visible');
  });

  it('handles array children', () => {
    const items = ['A', 'B', 'C'].map(t => h('span', null, t));
    const el = h('div', null, items);
    expect(el.children.length).toBe(3);
  });

  it('handles mixed children types', () => {
    const el = h('div', null,
      'text',
      h('span', null, 'element'),
      42,
    );
    expect(el.childNodes.length).toBe(3);
  });
});

describe('h() — reactive props', () => {
  it('reactive class updates on signal change', () => {
    createRoot(() => {
      const [cls, setCls] = createSignal('initial');
      const el = h('div', { class: cls });
      expect(el.className).toBe('initial');

      setCls('updated');
      expect(el.className).toBe('updated');
    });
  });

  it('reactive data attribute', () => {
    createRoot(() => {
      const [val, setVal] = createSignal('a');
      const el = h('div', { 'data-x': val });
      expect(el.getAttribute('data-x')).toBe('a');

      setVal('b');
      expect(el.getAttribute('data-x')).toBe('b');
    });
  });

  it('reactive boolean attribute', () => {
    createRoot(() => {
      const [dis, setDis] = createSignal(true);
      const el = h('input', { disabled: dis });
      expect(el.hasAttribute('disabled')).toBe(true);

      setDis(false);
      expect(el.hasAttribute('disabled')).toBe(false);
    });
  });

  it('reactive attribute removes on null/false', () => {
    createRoot(() => {
      const [val, setVal] = createSignal<string | null>('visible');
      const el = h('div', { 'data-x': val });
      expect(el.getAttribute('data-x')).toBe('visible');

      setVal(null);
      expect(el.hasAttribute('data-x')).toBe(false);
    });
  });
});

describe('h() — reactive children', () => {
  it('function child creates reactive text', () => {
    createRoot(() => {
      const [name, setName] = createSignal('Alice');
      const el = h('span', null, () => `Hello ${name()}`);
      expect(el.textContent).toBe('Hello Alice');

      setName('Bob');
      expect(el.textContent).toBe('Hello Bob');
    });
  });

  it('function child returning element replaces', () => {
    createRoot(() => {
      const [show, setShow] = createSignal(true);
      const el = h('div', null, () => show() ? h('b', null, 'yes') : h('i', null, 'no'));
      expect(el.querySelector('b')!.textContent).toBe('yes');

      setShow(false);
      expect(el.querySelector('i')!.textContent).toBe('no');
      expect(el.querySelector('b')).toBe(null);
    });
  });
});

describe('h() — ref prop', () => {
  it('calls ref callback with element', () => {
    let captured: HTMLElement | null = null;
    const el = h('div', { ref: (el: Element) => { captured = el as HTMLElement; } });
    expect(captured).toBe(el);
  });
});

describe('h() — SVG elements', () => {
  it('creates SVG elements with correct namespace', () => {
    const svg = h('svg', { viewBox: '0 0 24 24' });
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
  });

  it('creates SVG child elements', () => {
    const path = h('path', { d: 'M0 0L10 10' });
    expect(path.namespaceURI).toBe('http://www.w3.org/2000/svg');
  });

  it('creates circle, rect, line', () => {
    expect(h('circle').namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(h('rect').namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(h('line').namespaceURI).toBe('http://www.w3.org/2000/svg');
  });
});

describe('cleanup()', () => {
  it('removes event listeners attached by h()', () => {
    const spy = vi.fn();
    const el = h('button', { onClick: spy });
    el.click();
    expect(spy).toHaveBeenCalledTimes(1);

    cleanup(el);
    el.click();
    expect(spy).toHaveBeenCalledTimes(1); // no additional call
  });

  it('is safe to call on element without listeners', () => {
    const el = h('div');
    expect(() => cleanup(el)).not.toThrow();
  });

  it('is safe to call twice', () => {
    const spy = vi.fn();
    const el = h('button', { onClick: spy });
    cleanup(el);
    cleanup(el);
    el.click();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('Fragment', () => {
  it('h(Fragment) returns DocumentFragment', () => {
    const frag = h(Fragment, null, h('p', null, 'A'), h('p', null, 'B'));
    expect(frag).toBeInstanceOf(DocumentFragment);
    expect(frag.childNodes.length).toBe(2);
  });
});

describe('fragment()', () => {
  it('creates DocumentFragment from children', () => {
    const frag = fragment(h('span', null, 'one'), h('span', null, 'two'));
    expect(frag).toBeInstanceOf(DocumentFragment);
    expect(frag.childNodes.length).toBe(2);
  });

  it('handles string children', () => {
    const frag = fragment('hello', 'world');
    expect(frag.childNodes.length).toBe(2);
    expect(frag.textContent).toBe('helloworld');
  });
});

describe('h() — dangerouslySetInnerHTML validation', () => {
  it('reactive function returning { __html: string } updates innerHTML', () => {
    createRoot(() => {
      const [html, setHtml] = createSignal({ __html: '<b>hello</b>' });
      const el = h('div', { dangerouslySetInnerHTML: html });
      expect(el.innerHTML).toBe('<b>hello</b>');

      setHtml({ __html: '<i>updated</i>' });
      expect(el.innerHTML).toBe('<i>updated</i>');
    });
  });

  it('reactive function returning null clears innerHTML', () => {
    createRoot(() => {
      const [html, setHtml] = createSignal<{ __html: string } | null>({ __html: '<b>hello</b>' });
      const el = h('div', { dangerouslySetInnerHTML: html });
      expect(el.innerHTML).toBe('<b>hello</b>');

      setHtml(null);
      expect(el.innerHTML).toBe('');
    });
  });

  it('static path throws TypeError for invalid shape (not an object)', () => {
    expect(() => {
      h('div', { dangerouslySetInnerHTML: 'not-an-object' });
    }).toThrow(TypeError);
  });

  it('static path throws TypeError for object missing __html', () => {
    expect(() => {
      h('div', { dangerouslySetInnerHTML: { wrong: 'key' } });
    }).toThrow(TypeError);
  });

  it('static path throws TypeError when __html is not a string', () => {
    expect(() => {
      h('div', { dangerouslySetInnerHTML: { __html: 42 } });
    }).toThrow(TypeError);
  });

  it('reactive path throws TypeError for invalid shape', () => {
    expect(() => {
      createRoot(() => {
        h('div', { dangerouslySetInnerHTML: () => 'not-an-object' });
      });
    }).toThrow(TypeError);
  });

  it('reactive path throws TypeError when __html is not a string', () => {
    expect(() => {
      createRoot(() => {
        h('div', { dangerouslySetInnerHTML: () => ({ __html: 123 }) });
      });
    }).toThrow(TypeError);
  });
});
