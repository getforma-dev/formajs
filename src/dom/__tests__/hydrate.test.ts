import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSignal, createRoot } from 'forma/reactive';
import { mount } from '../mount';
import {
  hydrating,
  setHydrating,
  isDescriptor,
  isShowDescriptor,
  collectMarkers,
  applyDynamicProps,
  descriptorToElement,
  adoptNode,
  hydrateIsland,
  type HydrationDescriptor,
  type ShowDescriptor,
  type MarkerMap,
} from '../hydrate';

// ---------------------------------------------------------------------------
// Task 11: barrel export
// ---------------------------------------------------------------------------

describe('barrel exports', () => {
  it('exports hydrateIsland from dom/index', async () => {
    const domIndex = await import('../index');
    expect(typeof domIndex.hydrateIsland).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Task 1: Descriptor types and hydration state
// ---------------------------------------------------------------------------

describe('hydrating state', () => {
  it('defaults to false', () => {
    expect(hydrating).toBe(false);
  });

  it('can be toggled via setHydrating', () => {
    setHydrating(true);
    expect(hydrating).toBe(true);
    setHydrating(false);
    expect(hydrating).toBe(false);
  });
});

describe('isDescriptor', () => {
  it('returns true for a valid HydrationDescriptor', () => {
    const desc: HydrationDescriptor = {
      type: 'element',
      tag: 'div',
      props: null,
      children: [],
    };
    expect(isDescriptor(desc)).toBe(true);
  });

  it('returns false for null', () => {
    expect(isDescriptor(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isDescriptor(undefined)).toBe(false);
  });

  it('returns false for a string', () => {
    expect(isDescriptor('hello')).toBe(false);
  });

  it('returns false for a number', () => {
    expect(isDescriptor(42)).toBe(false);
  });

  it('returns false for a ShowDescriptor', () => {
    const show: ShowDescriptor = {
      type: 'show',
      condition: () => true,
      whenTrue: () => null,
      initialBranch: null,
    };
    expect(isDescriptor(show)).toBe(false);
  });

  it('returns false for a plain object with wrong type', () => {
    expect(isDescriptor({ type: 'other', tag: 'div' })).toBe(false);
  });

  it('returns true even with extra properties', () => {
    const desc = {
      type: 'element',
      tag: 'span',
      props: { class: 'foo' },
      children: ['text'],
      extra: true,
    };
    expect(isDescriptor(desc)).toBe(true);
  });
});

describe('isShowDescriptor', () => {
  it('returns true for a valid ShowDescriptor', () => {
    const desc: ShowDescriptor = {
      type: 'show',
      condition: () => true,
      whenTrue: () => null,
      initialBranch: null,
    };
    expect(isShowDescriptor(desc)).toBe(true);
  });

  it('returns false for null', () => {
    expect(isShowDescriptor(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isShowDescriptor(undefined)).toBe(false);
  });

  it('returns false for a HydrationDescriptor', () => {
    const desc: HydrationDescriptor = {
      type: 'element',
      tag: 'div',
      props: null,
      children: [],
    };
    expect(isShowDescriptor(desc)).toBe(false);
  });

  it('returns false for a plain object with wrong type', () => {
    expect(isShowDescriptor({ type: 'element' })).toBe(false);
  });

  it('returns true with optional whenFalse', () => {
    const desc: ShowDescriptor = {
      type: 'show',
      condition: () => true,
      whenTrue: () => 'yes',
      whenFalse: () => 'no',
      initialBranch: 'yes',
    };
    expect(isShowDescriptor(desc)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Task 2: collectMarkers
// ---------------------------------------------------------------------------

describe('collectMarkers', () => {
  it('collects a single text marker', () => {
    const root = document.createElement('div');
    root.innerHTML = '<!--f:t0-->Hello<!--other-->';

    const markers = collectMarkers(root);
    expect(markers.text.size).toBe(1);
    expect(markers.text.get(0)).toBeInstanceOf(Text);
    expect(markers.text.get(0)!.data).toBe('Hello');
    expect(markers.show.size).toBe(0);
  });

  it('collects multiple text markers', () => {
    const root = document.createElement('div');
    root.innerHTML = '<!--f:t0-->First<!--f:t1-->Second';

    const markers = collectMarkers(root);
    expect(markers.text.size).toBe(2);
    expect(markers.text.get(0)!.data).toBe('First');
    expect(markers.text.get(1)!.data).toBe('Second');
  });

  it('collects show markers', () => {
    const root = document.createElement('div');
    root.innerHTML = '<!--f:s0--><span>content</span><!--/f:s0-->';

    const markers = collectMarkers(root);
    expect(markers.show.size).toBe(1);
    const entry = markers.show.get(0)!;
    expect(entry.start).toBeInstanceOf(Comment);
    expect(entry.end).toBeInstanceOf(Comment);
    expect((entry.start as Comment).data).toBe('f:s0');
    expect((entry.end as Comment).data).toBe('/f:s0');
    expect(entry.cachedContent).toBeNull();
  });

  it('collects interleaved text and show markers', () => {
    const root = document.createElement('div');
    root.innerHTML = '<!--f:t0-->Name<!--f:s0--><b>visible</b><!--/f:s0--><!--f:t1-->Age';

    const markers = collectMarkers(root);
    expect(markers.text.size).toBe(2);
    expect(markers.text.get(0)!.data).toBe('Name');
    expect(markers.text.get(1)!.data).toBe('Age');
    expect(markers.show.size).toBe(1);
    expect(markers.show.get(0)!.start.data).toBe('f:s0');
  });

  it('returns empty maps for a container with no markers', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>Just plain HTML</p>';

    const markers = collectMarkers(root);
    expect(markers.text.size).toBe(0);
    expect(markers.show.size).toBe(0);
  });

  it('handles text marker without a following text node', () => {
    const root = document.createElement('div');
    root.innerHTML = '<!--f:t0--><span>not a text node</span>';

    const markers = collectMarkers(root);
    // The marker comment exists but no text node follows it directly
    expect(markers.text.size).toBe(0);
  });

  it('handles show opening marker without closing marker', () => {
    const root = document.createElement('div');
    root.innerHTML = '<!--f:s0--><span>orphan</span>';

    const markers = collectMarkers(root);
    expect(markers.show.size).toBe(0);
  });

  it('collects multiple show markers with correct pairing', () => {
    const root = document.createElement('div');
    root.innerHTML = '<!--f:s0-->A<!--/f:s0--><!--f:s1-->B<!--/f:s1-->';

    const markers = collectMarkers(root);
    expect(markers.show.size).toBe(2);
    expect(markers.show.get(0)!.start.data).toBe('f:s0');
    expect(markers.show.get(0)!.end.data).toBe('/f:s0');
    expect(markers.show.get(1)!.start.data).toBe('f:s1');
    expect(markers.show.get(1)!.end.data).toBe('/f:s1');
  });
});

// ---------------------------------------------------------------------------
// Task 3: applyDynamicProps
// ---------------------------------------------------------------------------

describe('applyDynamicProps', () => {
  it('attaches event handlers via addEventListener', () => {
    const el = document.createElement('button');
    const handler = vi.fn();

    applyDynamicProps(el, { onClick: handler });

    el.click();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('attaches multiple event handlers', () => {
    const el = document.createElement('input');
    const clickHandler = vi.fn();
    const focusHandler = vi.fn();

    applyDynamicProps(el, { onClick: clickHandler, onFocus: focusHandler });

    el.click();
    expect(clickHandler).toHaveBeenCalledTimes(1);

    el.dispatchEvent(new Event('focus'));
    expect(focusHandler).toHaveBeenCalledTimes(1);
  });

  it('skips static (non-function) props', () => {
    const el = document.createElement('div');
    el.setAttribute('class', 'original');

    applyDynamicProps(el, { class: 'should-not-change', id: 'myid', 'data-x': 42 });

    // Static props should not be applied — they are already in SSR HTML
    expect(el.getAttribute('class')).toBe('original');
  });

  it('creates reactive attribute bindings for non-event functions', () => {
    const el = document.createElement('div');

    createRoot(() => {
      const [value, setValue] = createSignal('initial');
      applyDynamicProps(el, { 'data-state': value });

      expect(el.getAttribute('data-state')).toBe('initial');

      setValue('updated');
      expect(el.getAttribute('data-state')).toBe('updated');
    });
  });

  it('removes attribute when reactive value returns false', () => {
    const el = document.createElement('div');
    el.setAttribute('hidden', '');

    createRoot(() => {
      const [show] = createSignal(false);
      applyDynamicProps(el, { hidden: show });

      // false causes removeAttribute
      expect(el.hasAttribute('hidden')).toBe(false);
    });
  });

  it('removes attribute when reactive value returns null', () => {
    const el = document.createElement('div');
    el.setAttribute('title', 'old');

    createRoot(() => {
      const [title, setTitle] = createSignal<string | null>('hello');
      applyDynamicProps(el, { title: title });

      expect(el.getAttribute('title')).toBe('hello');

      setTitle(null);
      expect(el.hasAttribute('title')).toBe(false);
    });
  });

  it('sets empty attribute when reactive value returns true', () => {
    const el = document.createElement('div');

    createRoot(() => {
      const [disabled] = createSignal(true);
      applyDynamicProps(el, { disabled: disabled });

      expect(el.getAttribute('disabled')).toBe('');
    });
  });

  it('handles null props gracefully', () => {
    const el = document.createElement('div');
    expect(() => applyDynamicProps(el, null)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Task 4: descriptorToElement
// ---------------------------------------------------------------------------

describe('descriptorToElement', () => {
  it('converts a simple descriptor to a DOM element', () => {
    const desc: HydrationDescriptor = {
      type: 'element',
      tag: 'div',
      props: { class: 'card' },
      children: ['Hello'],
    };

    const el = descriptorToElement(desc);
    expect(el.tagName).toBe('DIV');
    expect(el.getAttribute('class')).toBe('card');
    expect(el.textContent).toBe('Hello');
  });

  it('converts nested descriptors recursively', () => {
    const desc: HydrationDescriptor = {
      type: 'element',
      tag: 'div',
      props: null,
      children: [
        {
          type: 'element' as const,
          tag: 'span',
          props: { class: 'inner' },
          children: ['Nested'],
        },
      ],
    };

    const el = descriptorToElement(desc);
    expect(el.tagName).toBe('DIV');
    expect(el.children.length).toBe(1);
    expect(el.children[0]!.tagName).toBe('SPAN');
    expect(el.children[0]!.getAttribute('class')).toBe('inner');
    expect(el.children[0]!.textContent).toBe('Nested');
  });

  it('attaches event handlers from props', () => {
    const handler = vi.fn();
    const desc: HydrationDescriptor = {
      type: 'element',
      tag: 'button',
      props: { onClick: handler },
      children: ['Click me'],
    };

    const el = descriptorToElement(desc);
    expect(el.tagName).toBe('BUTTON');
    (el as HTMLButtonElement).click();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('passes function children through (reactive text)', () => {
    createRoot(() => {
      const [name] = createSignal('World');
      const desc: HydrationDescriptor = {
        type: 'element',
        tag: 'span',
        props: null,
        children: [name],
      };

      const el = descriptorToElement(desc);
      expect(el.tagName).toBe('SPAN');
      expect(el.textContent).toBe('World');
    });
  });

  it('restores hydrating state after conversion', () => {
    setHydrating(true);
    expect(hydrating).toBe(true);

    const desc: HydrationDescriptor = {
      type: 'element',
      tag: 'div',
      props: null,
      children: [],
    };

    descriptorToElement(desc);

    // hydrating should be restored to true
    expect(hydrating).toBe(true);
    setHydrating(false);
  });

  it('handles descriptors with null props', () => {
    const desc: HydrationDescriptor = {
      type: 'element',
      tag: 'br',
      props: null,
      children: [],
    };

    const el = descriptorToElement(desc);
    expect(el.tagName).toBe('BR');
  });

  it('handles deeply nested descriptors', () => {
    const desc: HydrationDescriptor = {
      type: 'element',
      tag: 'div',
      props: null,
      children: [
        {
          type: 'element' as const,
          tag: 'ul',
          props: null,
          children: [
            {
              type: 'element' as const,
              tag: 'li',
              props: null,
              children: ['Item 1'],
            },
            {
              type: 'element' as const,
              tag: 'li',
              props: null,
              children: ['Item 2'],
            },
          ],
        },
      ],
    };

    const el = descriptorToElement(desc);
    expect(el.tagName).toBe('DIV');
    const ul = el.children[0]!;
    expect(ul.tagName).toBe('UL');
    expect(ul.children.length).toBe(2);
    expect(ul.children[0]!.textContent).toBe('Item 1');
    expect(ul.children[1]!.textContent).toBe('Item 2');
  });
});

// ---------------------------------------------------------------------------
// Task 5: adoptNode
// ---------------------------------------------------------------------------

describe('adoptNode', () => {
  it('adopts matching SSR element and attaches event handlers', () => {
    const handler = vi.fn();
    const desc: HydrationDescriptor = {
      type: 'element',
      tag: 'button',
      props: { onClick: handler },
      children: [],
    };

    const ssrEl = document.createElement('button');
    ssrEl.textContent = 'Click me';

    adoptNode(desc, ssrEl);

    ssrEl.click();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('recurses into nested children', () => {
    const innerHandler = vi.fn();
    const desc: HydrationDescriptor = {
      type: 'element',
      tag: 'div',
      props: null,
      children: [
        {
          type: 'element' as const,
          tag: 'span',
          props: { onClick: innerHandler },
          children: [],
        },
      ],
    };

    const ssrEl = document.createElement('div');
    const ssrSpan = document.createElement('span');
    ssrSpan.textContent = 'inner';
    ssrEl.appendChild(ssrSpan);

    adoptNode(desc, ssrEl);

    ssrSpan.click();
    expect(innerHandler).toHaveBeenCalledTimes(1);
  });

  it('binds reactive text to SSR text marker nodes', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      const [text, setText] = createSignal('hello');
      const desc: HydrationDescriptor = {
        type: 'element',
        tag: 'div',
        props: null,
        children: [text],
      };

      // SSR DOM with text marker: <!--f:t0-->hello<!--/f:t0-->
      const ssrEl = document.createElement('div');
      ssrEl.appendChild(document.createComment('f:t0'));
      const textNode = document.createTextNode('hello');
      ssrEl.appendChild(textNode);
      ssrEl.appendChild(document.createComment('/f:t0'));

      adoptNode(desc, ssrEl);

      expect(textNode.data).toBe('hello');

      setText('world');
      expect(textNode.data).toBe('world');
    });

    dispose?.();
  });

  it('binds reactive text to SSR show marker nodes', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      const [text, setText] = createSignal('Show');
      const label = () => text();
      const desc: HydrationDescriptor = {
        type: 'element',
        tag: 'button',
        props: null,
        children: [label],
      };

      // SSR DOM with show marker (IR emits ShowIf for inline ternaries):
      // <!--f:s5-->Show<!--/f:s5-->
      const ssrEl = document.createElement('button');
      ssrEl.appendChild(document.createComment('f:s5'));
      const textNode = document.createTextNode('Show');
      ssrEl.appendChild(textNode);
      ssrEl.appendChild(document.createComment('/f:s5'));

      adoptNode(desc, ssrEl);

      expect(textNode.data).toBe('Show');

      setText('Hide');
      expect(textNode.data).toBe('Hide');
    });

    dispose?.();
  });

  it('handles interleaved elements and reactive text', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      const [dyn] = createSignal('dynamic');
      const desc: HydrationDescriptor = {
        type: 'element',
        tag: 'div',
        props: null,
        children: [
          { type: 'element' as const, tag: 'span', props: null, children: [] },
          dyn,
          { type: 'element' as const, tag: 'p', props: null, children: [] },
        ],
      };

      const ssrEl = document.createElement('div');
      const ssrSpan = document.createElement('span');
      const textNode = document.createTextNode('dynamic');
      const ssrP = document.createElement('p');
      ssrEl.appendChild(ssrSpan);
      ssrEl.appendChild(document.createComment('f:t0'));
      ssrEl.appendChild(textNode);
      ssrEl.appendChild(document.createComment('/f:t0'));
      ssrEl.appendChild(ssrP);

      adoptNode(desc, ssrEl);

      // span is children[0], p is children[1] (element index)
      expect(ssrEl.children[0]!.tagName).toBe('SPAN');
      expect(ssrEl.children[1]!.tagName).toBe('P');
      expect(textNode.data).toBe('dynamic');
    });

    dispose?.();
  });

  it('warns and replaces on tag mismatch', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const desc: HydrationDescriptor = {
      type: 'element',
      tag: 'div',
      props: { class: 'replacement' },
      children: ['Replaced'],
    };

    const parent = document.createElement('section');
    const ssrEl = document.createElement('span'); // wrong tag
    parent.appendChild(ssrEl);

    adoptNode(desc, ssrEl);

    expect(warnSpy).toHaveBeenCalledWith(
      'Hydration mismatch: expected <div>, got <span>',
    );

    // The span should have been replaced with a div
    expect(parent.children[0]!.tagName).toBe('DIV');
    expect(parent.children[0]!.textContent).toBe('Replaced');

    warnSpy.mockRestore();
  });

  it('handles missing SSR element gracefully', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const desc: HydrationDescriptor = {
      type: 'element',
      tag: 'div',
      props: null,
      children: [],
    };

    adoptNode(desc, undefined);

    expect(warnSpy).toHaveBeenCalledWith(
      'Hydration mismatch: expected <div>, got <nothing>',
    );

    warnSpy.mockRestore();
  });

  it('skips static string children', () => {
    const desc: HydrationDescriptor = {
      type: 'element',
      tag: 'div',
      props: null,
      children: ['static text', 'another string', 42],
    };

    const ssrEl = document.createElement('div');
    ssrEl.textContent = 'static text';

    // Should not throw
    adoptNode(desc, ssrEl);
  });

  it('skips falsy children (false, null, undefined)', () => {
    const desc: HydrationDescriptor = {
      type: 'element',
      tag: 'div',
      props: null,
      children: [false, null, undefined],
    };

    const ssrEl = document.createElement('div');

    // Should not throw
    adoptNode(desc, ssrEl);
  });

  it('creates real DOM for island marker regions', () => {
    const handler = vi.fn();
    const desc: HydrationDescriptor = {
      type: 'element',
      tag: 'div',
      props: null,
      children: [
        { type: 'element' as const, tag: 'h2', props: null, children: ['Title'] },
        { type: 'element' as const, tag: 'div', props: { class: 'alert', onClick: handler }, children: ['Error'] },
        { type: 'element' as const, tag: 'form', props: null, children: [] },
      ],
    };

    // SSR DOM: <div><h2>Title</h2><!--f:i0--><!--/f:i0--><form></form></div>
    const ssrEl = document.createElement('div');
    const h2 = document.createElement('h2');
    h2.textContent = 'Title';
    ssrEl.appendChild(h2);
    ssrEl.appendChild(document.createComment('f:i0'));
    ssrEl.appendChild(document.createComment('/f:i0'));
    const form = document.createElement('form');
    ssrEl.appendChild(form);

    adoptNode(desc, ssrEl);

    // h2 adopted
    expect(ssrEl.querySelector('h2')!.textContent).toBe('Title');
    // Alert created fresh between island markers
    const alert = ssrEl.querySelector('.alert')!;
    expect(alert).toBeTruthy();
    expect(alert.textContent).toBe('Error');
    (alert as HTMLElement).click();
    expect(handler).toHaveBeenCalledTimes(1);
    // Form adopted
    expect(ssrEl.querySelector('form')).toBe(form);
  });

  it('creates text node for empty text markers and binds reactive effect', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      // SSR HTML: <div><!--f:t0--><!--/f:t0--></div> (no text node — empty initial value)
      const ssrEl = document.createElement('div');
      ssrEl.appendChild(document.createComment('f:t0'));
      ssrEl.appendChild(document.createComment('/f:t0'));

      const [msg, setMsg] = createSignal<string | null>(null);

      const desc: HydrationDescriptor = {
        type: 'element',
        tag: 'div',
        props: null,
        children: [() => msg() || ''],
      };

      adoptNode(desc, ssrEl);

      // A text node should have been created between the markers
      const startMarker = ssrEl.childNodes[0];
      const textNode = ssrEl.childNodes[1];
      expect(textNode.nodeType).toBe(3); // Text node
      expect((textNode as Text).data).toBe('');

      // Update the signal — text should update reactively
      setMsg('Error occurred');
      expect((textNode as Text).data).toBe('Error occurred');
    });

    dispose?.();
  });

  it('creates text node for empty show markers used as reactive text', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      // SSR HTML: <div><!--f:s5--><!--/f:s5--></div> (no text node — empty initial value)
      const ssrEl = document.createElement('div');
      ssrEl.appendChild(document.createComment('f:s5'));
      ssrEl.appendChild(document.createComment('/f:s5'));

      const [msg, setMsg] = createSignal<string | null>(null);

      const desc: HydrationDescriptor = {
        type: 'element',
        tag: 'div',
        props: null,
        children: [() => msg() || ''],
      };

      adoptNode(desc, ssrEl);

      // A text node should have been created between the markers
      const textNode = ssrEl.childNodes[1];
      expect(textNode.nodeType).toBe(3);
      expect((textNode as Text).data).toBe('');

      // Update — should bind reactively
      setMsg('Something happened');
      expect((textNode as Text).data).toBe('Something happened');
    });

    dispose?.();
  });

  it('handles multiple adjacent island markers', () => {
    const desc: HydrationDescriptor = {
      type: 'element',
      tag: 'div',
      props: null,
      children: [
        { type: 'element' as const, tag: 'div', props: { class: 'alert-error' }, children: [] },
        { type: 'element' as const, tag: 'div', props: { class: 'alert-info' }, children: [] },
      ],
    };

    const ssrEl = document.createElement('div');
    ssrEl.appendChild(document.createComment('f:i0'));
    ssrEl.appendChild(document.createComment('/f:i0'));
    ssrEl.appendChild(document.createComment('f:i1'));
    ssrEl.appendChild(document.createComment('/f:i1'));

    adoptNode(desc, ssrEl);

    expect(ssrEl.querySelector('.alert-error')).toBeTruthy();
    expect(ssrEl.querySelector('.alert-info')).toBeTruthy();
  });
});

describe('adoptNode reactive text in empty parent', () => {
  it('creates text node when SSR element has no children at all', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      // SSR HTML: <div class="toast"></div> (completely empty, no markers)
      const ssrEl = document.createElement('div');
      ssrEl.className = 'toast';

      const [msg, setMsg] = createSignal<string | null>(null);

      const desc: HydrationDescriptor = {
        type: 'element',
        tag: 'div',
        props: { class: () => msg() ? 'toast show' : 'toast' },
        children: [() => msg() ? msg() : ''],
      };

      adoptNode(desc, ssrEl);

      // A text node should have been created
      expect(ssrEl.childNodes.length).toBe(1);
      expect(ssrEl.childNodes[0].nodeType).toBe(3);
      expect((ssrEl.childNodes[0] as Text).data).toBe('');

      // Reactive update should work
      setMsg('Operation failed');
      expect((ssrEl.childNodes[0] as Text).data).toBe('Operation failed');
      expect(ssrEl.className).toBe('toast show');
    });

    dispose?.();
  });
});

// ---------------------------------------------------------------------------
// Task 6: h() descriptor branch
// ---------------------------------------------------------------------------

import { h } from '../element';
import { createShow } from '../show';

// ---------------------------------------------------------------------------
// Task 7: createShow hydration path
// ---------------------------------------------------------------------------

describe('createShow hydration path', () => {
  afterEach(() => {
    setHydrating(false);
  });

  it('returns a DocumentFragment when not hydrating', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;
      const result = createShow(() => true, () => document.createElement('span'));
      expect(result).toBeInstanceOf(DocumentFragment);
    });

    dispose?.();
  });

  it('returns a ShowDescriptor when hydrating', () => {
    setHydrating(true);

    const condition = () => true;
    const whenTrue = () => h('span', null, 'yes');
    const whenFalse = () => h('span', null, 'no');

    const result = createShow(condition, whenTrue, whenFalse);

    // It's not a real DocumentFragment
    expect(result).not.toBeInstanceOf(DocumentFragment);

    const desc = result as unknown as ShowDescriptor;
    expect(desc.type).toBe('show');
    expect(desc.condition).toBe(condition);
    expect(desc.whenTrue).toBe(whenTrue);
    expect(desc.whenFalse).toBe(whenFalse);
  });

  it('evaluates initial true branch in ShowDescriptor', () => {
    setHydrating(true);

    const result = createShow(
      () => true,
      () => h('span', { class: 'visible' }, 'yes'),
      () => h('span', null, 'no'),
    );

    const desc = result as unknown as ShowDescriptor;
    expect(desc.initialBranch).not.toBeNull();

    // During hydration, h() returns a descriptor
    const branch = desc.initialBranch as HydrationDescriptor;
    expect(branch.type).toBe('element');
    expect(branch.tag).toBe('span');
    expect(branch.props).toEqual({ class: 'visible' });
    expect(branch.children).toEqual(['yes']);
  });

  it('evaluates false branch when condition is false', () => {
    setHydrating(true);

    const result = createShow(
      () => false,
      () => h('span', null, 'yes'),
      () => h('div', { class: 'fallback' }, 'no'),
    );

    const desc = result as unknown as ShowDescriptor;
    const branch = desc.initialBranch as HydrationDescriptor;
    expect(branch.type).toBe('element');
    expect(branch.tag).toBe('div');
    expect(branch.props).toEqual({ class: 'fallback' });
    expect(branch.children).toEqual(['no']);
  });

  it('initialBranch is null when condition false and no elseFn', () => {
    setHydrating(true);

    const result = createShow(
      () => false,
      () => h('span', null, 'yes'),
    );

    const desc = result as unknown as ShowDescriptor;
    expect(desc.initialBranch).toBeNull();
  });
});

describe('h() descriptor branch', () => {
  afterEach(() => {
    setHydrating(false);
  });

  it('returns a real DOM element when not hydrating', () => {
    const el = h('div', { class: 'real' }, 'Hello');
    expect(el).toBeInstanceOf(HTMLElement);
    expect(el.tagName).toBe('DIV');
    expect(el.textContent).toBe('Hello');
  });

  it('returns a descriptor when hydrating is true', () => {
    setHydrating(true);
    const result = h('div', { class: 'card' }, 'text');

    // It's not a real element
    expect(result).not.toBeInstanceOf(HTMLElement);

    // It's a descriptor object
    const desc = result as unknown as HydrationDescriptor;
    expect(desc.type).toBe('element');
    expect(desc.tag).toBe('div');
    expect(desc.props).toEqual({ class: 'card' });
    expect(desc.children).toEqual(['text']);
  });

  it('builds nested descriptor tree during hydration', () => {
    setHydrating(true);

    const result = h('div', null,
      h('span', { class: 'inner' }, 'Nested'),
      h('p', null, 'Para'),
    );

    const desc = result as unknown as HydrationDescriptor;
    expect(desc.type).toBe('element');
    expect(desc.tag).toBe('div');
    expect(desc.children.length).toBe(2);

    const span = desc.children[0] as HydrationDescriptor;
    expect(span.type).toBe('element');
    expect(span.tag).toBe('span');
    expect(span.props).toEqual({ class: 'inner' });
    expect(span.children).toEqual(['Nested']);

    const p = desc.children[1] as HydrationDescriptor;
    expect(p.type).toBe('element');
    expect(p.tag).toBe('p');
    expect(p.children).toEqual(['Para']);
  });

  it('preserves function children in descriptor', () => {
    setHydrating(true);

    const getter = () => 'dynamic';
    const result = h('div', null, getter);

    const desc = result as unknown as HydrationDescriptor;
    expect(desc.children.length).toBe(1);
    expect(desc.children[0]).toBe(getter);
    expect(typeof desc.children[0]).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Task 8: adoptNode show descriptor handling
// ---------------------------------------------------------------------------

describe('adoptNode show descriptor handling', () => {
  it('adopts show descriptor initial branch from SSR markers', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      const handler = vi.fn();

      // Build SSR DOM: <div><!--f:s0--><span>content</span><!--/f:s0--></div>
      const ssrEl = document.createElement('div');
      const startComment = document.createComment('f:s0');
      const ssrSpan = document.createElement('span');
      ssrSpan.textContent = 'content';
      const endComment = document.createComment('/f:s0');
      ssrEl.appendChild(startComment);
      ssrEl.appendChild(ssrSpan);
      ssrEl.appendChild(endComment);

      // Descriptor: div with a show descriptor child whose initial branch is a span
      const showDesc: ShowDescriptor = {
        type: 'show',
        condition: () => true,
        whenTrue: () => document.createElement('span'),
        initialBranch: {
          type: 'element' as const,
          tag: 'span',
          props: { onClick: handler },
          children: [],
        },
      };

      const desc: HydrationDescriptor = {
        type: 'element',
        tag: 'div',
        props: null,
        children: [showDesc],
      };

      adoptNode(desc, ssrEl);

      // The event handler should be attached to the SSR span
      ssrSpan.click();
      expect(handler).toHaveBeenCalledTimes(1);
    });

    dispose?.();
  });

  it('handles empty initial branch (condition false, no else)', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      // Build SSR DOM: <div><!--f:s0--><!--/f:s0--></div>
      const ssrEl = document.createElement('div');
      const startComment = document.createComment('f:s0');
      const endComment = document.createComment('/f:s0');
      ssrEl.appendChild(startComment);
      ssrEl.appendChild(endComment);

      const showDesc: ShowDescriptor = {
        type: 'show',
        condition: () => false,
        whenTrue: () => document.createElement('span'),
        initialBranch: null,
      };

      const desc: HydrationDescriptor = {
        type: 'element',
        tag: 'div',
        props: null,
        children: [showDesc],
      };

      adoptNode(desc, ssrEl);

      // The markers should still be in place
      expect(ssrEl.contains(startComment)).toBe(true);
      expect(ssrEl.contains(endComment)).toBe(true);
    });

    dispose?.();
  });

  it('global counters increment correctly across multiple show descriptors', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      const handler1 = vi.fn();
      const handler2 = vi.fn();

      // Build SSR DOM: <div><!--f:s0--><span>A</span><!--/f:s0--><!--f:s1--><span>B</span><!--/f:s1--></div>
      const ssrEl = document.createElement('div');

      const start0 = document.createComment('f:s0');
      const span0 = document.createElement('span');
      span0.textContent = 'A';
      const end0 = document.createComment('/f:s0');

      const start1 = document.createComment('f:s1');
      const span1 = document.createElement('span');
      span1.textContent = 'B';
      const end1 = document.createComment('/f:s1');

      ssrEl.appendChild(start0);
      ssrEl.appendChild(span0);
      ssrEl.appendChild(end0);
      ssrEl.appendChild(start1);
      ssrEl.appendChild(span1);
      ssrEl.appendChild(end1);

      const showDesc0: ShowDescriptor = {
        type: 'show',
        condition: () => true,
        whenTrue: () => document.createElement('span'),
        initialBranch: {
          type: 'element' as const,
          tag: 'span',
          props: { onClick: handler1 },
          children: [],
        },
      };

      const showDesc1: ShowDescriptor = {
        type: 'show',
        condition: () => true,
        whenTrue: () => document.createElement('span'),
        initialBranch: {
          type: 'element' as const,
          tag: 'span',
          props: { onClick: handler2 },
          children: [],
        },
      };

      const desc: HydrationDescriptor = {
        type: 'element',
        tag: 'div',
        props: null,
        children: [showDesc0, showDesc1],
      };

      adoptNode(desc, ssrEl);

      // Both handlers should be attached to their respective SSR spans
      span0.click();
      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).not.toHaveBeenCalled();

      span1.click();
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    dispose?.();
  });
});

// ---------------------------------------------------------------------------
// Task 9: hydrateIsland — full orchestration
// ---------------------------------------------------------------------------

describe('hydrateIsland', () => {
  it('hydrates SSR HTML with event handlers', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      // Build SSR container with data-forma-ssr
      const container = document.createElement('div');
      container.setAttribute('data-forma-ssr', '');
      const ssrButton = document.createElement('button');
      ssrButton.textContent = 'Click me';
      container.appendChild(ssrButton);

      const handler = vi.fn();

      hydrateIsland(
        () => h('button', { onClick: handler }, 'Click me'),
        container,
      );

      // data-forma-ssr attribute should be removed
      expect(container.hasAttribute('data-forma-ssr')).toBe(false);

      // SAME button element preserved (not replaced)
      expect(container.children[0]).toBe(ssrButton);

      // Event handler is now attached
      ssrButton.click();
      expect(handler).toHaveBeenCalledTimes(1);
    });

    dispose?.();
  });

  it('hydrates reactive text bindings', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      // Build SSR container: <div data-forma-ssr><p><!--f:t0-->Hello</p></div>
      const container = document.createElement('div');
      container.setAttribute('data-forma-ssr', '');
      const p = document.createElement('p');
      p.appendChild(document.createComment('f:t0'));
      const textNode = document.createTextNode('Hello');
      p.appendChild(textNode);
      container.appendChild(p);

      const [text, setText] = createSignal('Hello');

      hydrateIsland(
        () => h('p', null, text),
        container,
      );

      expect(textNode.data).toBe('Hello');

      // Reactive update changes the SSR text node
      setText('World');
      expect(textNode.data).toBe('World');
    });

    dispose?.();
  });

  it('hydrates reactive attribute bindings', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      // Build SSR container: <div data-forma-ssr><input type="password"></div>
      const container = document.createElement('div');
      container.setAttribute('data-forma-ssr', '');
      const input = document.createElement('input');
      input.setAttribute('type', 'password');
      container.appendChild(input);

      const [inputType, setInputType] = createSignal('password');

      hydrateIsland(
        () => h('input', { type: inputType }),
        container,
      );

      expect(input.getAttribute('type')).toBe('password');

      // Toggle type via signal
      setInputType('text');
      expect(input.getAttribute('type')).toBe('text');
    });

    dispose?.();
  });

  it('h() returns real elements after hydration completes', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      const container = document.createElement('div');
      container.setAttribute('data-forma-ssr', '');
      const ssrSpan = document.createElement('span');
      ssrSpan.textContent = 'hi';
      container.appendChild(ssrSpan);

      hydrateIsland(
        () => h('span', null, 'hi'),
        container,
      );

      // After hydration, hydrating should be false
      expect(hydrating).toBe(false);

      // h() should now return a real element
      const el = h('div', { class: 'post-hydration' }, 'real');
      expect(el).toBeInstanceOf(HTMLElement);
      expect(el.tagName).toBe('DIV');
      expect(el.textContent).toBe('real');
    });

    dispose?.();
  });

  it('full integration: event → signal → reactive text update', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      // Build SSR: <div data-forma-ssr><button><!--f:t0-->Create Account</button></div>
      const container = document.createElement('div');
      container.setAttribute('data-forma-ssr', '');
      const ssrButton = document.createElement('button');
      ssrButton.appendChild(document.createComment('f:t0'));
      ssrButton.appendChild(document.createTextNode('Create Account'));
      container.appendChild(ssrButton);

      const [submitting, setSubmitting] = createSignal(false);
      const label = () => submitting() ? 'Creating...' : 'Create Account';

      hydrateIsland(
        () => h('button', { onClick: () => setSubmitting(true) }, label),
        container,
      );

      // Initial state
      expect(ssrButton.textContent).toContain('Create Account');

      // Click the button — triggers signal change
      ssrButton.click();

      // Text should now be updated reactively
      const textNode = ssrButton.childNodes[1] as Text;
      expect(textNode.data).toBe('Creating...');
    });

    dispose?.();
  });
});

// ---------------------------------------------------------------------------
// Task 12: Complex hydration scenarios
// ---------------------------------------------------------------------------

describe('complex hydration scenarios', () => {
  it('form with submit handler, reactive button text, password toggle', () => {
    // Container simulates SSR HTML from Rust walker
    const container = document.createElement('div');
    container.setAttribute('data-forma-ssr', '');
    container.innerHTML = [
      '<div class="page">',
        '<form class="auth-form">',
          '<div class="field">',
            '<label>Email</label>',
            '<input type="email" placeholder="you@company.com">',
          '</div>',
          '<div class="field">',
            '<label>Password</label>',
            '<div class="password-wrap">',
              '<input type="password" placeholder="At least 8 chars">',
              '<button type="button"><!--f:t0-->Show<!--/f:t0--></button>',
            '</div>',
          '</div>',
          '<button type="submit" class="btn-primary"><!--f:t1-->Create Account<!--/f:t1--></button>',
        '</form>',
      '</div>',
    ].join('');

    const ssrForm = container.querySelector('form')!;
    const ssrPasswordInput = container.querySelectorAll('input')[1]!;
    const ssrToggleBtn = container.querySelector('.password-wrap button')!;
    const ssrSubmitBtn = container.querySelector('.btn-primary')!;

    const [submitting, setSubmitting] = createSignal(false);
    const [showPwd, setShowPwd] = createSignal(false);
    let formSubmitted = false;

    const unmount = mount(
      () => h('div', { class: 'page' },
        h('form', {
          class: 'auth-form',
          onSubmit: (e: Event) => { e.preventDefault(); formSubmitted = true; setSubmitting(true); },
        },
          h('div', { class: 'field' },
            h('label', null, 'Email'),
            h('input', { type: 'email', placeholder: 'you@company.com' }),
          ),
          h('div', { class: 'field' },
            h('label', null, 'Password'),
            h('div', { class: 'password-wrap' },
              h('input', {
                type: () => showPwd() ? 'text' : 'password',
                placeholder: 'At least 8 chars',
              }),
              h('button', {
                type: 'button',
                onClick: () => setShowPwd(!showPwd()),
              }, () => showPwd() ? 'Hide' : 'Show'),
            ),
          ),
          h('button', {
            type: 'submit',
            class: 'btn-primary',
            disabled: submitting,
          }, () => submitting() ? 'Creating...' : 'Create Account'),
        ),
      ),
      container,
    );

    // 1. SSR elements preserved
    expect(container.querySelector('form')).toBe(ssrForm);
    expect(container.querySelectorAll('input')[1]).toBe(ssrPasswordInput);
    expect(container.hasAttribute('data-forma-ssr')).toBe(false);

    // 2. Password toggle
    expect(ssrPasswordInput.getAttribute('type')).toBe('password');
    ssrToggleBtn.dispatchEvent(new Event('click'));
    expect(ssrPasswordInput.getAttribute('type')).toBe('text');
    expect(ssrToggleBtn.textContent).toContain('Hide');
    ssrToggleBtn.dispatchEvent(new Event('click'));
    expect(ssrPasswordInput.getAttribute('type')).toBe('password');
    expect(ssrToggleBtn.textContent).toContain('Show');

    // 3. Submit → reactive text update
    ssrForm.dispatchEvent(new Event('submit'));
    expect(formSubmitted).toBe(true);
    expect(ssrSubmitBtn.textContent).toContain('Creating...');

    unmount();
  });

  it('hydration with createShow conditional content', () => {
    const container = document.createElement('div');
    container.setAttribute('data-forma-ssr', '');
    container.innerHTML = '<div><!--f:s0--><div class="oauth"><button>Google</button></div><!--/f:s0--><form><button>Submit</button></form></div>';

    const ssrOAuthDiv = container.querySelector('.oauth')!;
    let oauthClicked = false;
    let submitClicked = false;

    const unmount = mount(
      () => h('div', null,
        createShow(
          () => true,
          () => h('div', { class: 'oauth' },
            h('button', { onClick: () => { oauthClicked = true; } }, 'Google'),
          ),
        ) as any,
        h('form', null,
          h('button', { onClick: () => { submitClicked = true; } }, 'Submit'),
        ),
      ),
      container,
    );

    const oauthBtn = container.querySelector('.oauth button')!;
    (oauthBtn as HTMLElement).click();
    expect(oauthClicked).toBe(true);

    const submitBtn = container.querySelector('form button')!;
    (submitBtn as HTMLElement).click();
    expect(submitClicked).toBe(true);

    unmount();
  });
});

// ---------------------------------------------------------------------------
// Task 2: createShow hydration enhancement (adopt-in-place + branch caching)
// ---------------------------------------------------------------------------

describe('createShow hydration enhancement', () => {
  afterEach(() => {
    setHydrating(false);
    document.body.innerHTML = '';
  });

  it('adopts SSR show content in place — no DOM movement during initial hydration', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      // Set up SSR DOM with show markers and content
      const root = document.createElement('div');
      root.innerHTML = '<!--f:s0--><p class="content">Hello</p><!--/f:s0-->';
      document.body.appendChild(root);

      const originalP = root.querySelector('p')!;

      // Create show descriptor
      const [show, setShow] = createSignal(true);
      setHydrating(true);
      const showDesc = createShow(
        show,
        () => h('p', { class: 'content' }, 'Hello'),
        () => h('p', { class: 'fallback' }, 'Hidden'),
      );
      setHydrating(false);

      // Adopt — p should stay in place (same DOM node)
      const parentDesc = { type: 'element' as const, tag: 'div', props: null, children: [showDesc] };
      adoptNode(parentDesc, root);

      // Same DOM node, not moved
      expect(root.querySelector('p.content')).toBe(originalP);

      // First toggle: content scooped into fragment, else rendered fresh
      setShow(false);
      expect(root.querySelector('p.content')).toBeNull();
      expect(root.querySelector('p.fallback')).toBeTruthy();

      // Toggle back: cached fragment re-inserted (same DOM node)
      setShow(true);
      expect(root.querySelector('p.content')).toBe(originalP);
    });

    dispose?.();
  });

  it('forward mismatch: SSR content stays until signals correct it', () => {
    // When SSR content doesn't match the client condition, we can't reliably
    // detect this from DOM alone (both branches can have content). The SSR
    // content stays in place and is cached normally. In practice, server-
    // injected props ensure signals match SSR, so this mismatch doesn't occur.
    // activateIslands() solves this by design (per-island hydration).
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      const root = document.createElement('div');
      root.innerHTML = '<!--f:s0--><p>Truthy</p><!--/f:s0-->';
      document.body.appendChild(root);

      const [show, setShow] = createSignal(false);
      setHydrating(true);
      const showDesc = createShow(
        show,
        () => h('p', null, 'Truthy'),
        () => h('p', null, 'Falsy'),
      );
      setHydrating(false);

      const parentDesc = { type: 'element' as const, tag: 'div', props: null, children: [showDesc] };
      adoptNode(parentDesc, root);

      // SSR content stays (no mismatch detection for forward case)
      expect(root.querySelector('p')!.textContent).toBe('Truthy');

      // Toggle true→false cycle: SSR content is cached, factory creates
      // fresh truthy branch. Cache labels match condition direction.
      setShow(true);
      expect(root.querySelector('p')!.textContent).toBe('Truthy');
    });

    dispose?.();
  });

  it('handles reverse mismatch — SSR empty but client condition is true', () => {
    const root = document.createElement('div');
    // SSR rendered with false condition — empty markers
    root.innerHTML = '<!--f:s0--><!--/f:s0-->';
    document.body.appendChild(root);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Client condition is true — reverse mismatch
    const [show] = createSignal(true);
    setHydrating(true);
    const showDesc = createShow(
      show,
      () => h('p', { class: 'truthy' }, 'Visible'),
      () => h('p', { class: 'falsy' }, 'Hidden'),
    );
    setHydrating(false);

    const parentDesc = { type: 'element' as const, tag: 'div', props: null, children: [showDesc] };
    adoptNode(parentDesc, root);

    // Should render the true branch
    expect(root.querySelector('p.truthy')).toBeTruthy();
    expect(root.querySelector('p.truthy')!.textContent).toBe('Visible');

    // Dev warning logged
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('show condition mismatch'),
    );
    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Function child returning element (not text) — element.ts fix
// ---------------------------------------------------------------------------

describe('h() function child returning Node', () => {
  it('appends DOM element when function returns a Node', () => {
    createRoot(() => {
      const el = h('div', null, () => h('span', null, 'child'));
      expect(el.innerHTML).toBe('<span>child</span>');
    });
  });

  it('replaces element when function return type changes from Node to text', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      const [mode, setMode] = createSignal<'element' | 'text'>('element');

      const el = h('div', null, () => {
        return mode() === 'element'
          ? h('span', null, 'child')
          : 'plain text';
      });

      expect(el.innerHTML).toBe('<span>child</span>');

      setMode('text');
      expect(el.textContent).toBe('plain text');
      expect(el.querySelector('span')).toBeNull();
    });

    dispose?.();
  });

  it('replaces text with element when function return type changes from text to Node', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      const [mode, setMode] = createSignal<'element' | 'text'>('text');

      const el = h('div', null, () => {
        return mode() === 'element'
          ? h('span', null, 'child')
          : 'plain text';
      });

      expect(el.textContent).toBe('plain text');

      setMode('element');
      expect(el.innerHTML).toBe('<span>child</span>');
    });

    dispose?.();
  });

  it('replaces element with different element', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      const [tag, setTag] = createSignal('span');

      const el = h('div', null, () => h(tag(), null, 'content'));

      expect(el.innerHTML).toBe('<span>content</span>');

      setTag('em');
      expect(el.innerHTML).toBe('<em>content</em>');
    });

    dispose?.();
  });

  it('still handles text function children (regression)', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      const [count, setCount] = createSignal(0);

      const el = h('div', null, () => count());

      expect(el.textContent).toBe('0');

      setCount(42);
      expect(el.textContent).toBe('42');
    });

    dispose?.();
  });
});

// ---------------------------------------------------------------------------
// adoptNode: function child returning descriptor (hydration fix)
// ---------------------------------------------------------------------------

describe('adoptNode function child returning descriptor', () => {
  it('adopts element when function child returns a descriptor during hydration', () => {
    createRoot(() => {
      // SSR HTML: <div><span class="inner">hello</span></div>
      const ssrEl = document.createElement('div');
      const ssrSpan = document.createElement('span');
      ssrSpan.className = 'inner';
      ssrSpan.textContent = 'hello';
      ssrEl.appendChild(ssrSpan);

      const handler = vi.fn();

      const desc: HydrationDescriptor = {
        type: 'element',
        tag: 'div',
        props: null,
        children: [
          // Function child that returns a descriptor (e.g., conditional rendering)
          () => ({ type: 'element' as const, tag: 'span', props: { onClick: handler }, children: ['hello'] }),
        ],
      };

      adoptNode(desc, ssrEl);

      // The SSR span should still be there (adopted, not replaced)
      expect(ssrEl.children.length).toBe(1);
      expect(ssrEl.children[0]).toBe(ssrSpan);

      // Event handler should be bound
      ssrSpan.click();
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  it('falls back to text when function child returns primitive with element at cursor', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      // SSR HTML: <div><span>existing</span></div>
      const ssrEl = document.createElement('div');
      const ssrSpan = document.createElement('span');
      ssrSpan.textContent = 'existing';
      ssrEl.appendChild(ssrSpan);

      const [msg] = createSignal('hello');

      const desc: HydrationDescriptor = {
        type: 'element',
        tag: 'div',
        props: null,
        children: [() => msg()],
      };

      adoptNode(desc, ssrEl);

      // Function returned a string, not a descriptor — text handling
      // The span is at cursor but function returns text, so it should not be adopted as element
    });

    dispose?.();
  });
});

// ---------------------------------------------------------------------------
// Style object reconciliation — P2 fix
// ---------------------------------------------------------------------------

describe('reactive style object reconciliation', () => {
  it('removes stale style keys when reactive style object changes', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      const [styles, setStyles] = createSignal<Record<string, string>>({
        color: 'red',
        fontSize: '16px',
      });

      const el = h('div', { style: styles });

      expect((el as HTMLElement).style.color).toBe('red');
      expect((el as HTMLElement).style.fontSize).toBe('16px');

      // Remove fontSize, change color
      setStyles({ color: 'blue' });

      expect((el as HTMLElement).style.color).toBe('blue');
      expect((el as HTMLElement).style.fontSize).toBe('');
    });

    dispose?.();
  });

  it('handles transition from object style to string style', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      const [styles, setStyles] = createSignal<string | Record<string, string>>({
        color: 'red',
        fontWeight: 'bold',
      });

      const el = h('div', { style: styles });

      expect((el as HTMLElement).style.color).toBe('red');
      expect((el as HTMLElement).style.fontWeight).toBe('bold');

      // Switch to string — cssText replaces everything
      (setStyles as any)('color: green');

      expect((el as HTMLElement).style.color).toBe('green');
      expect((el as HTMLElement).style.fontWeight).toBe('');
    });

    dispose?.();
  });

  it('adds new keys when reactive style object gains properties', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      const [styles, setStyles] = createSignal<Record<string, string>>({
        color: 'red',
      });

      const el = h('div', { style: styles });

      expect((el as HTMLElement).style.color).toBe('red');
      expect((el as HTMLElement).style.fontSize).toBe('');

      // Add fontSize
      setStyles({ color: 'red', fontSize: '20px' });

      expect((el as HTMLElement).style.color).toBe('red');
      expect((el as HTMLElement).style.fontSize).toBe('20px');
    });

    dispose?.();
  });
});

// ---------------------------------------------------------------------------
// Task 4: collectMarkers child island skip (FILTER_REJECT)
// ---------------------------------------------------------------------------

describe('collectMarkers child island skip', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('FILTER_REJECT skips child island subtrees', () => {
    const root = document.createElement('div');
    root.setAttribute('data-forma-island', '0');
    root.innerHTML = [
      '<!--f:t0-->Parent text<!--/f:t0-->',
      '<div data-forma-island="1">',
      '  <!--f:t1-->Child text<!--/f:t1-->',
      '</div>',
      '<!--f:t2-->After child<!--/f:t2-->',
    ].join('');
    document.body.appendChild(root);

    const markers = collectMarkers(root);

    // Parent sees t0 and t2, but NOT t1 (inside child island)
    expect(markers.text.has(0)).toBe(true);
    expect(markers.text.has(1)).toBe(false); // inside child island
    expect(markers.text.has(2)).toBe(true);
  });

  it('markers inside child islands NOT collected by parent', () => {
    const root = document.createElement('div');
    root.setAttribute('data-forma-island', '0');
    root.innerHTML = [
      '<!--f:s0--><p>Show</p><!--/f:s0-->',
      '<aside data-forma-island="1">',
      '  <!--f:s1--><p>Child show</p><!--/f:s1-->',
      '</aside>',
    ].join('');
    document.body.appendChild(root);

    const markers = collectMarkers(root);
    expect(markers.show.has(0)).toBe(true);
    expect(markers.show.has(1)).toBe(false); // inside child island
  });
});
