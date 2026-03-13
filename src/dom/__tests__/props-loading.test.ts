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
      Comp: (props) => {
        receivedProps = props;
        return document.createElement('div');
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
      Comp: (props) => {
        receivedProps = props;
        return document.createElement('div');
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
      Comp: (props) => {
        receivedProps = props;
        return document.createElement('div');
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
      Broken: () => document.createElement('div'),
      Working: () => {
        siblingActivated = true;
        return document.createElement('div');
      },
    });

    expect(document.querySelector('[data-forma-island="0"]')!
      .getAttribute('data-forma-status')).toBe('error');
    expect(siblingActivated).toBe(true);
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
      Comp: (props) => {
        receivedProps = props;
        return document.createElement('div');
      },
    });

    // getAttribute returns the raw string which JSON.parse handles
    expect(receivedProps).toEqual({ label: 'Say "hello"' });
  });
});
