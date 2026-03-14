import { describe, it, expect } from 'vitest';
import { h, Fragment, createSignal, createRoot, createShow, createList, mount } from '../../index';

describe('JSX', () => {
  it('renders a basic element', () => {
    const el = <div class="test">Hello</div>;
    expect(el).toBeInstanceOf(HTMLDivElement);
    expect((el as HTMLElement).className).toBe('test');
    expect((el as HTMLElement).textContent).toBe('Hello');
  });

  it('renders nested elements', () => {
    const el = (
      <div>
        <span>one</span>
        <span>two</span>
      </div>
    );
    expect((el as HTMLElement).children.length).toBe(2);
    expect((el as HTMLElement).children[0].textContent).toBe('one');
  });

  it('handles event handlers', () => {
    let clicked = false;
    const el = <button onClick={() => { clicked = true; }}>Click</button>;
    (el as HTMLElement).click();
    expect(clicked).toBe(true);
  });

  it('handles reactive attributes', () => {
    const [cls, setCls] = createSignal('a');
    let el!: HTMLDivElement;

    createRoot(() => {
      el = <div class={() => cls()}>text</div> as HTMLDivElement;
    });

    expect(el.className).toBe('a');
    setCls('b');
    expect(el.className).toBe('b');
  });

  it('handles reactive text children', () => {
    const [count, setCount] = createSignal(0);
    let el!: HTMLElement;

    createRoot(() => {
      el = <p>{() => count()}</p> as HTMLElement;
    });

    const container = document.createElement('div');
    container.appendChild(el);
    expect(el.textContent).toBe('0');
    setCount(42);
    expect(el.textContent).toBe('42');
  });

  it('renders Fragment', () => {
    const frag = (
      <>
        <span>a</span>
        <span>b</span>
      </>
    );
    expect(frag).toBeInstanceOf(DocumentFragment);
    expect(frag.childNodes.length).toBe(2);
  });

  it('handles boolean attributes', () => {
    const el = <input type="text" disabled required /> as HTMLInputElement;
    expect(el.disabled).toBe(true);
    expect(el.required).toBe(true);
  });

  it('handles data- attributes', () => {
    const el = <div data-id="123" data-active="true">test</div>;
    expect((el as HTMLElement).getAttribute('data-id')).toBe('123');
    expect((el as HTMLElement).getAttribute('data-active')).toBe('true');
  });

  it('handles ref callback', () => {
    let captured: HTMLElement | null = null;
    const el = <div ref={(el) => { captured = el; }}>test</div>;
    expect(captured).toBe(el);
  });

  it('renders SVG elements', () => {
    const el = (
      <svg viewBox="0 0 24 24">
        <path d="M12 2L2 22h20z" />
      </svg>
    );
    expect(el).toBeInstanceOf(SVGSVGElement);
    expect((el as unknown as SVGSVGElement).firstChild).toBeInstanceOf(SVGPathElement);
  });

  it('createShow works inside JSX', () => {
    const [show, setShow] = createSignal(true);
    let container!: HTMLDivElement;

    createRoot(() => {
      container = (
        <div>
          {createShow(show, () => <span>visible</span>)}
        </div>
      ) as HTMLDivElement;
    });

    document.body.appendChild(container);
    expect(container.querySelector('span')?.textContent).toBe('visible');

    setShow(false);
    expect(container.querySelector('span')).toBeNull();
    document.body.removeChild(container);
  });

  it('createList works inside JSX', () => {
    const items = ['a', 'b', 'c'];
    const [list] = createSignal(items);

    let container!: HTMLElement;
    createRoot(() => {
      container = (
        <ul>
          {createList(list, (item) => item, (item) =>
            <li>{item}</li> as HTMLElement
          )}
        </ul>
      ) as HTMLElement;
    });

    document.body.appendChild(container);
    expect(container.querySelectorAll('li').length).toBe(3);
    expect(container.querySelectorAll('li')[0].textContent).toBe('a');
    document.body.removeChild(container);
  });

  it('JSX and h() produce identical output', () => {
    const jsxEl = <div class="test"><span>hello</span></div>;
    const hEl = h('div', { class: 'test' }, h('span', null, 'hello'));
    expect((jsxEl as HTMLElement).outerHTML).toBe(hEl.outerHTML);
  });
});
