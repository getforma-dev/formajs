/**
 * Props loading tests — inline attributes, script_tag block, no props.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

// We test loadIslandProps by testing activateIslands with different DOM setups.
import { activateIslands } from '../activate';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('props loading', () => {
  it('loads inline props from data-forma-props attribute', () => {
    let receivedProps: any = undefined;
    document.body.innerHTML = `
      <div data-forma-island="0"
           data-forma-component="Comp"
           data-forma-status="pending"
           data-forma-props='{"name":"Alice","count":42}'>
        <p>Content</p>
      </div>
    `;

    activateIslands({
      Comp: (el, props) => {
        receivedProps = props;
        return el;
      },
    });

    expect(receivedProps).toEqual({ name: 'Alice', count: 42 });
  });

  it('loads script_tag props from __forma_islands block', () => {
    let receivedProps: any = undefined;
    document.body.innerHTML = `
      <div data-forma-island="0"
           data-forma-component="Comp"
           data-forma-status="pending">
        <p>Content</p>
      </div>
      <script id="__forma_islands" type="application/json">{"0":{"items":[1,2,3]}}</script>
    `;

    activateIslands({
      Comp: (el, props) => {
        receivedProps = props;
        return el;
      },
    });

    expect(receivedProps).toEqual({ items: [1, 2, 3] });
  });

  it('returns null when no props source exists', () => {
    let receivedProps: any = 'not-called';
    document.body.innerHTML = `
      <div data-forma-island="0"
           data-forma-component="Comp"
           data-forma-status="pending">
        <p>Content</p>
      </div>
    `;

    activateIslands({
      Comp: (el, props) => {
        receivedProps = props;
        return el;
      },
    });

    expect(receivedProps).toBeNull();
  });

  it('malformed JSON in props fails island gracefully, sibling unaffected', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let siblingActivated = false;

    document.body.innerHTML = `
      <div data-forma-island="0"
           data-forma-component="Broken"
           data-forma-status="pending"
           data-forma-props='{bad json}'>
        <p>Broken</p>
      </div>
      <div data-forma-island="1"
           data-forma-component="Working"
           data-forma-status="pending">
        <p>Working</p>
      </div>
    `;

    activateIslands({
      Broken: (el) => el,
      // Wires its server DOM itself and returns its own element (2.0.1's
      // imperative pattern), so it activates like any working island.
      Working: (el) => {
        siblingActivated = true;
        return el;
      },
    });

    expect(document.querySelector('[data-forma-island="0"]')!
      .getAttribute('data-forma-status')).toBe('error');
    expect(siblingActivated).toBe(true);
    expect(document.querySelector('[data-forma-island="1"]')!
      .getAttribute('data-forma-status')).toBe('active');
    errorSpy.mockRestore();
  });

  it('HTML entity-encoded inline props decoded correctly', () => {
    let receivedProps: any;
    // Build DOM programmatically — innerHTML in jsdom does not decode
    // HTML entities in attribute values the same way browsers do,
    // so we use setAttribute which stores the raw decoded string.
    document.body.innerHTML = `
      <div data-forma-island="0"
           data-forma-component="Comp"
           data-forma-status="pending">
        <p>Content</p>
      </div>
    `;
    const island = document.querySelector('[data-forma-island]')!;
    island.setAttribute('data-forma-props', '{"label":"Say \\"hello\\""}');

    activateIslands({
      Comp: (el, props) => {
        receivedProps = props;
        return el;
      },
    });

    // getAttribute returns the raw string which JSON.parse handles
    expect(receivedProps).toEqual({ label: 'Say "hello"' });
  });

  it('props that are JSON but neither an object nor an array mark the island error with FORMA_E_ISLAND_PROPS', () => {
    // 2.0.1's shallow strip used `in`, which throws on these, so the island
    // was marked error; an array passed. The deep strip throws on nothing, so
    // activation checks the type, and says why with a code.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const inline = ['null', '7', '0', '"text"', 'true', 'false'];
    const shell = (i: number) =>
      `<div data-forma-island="${i}" data-forma-component="Comp" data-forma-status="pending"><p>${i}</p></div>`;
    document.body.innerHTML = Array.from({ length: 10 }, (_, i) => shell(i)).join('') +
      '<script id="__forma_islands" type="application/json">' +
      '{"6":null,"7":42,"9":{"ok":true,"nested":{"__proto__":{"x":1}}}}</script>';
    const island = (i: number) => document.querySelector(`[data-forma-island="${i}"]`)!;
    inline.forEach((json, i) => island(i).setAttribute('data-forma-props', json));
    island(8).setAttribute('data-forma-props', '[1,{"__proto__":{"x":1},"a":2}]');

    const received = new Map<number, unknown>();
    activateIslands({
      Comp: (el, props) => {
        received.set(Number(el.getAttribute('data-forma-island')), props);
        return el;
      },
    });

    // Six inline payloads and two shared ones: error, and the island never ran.
    for (let i = 0; i < 8; i++) {
      expect(island(i).getAttribute('data-forma-status'), `island ${i}`).toBe('error');
      expect(received.has(i), `island ${i} ran`).toBe(false);
    }
    // Two-sided: an array reaches its island, as in 2.0.1, stripped at every
    // depth; an object from the shared block too.
    expect(island(8).getAttribute('data-forma-status')).toBe('active');
    expect(received.get(8)).toEqual([1, { a: 2 }]);
    expect(Object.getOwnPropertyNames((received.get(8) as unknown[])[1])).toEqual(['a']);
    expect(island(9).getAttribute('data-forma-status')).toBe('active');
    expect(received.get(9)).toEqual({ ok: true, nested: {} });
    // Each refusal is logged once, with its code, the JSON type and the island.
    const logged = errorSpy.mock.calls.map((call) => String(call[0]));
    expect(logged.filter((m) => m.includes('FORMA_E_ISLAND_PROPS'))).toHaveLength(8);
    expect(logged).toContain(
      '[forma] FORMA_E_ISLAND_PROPS: island props must be a JSON object or array, not null (island "Comp", id=0)',
    );
    expect(logged).toContain(
      '[forma] FORMA_E_ISLAND_PROPS: island props must be a JSON object or array, not a number (island "Comp", id=7)',
    );
    expect(logged).toContain(
      '[forma] FORMA_E_ISLAND_PROPS: island props must be a JSON object or array, not a string (island "Comp", id=3)',
    );
    errorSpy.mockRestore();
  });
});
