# JSX Support Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add JSX syntax support to FormaJS so developers can write `<div onClick={handler}>` instead of `h('div', { onClick: handler })`.

**Architecture:** esbuild's classic JSX transform converts `<tag props>children</tag>` into `h(tag, props, ...children)` calls — the existing `h()` function handles them unchanged. We add a `Fragment` symbol for `<>...</>`, JSX type definitions for TypeScript, and update the build pipeline to set JSX defaults automatically. No runtime behavior changes — JSX is purely a syntax layer.

**Tech Stack:** TypeScript JSX namespace, esbuild `jsx: 'transform'`, `@babel/parser` JSX plugin

**Repos (in dependency order):**
1. `~/formajs` — `@getforma/core` (Fragment + types)
2. `~/forma-tools` — `@getforma/build` + `@getforma/compiler` (pipeline)
3. `~/create-forma-app` — templates

---

## Chunk 1: FormaJS Runtime (Fragment + JSX Types)

### Task 1: Fragment Symbol + h() Update

**Files:**
- Modify: `~/formajs/src/dom/element.ts:536-637` (h function + fragment)
- Modify: `~/formajs/src/dom/index.ts:7` (add Fragment export)
- Modify: `~/formajs/src/index.ts:9` (add Fragment export)
- Test: `~/formajs/src/dom/__tests__/fragment.test.ts` (create)

**Context:** `fragment()` already exists at element.ts:630 as a function. We need a `Fragment` symbol that `h()` can accept as first argument — this is what esbuild's `jsxFragment` option calls. The existing `fragment()` function stays as-is (public API, no breaking change). Use function overloads to avoid breaking the return type for existing `h(string, ...)` callers.

- [ ] **Step 1: Write failing tests for Fragment**

Create `~/formajs/src/dom/__tests__/fragment.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { h, Fragment } from '../element';

describe('Fragment', () => {
  it('is a symbol', () => {
    expect(typeof Fragment).toBe('symbol');
  });

  it('h(Fragment) returns DocumentFragment', () => {
    const frag = h(Fragment as any, null);
    expect(frag).toBeInstanceOf(DocumentFragment);
  });

  it('h(Fragment) contains children', () => {
    const frag = h(Fragment as any, null,
      h('span', null, 'one'),
      h('span', null, 'two'),
    );
    expect(frag.childNodes.length).toBe(2);
    expect((frag.firstChild as HTMLElement).textContent).toBe('one');
  });

  it('nested Fragments flatten', () => {
    const frag = h(Fragment as any, null,
      h(Fragment as any, null,
        h('span', null, 'inner'),
      ),
      h('span', null, 'outer'),
    );
    // DocumentFragment children get absorbed when appended
    const container = document.createElement('div');
    container.appendChild(frag);
    expect(container.children.length).toBe(2);
  });

  it('Fragment with reactive children updates', () => {
    const { createSignal, createRoot } = await import('../../reactive');
    const [count, setCount] = createSignal(0);

    let frag: any;
    createRoot(() => {
      frag = h(Fragment as any, null, () => String(count()));
    });

    const container = document.createElement('div');
    container.appendChild(frag);
    expect(container.textContent).toBe('0');

    setCount(5);
    expect(container.textContent).toBe('5');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/formajs && npx vitest run src/dom/__tests__/fragment.test.ts
```
Expected: FAIL — `Fragment` is not exported from `../element`

- [ ] **Step 3: Implement Fragment symbol and h() update**

In `~/formajs/src/dom/element.ts`:

Add the Fragment symbol after the imports (around line 12):

```typescript
/** Symbol used as JSX Fragment factory. h(Fragment, null, ...children) returns DocumentFragment. */
export const Fragment = Symbol.for('forma.fragment');
```

Update the `h()` function with overloads to preserve return type for existing callers (line 536):

```typescript
// Overloads: Fragment returns DocumentFragment, string returns HTMLElement
export function h(tag: typeof Fragment, props?: null, ...children: unknown[]): DocumentFragment;
export function h(tag: string, props?: Record<string, unknown> | null, ...children: unknown[]): HTMLElement;
export function h(
  tag: string | typeof Fragment,
  props?: Record<string, unknown> | null,
  ...children: unknown[]
): HTMLElement | DocumentFragment {
  // Fragment: return DocumentFragment with children
  if (tag === Fragment) {
    const frag = document.createDocumentFragment();
    for (const child of children) {
      appendChild(frag, child);
    }
    return frag;
  }

  if (hydrating) {
    return { type: 'element', tag, props: props ?? null, children } as unknown as HTMLElement;
  }
  // ... rest unchanged
```

Note: the `as any` casts in tests can be removed once types are in place (Task 2).

- [ ] **Step 4: Export Fragment from dom/index.ts**

In `~/formajs/src/dom/index.ts` line 7, change:

```typescript
export { h, fragment, cleanup } from './element.js';
```
to:
```typescript
export { h, Fragment, fragment, cleanup } from './element.js';
```

- [ ] **Step 5: Export Fragment from src/index.ts**

In `~/formajs/src/index.ts` line 9, add `Fragment` to the DOM exports:

```typescript
export { h, Fragment, fragment, createText, mount, createList, cleanup, createShow, createSwitch, createPortal, createErrorBoundary, createSuspense, hydrateIsland, activateIslands, reconcileList, longestIncreasingSubsequence } from './dom';
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd ~/formajs && npx vitest run src/dom/__tests__/fragment.test.ts
```
Expected: PASS (all 5 tests)

- [ ] **Step 7: Run full test suite to confirm no regressions**

```bash
cd ~/formajs && npx vitest run
```
Expected: All existing tests pass

- [ ] **Step 8: Commit**

```bash
cd ~/formajs
git add src/dom/element.ts src/dom/index.ts src/index.ts src/dom/__tests__/fragment.test.ts
git commit -m "feat: add Fragment symbol for JSX <> support"
```

---

### Task 2: JSX Type Definitions

**Files:**
- Create: `~/formajs/src/jsx.d.ts`
- Modify: `~/formajs/tsconfig.json` (add JSX compiler options)
- Modify: `~/formajs/vitest.config.ts` (add .tsx test pattern)
- Test: `~/formajs/src/dom/__tests__/jsx.test.tsx` (create)

**Context:** JSX types tell TypeScript what's valid in JSX expressions. The `JSX` namespace with `IntrinsicElements` maps tag names to their allowed props. `MaybeReactive<T>` lets any attribute accept a signal getter `() => T`. esbuild does the actual transform; these types only provide compile-time checking.

- [ ] **Step 1: Update tsconfig.json for JSX**

In `~/formajs/tsconfig.json`, add JSX options to `compilerOptions`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "sourceMap": true,
    "skipLibCheck": true,
    "jsx": "react",
    "jsxFactory": "h",
    "jsxFragmentFactory": "Fragment",
    "paths": {
      "forma/*": ["./src/*"]
    }
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 2: Update vitest.config.ts to include .tsx tests**

In `~/formajs/vitest.config.ts`, update the include pattern:

```typescript
export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
  // ...rest unchanged
});
```

- [ ] **Step 3: Create JSX type definitions**

Create `~/formajs/src/jsx.d.ts`:

```typescript
/**
 * Forma JSX Type Definitions
 *
 * Enables TypeScript checking for JSX syntax.
 * Every attribute accepts MaybeReactive<T> — a value or signal getter.
 *
 * esbuild transforms JSX into h() calls:
 *   <div class="x">hi</div>  →  h("div", { class: "x" }, "hi")
 *   <>a b</>                  →  h(Fragment, null, "a", " ", "b")
 */

import type { Fragment } from './dom/element';

type MaybeReactive<T> = T | (() => T);

declare global {
  namespace JSX {
    // JSX expressions return whatever h() returns
    type Element = HTMLElement | DocumentFragment;

    interface ElementChildrenAttribute {
      children: {};
    }

    // -----------------------------------------------------------------------
    // Base attribute interfaces
    // -----------------------------------------------------------------------

    interface HTMLAttributes<T extends EventTarget = HTMLElement> {
      // Core
      class?: MaybeReactive<string>;
      className?: MaybeReactive<string>;
      id?: MaybeReactive<string>;
      style?: MaybeReactive<string | Record<string, string>>;
      title?: MaybeReactive<string>;
      tabIndex?: MaybeReactive<number>;
      hidden?: MaybeReactive<boolean>;
      role?: MaybeReactive<string>;
      slot?: string;
      dir?: MaybeReactive<string>;
      lang?: MaybeReactive<string>;
      draggable?: MaybeReactive<boolean>;
      contentEditable?: MaybeReactive<boolean | 'true' | 'false' | 'inherit'>;

      // Data attributes
      [key: `data-${string}`]: MaybeReactive<string | number | boolean>;

      // ARIA attributes
      [key: `aria-${string}`]: MaybeReactive<string | number | boolean>;

      // Mouse events
      onClick?: (e: MouseEvent) => void;
      onDblClick?: (e: MouseEvent) => void;
      onMouseDown?: (e: MouseEvent) => void;
      onMouseUp?: (e: MouseEvent) => void;
      onMouseEnter?: (e: MouseEvent) => void;
      onMouseLeave?: (e: MouseEvent) => void;
      onMouseMove?: (e: MouseEvent) => void;
      onContextMenu?: (e: MouseEvent) => void;

      // Keyboard events
      onKeyDown?: (e: KeyboardEvent) => void;
      onKeyUp?: (e: KeyboardEvent) => void;
      onKeyPress?: (e: KeyboardEvent) => void;

      // Focus events
      onFocus?: (e: FocusEvent) => void;
      onBlur?: (e: FocusEvent) => void;
      onFocusIn?: (e: FocusEvent) => void;
      onFocusOut?: (e: FocusEvent) => void;

      // Form events
      onInput?: (e: InputEvent) => void;
      onChange?: (e: Event) => void;
      onSubmit?: (e: SubmitEvent) => void;
      onReset?: (e: Event) => void;
      onInvalid?: (e: Event) => void;

      // Clipboard events
      onCopy?: (e: ClipboardEvent) => void;
      onCut?: (e: ClipboardEvent) => void;
      onPaste?: (e: ClipboardEvent) => void;

      // Touch events
      onTouchStart?: (e: TouchEvent) => void;
      onTouchEnd?: (e: TouchEvent) => void;
      onTouchMove?: (e: TouchEvent) => void;
      onTouchCancel?: (e: TouchEvent) => void;

      // Pointer events
      onPointerDown?: (e: PointerEvent) => void;
      onPointerUp?: (e: PointerEvent) => void;
      onPointerMove?: (e: PointerEvent) => void;
      onPointerEnter?: (e: PointerEvent) => void;
      onPointerLeave?: (e: PointerEvent) => void;
      onPointerCancel?: (e: PointerEvent) => void;

      // UI events
      onScroll?: (e: Event) => void;
      onWheel?: (e: WheelEvent) => void;
      onResize?: (e: UIEvent) => void;

      // Animation/Transition
      onAnimationStart?: (e: AnimationEvent) => void;
      onAnimationEnd?: (e: AnimationEvent) => void;
      onAnimationIteration?: (e: AnimationEvent) => void;
      onTransitionEnd?: (e: TransitionEvent) => void;

      // Media events
      onLoad?: (e: Event) => void;
      onError?: (e: Event) => void;

      // Ref callback
      ref?: (el: T) => void;

      // Children (passed as rest args by esbuild, but TS needs this)
      children?: unknown;

      // FormaJS-specific
      'data-forma-island'?: string;
      'data-forma-component'?: string;
      'data-forma-status'?: string;

      // dangerouslySetInnerHTML
      dangerouslySetInnerHTML?: { __html: string };
    }

    // -----------------------------------------------------------------------
    // Element-specific attribute interfaces
    // -----------------------------------------------------------------------

    interface InputHTMLAttributes extends HTMLAttributes<HTMLInputElement> {
      type?: MaybeReactive<string>;
      value?: MaybeReactive<string | number>;
      placeholder?: MaybeReactive<string>;
      disabled?: MaybeReactive<boolean>;
      checked?: MaybeReactive<boolean>;
      name?: string;
      autocomplete?: string;
      required?: MaybeReactive<boolean>;
      readonly?: MaybeReactive<boolean>;
      min?: MaybeReactive<string | number>;
      max?: MaybeReactive<string | number>;
      step?: MaybeReactive<string | number>;
      pattern?: string;
      maxLength?: number;
      minLength?: number;
      accept?: string;
      multiple?: boolean;
      autofocus?: boolean;
    }

    interface SelectHTMLAttributes extends HTMLAttributes<HTMLSelectElement> {
      value?: MaybeReactive<string>;
      disabled?: MaybeReactive<boolean>;
      multiple?: boolean;
      name?: string;
      required?: MaybeReactive<boolean>;
      size?: number;
    }

    interface TextareaHTMLAttributes extends HTMLAttributes<HTMLTextAreaElement> {
      value?: MaybeReactive<string>;
      placeholder?: MaybeReactive<string>;
      disabled?: MaybeReactive<boolean>;
      readonly?: MaybeReactive<boolean>;
      rows?: number;
      cols?: number;
      name?: string;
      required?: MaybeReactive<boolean>;
      maxLength?: number;
      wrap?: string;
    }

    interface FormHTMLAttributes extends HTMLAttributes<HTMLFormElement> {
      action?: string;
      method?: string;
      enctype?: string;
      target?: string;
      noValidate?: boolean;
      autocomplete?: string;
    }

    interface AnchorHTMLAttributes extends HTMLAttributes<HTMLAnchorElement> {
      href?: MaybeReactive<string>;
      target?: string;
      rel?: string;
      download?: string | boolean;
      hreflang?: string;
      type?: string;
    }

    interface ImgHTMLAttributes extends HTMLAttributes<HTMLImageElement> {
      src?: MaybeReactive<string>;
      alt?: MaybeReactive<string>;
      loading?: 'lazy' | 'eager';
      decoding?: 'sync' | 'async' | 'auto';
      width?: number | string;
      height?: number | string;
      srcset?: string;
      sizes?: string;
      crossOrigin?: string;
    }

    interface VideoHTMLAttributes extends HTMLAttributes<HTMLVideoElement> {
      src?: MaybeReactive<string>;
      preload?: 'none' | 'metadata' | 'auto';
      autoplay?: boolean;
      loop?: boolean;
      muted?: MaybeReactive<boolean>;
      controls?: boolean;
      width?: number | string;
      height?: number | string;
      poster?: string;
      playsInline?: boolean;
    }

    interface LabelHTMLAttributes extends HTMLAttributes<HTMLLabelElement> {
      for?: string;
      htmlFor?: string;
    }

    interface ButtonHTMLAttributes extends HTMLAttributes<HTMLButtonElement> {
      type?: 'button' | 'submit' | 'reset';
      disabled?: MaybeReactive<boolean>;
      name?: string;
      value?: string;
      form?: string;
    }

    interface OptionHTMLAttributes extends HTMLAttributes<HTMLOptionElement> {
      value?: string;
      selected?: MaybeReactive<boolean>;
      disabled?: MaybeReactive<boolean>;
      label?: string;
    }

    interface IframeHTMLAttributes extends HTMLAttributes<HTMLIFrameElement> {
      src?: MaybeReactive<string>;
      srcdoc?: string;
      sandbox?: string;
      allow?: string;
      width?: number | string;
      height?: number | string;
      loading?: 'lazy' | 'eager';
      name?: string;
    }

    interface DialogHTMLAttributes extends HTMLAttributes<HTMLDialogElement> {
      open?: MaybeReactive<boolean>;
    }

    interface CanvasHTMLAttributes extends HTMLAttributes<HTMLCanvasElement> {
      width?: number | string;
      height?: number | string;
    }

    interface TableCellHTMLAttributes extends HTMLAttributes<HTMLTableCellElement> {
      colSpan?: number;
      rowSpan?: number;
      scope?: string;
    }

    // -----------------------------------------------------------------------
    // SVG attributes (minimal set for common usage)
    // -----------------------------------------------------------------------

    interface SVGAttributes extends HTMLAttributes<SVGElement> {
      viewBox?: string;
      xmlns?: string;
      fill?: MaybeReactive<string>;
      stroke?: MaybeReactive<string>;
      strokeWidth?: MaybeReactive<string | number>;
      strokeLinecap?: string;
      strokeLinejoin?: string;
      d?: MaybeReactive<string>;
      cx?: MaybeReactive<string | number>;
      cy?: MaybeReactive<string | number>;
      r?: MaybeReactive<string | number>;
      rx?: MaybeReactive<string | number>;
      ry?: MaybeReactive<string | number>;
      x?: MaybeReactive<string | number>;
      y?: MaybeReactive<string | number>;
      x1?: MaybeReactive<string | number>;
      y1?: MaybeReactive<string | number>;
      x2?: MaybeReactive<string | number>;
      y2?: MaybeReactive<string | number>;
      width?: MaybeReactive<string | number>;
      height?: MaybeReactive<string | number>;
      transform?: MaybeReactive<string>;
      opacity?: MaybeReactive<string | number>;
      clipPath?: string;
      points?: MaybeReactive<string>;
      pathLength?: number;
    }

    // -----------------------------------------------------------------------
    // IntrinsicElements — maps tag names to their attribute types
    // -----------------------------------------------------------------------

    interface IntrinsicElements {
      // Block elements
      div: HTMLAttributes<HTMLDivElement>;
      section: HTMLAttributes<HTMLElement>;
      article: HTMLAttributes<HTMLElement>;
      aside: HTMLAttributes<HTMLElement>;
      header: HTMLAttributes<HTMLElement>;
      footer: HTMLAttributes<HTMLElement>;
      main: HTMLAttributes<HTMLElement>;
      nav: HTMLAttributes<HTMLElement>;

      // Headings
      h1: HTMLAttributes<HTMLHeadingElement>;
      h2: HTMLAttributes<HTMLHeadingElement>;
      h3: HTMLAttributes<HTMLHeadingElement>;
      h4: HTMLAttributes<HTMLHeadingElement>;
      h5: HTMLAttributes<HTMLHeadingElement>;
      h6: HTMLAttributes<HTMLHeadingElement>;

      // Text
      p: HTMLAttributes<HTMLParagraphElement>;
      span: HTMLAttributes<HTMLSpanElement>;
      strong: HTMLAttributes<HTMLElement>;
      em: HTMLAttributes<HTMLElement>;
      b: HTMLAttributes<HTMLElement>;
      i: HTMLAttributes<HTMLElement>;
      small: HTMLAttributes<HTMLElement>;
      code: HTMLAttributes<HTMLElement>;
      pre: HTMLAttributes<HTMLPreElement>;
      blockquote: HTMLAttributes<HTMLQuoteElement>;
      abbr: HTMLAttributes<HTMLElement>;
      cite: HTMLAttributes<HTMLElement>;
      mark: HTMLAttributes<HTMLElement>;
      sub: HTMLAttributes<HTMLElement>;
      sup: HTMLAttributes<HTMLElement>;
      del: HTMLAttributes<HTMLElement>;
      ins: HTMLAttributes<HTMLElement>;
      time: HTMLAttributes<HTMLTimeElement>;

      // Lists
      ul: HTMLAttributes<HTMLUListElement>;
      ol: HTMLAttributes<HTMLOListElement>;
      li: HTMLAttributes<HTMLLIElement>;
      dl: HTMLAttributes<HTMLDListElement>;
      dt: HTMLAttributes<HTMLElement>;
      dd: HTMLAttributes<HTMLElement>;

      // Forms
      form: FormHTMLAttributes;
      input: InputHTMLAttributes;
      select: SelectHTMLAttributes;
      textarea: TextareaHTMLAttributes;
      button: ButtonHTMLAttributes;
      label: LabelHTMLAttributes;
      option: OptionHTMLAttributes;
      optgroup: HTMLAttributes<HTMLOptGroupElement>;
      fieldset: HTMLAttributes<HTMLFieldSetElement>;
      legend: HTMLAttributes<HTMLLegendElement>;
      output: HTMLAttributes<HTMLOutputElement>;
      progress: HTMLAttributes<HTMLProgressElement>;
      meter: HTMLAttributes<HTMLMeterElement>;

      // Table
      table: HTMLAttributes<HTMLTableElement>;
      caption: HTMLAttributes<HTMLTableCaptionElement>;
      colgroup: HTMLAttributes<HTMLTableColElement>;
      col: HTMLAttributes<HTMLTableColElement>;
      thead: HTMLAttributes<HTMLTableSectionElement>;
      tbody: HTMLAttributes<HTMLTableSectionElement>;
      tfoot: HTMLAttributes<HTMLTableSectionElement>;
      tr: HTMLAttributes<HTMLTableRowElement>;
      th: TableCellHTMLAttributes;
      td: TableCellHTMLAttributes;

      // Media
      img: ImgHTMLAttributes;
      video: VideoHTMLAttributes;
      audio: HTMLAttributes<HTMLAudioElement>;
      source: HTMLAttributes<HTMLSourceElement>;
      picture: HTMLAttributes<HTMLPictureElement>;
      canvas: CanvasHTMLAttributes;

      // SVG
      svg: SVGAttributes;
      path: SVGAttributes;
      circle: SVGAttributes;
      rect: SVGAttributes;
      line: SVGAttributes;
      polyline: SVGAttributes;
      polygon: SVGAttributes;
      ellipse: SVGAttributes;
      g: SVGAttributes;
      defs: SVGAttributes;
      use: SVGAttributes;
      clipPath: SVGAttributes;
      mask: SVGAttributes;
      text: SVGAttributes;
      tspan: SVGAttributes;

      // Links & Embeds
      a: AnchorHTMLAttributes;
      iframe: IframeHTMLAttributes;

      // Interactive
      dialog: DialogHTMLAttributes;
      details: HTMLAttributes<HTMLDetailsElement>;
      summary: HTMLAttributes<HTMLElement>;

      // Void elements
      br: HTMLAttributes<HTMLBRElement>;
      hr: HTMLAttributes<HTMLHRElement>;
      wbr: HTMLAttributes<HTMLElement>;

      // Semantic
      address: HTMLAttributes<HTMLElement>;
      figure: HTMLAttributes<HTMLElement>;
      figcaption: HTMLAttributes<HTMLElement>;

      // Head elements (rarely used in h(), but valid)
      link: HTMLAttributes<HTMLLinkElement>;
      meta: HTMLAttributes<HTMLMetaElement>;
      style: HTMLAttributes<HTMLStyleElement>;
      script: HTMLAttributes<HTMLScriptElement>;
      noscript: HTMLAttributes<HTMLElement>;
      template: HTMLAttributes<HTMLTemplateElement>;
    }
  }
}

export {};
```

- [ ] **Step 4: Write JSX compile-and-render tests**

Create `~/formajs/src/dom/__tests__/jsx.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { h, Fragment, createSignal, createRoot, createShow, createList, mount } from '../../index';

describe('JSX', () => {
  it('renders a basic element', () => {
    const el = <div class="test">Hello</div>;
    expect(el).toBeInstanceOf(HTMLDivElement);
    expect(el.className).toBe('test');
    expect(el.textContent).toBe('Hello');
  });

  it('renders nested elements', () => {
    const el = (
      <div>
        <span>one</span>
        <span>two</span>
      </div>
    );
    expect(el.children.length).toBe(2);
    expect(el.children[0].textContent).toBe('one');
  });

  it('handles event handlers', () => {
    let clicked = false;
    const el = <button onClick={() => { clicked = true; }}>Click</button>;
    el.click();
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
    expect(el.getAttribute('data-id')).toBe('123');
    expect(el.getAttribute('data-active')).toBe('true');
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
    expect(el.firstChild).toBeInstanceOf(SVGPathElement);
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
            <li>{item}</li>
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
    expect(jsxEl.outerHTML).toBe(hEl.outerHTML);
  });
});
```

- [ ] **Step 5: Run JSX tests**

```bash
cd ~/formajs && npx vitest run src/dom/__tests__/jsx.test.tsx
```
Expected: PASS (all 12 tests). These should pass because esbuild (used by vitest) transforms JSX into h() calls, and h() already handles everything.

- [ ] **Step 6: Run full test suite**

```bash
cd ~/formajs && npx vitest run
```
Expected: All tests pass (existing + new fragment + JSX tests)

- [ ] **Step 7: Run typecheck**

```bash
cd ~/formajs && npx tsc --noEmit
```
Expected: PASS (JSX types recognized, no errors)

- [ ] **Step 8: Ensure jsx.d.ts ships to consumers**

`jsx.d.ts` is a global ambient declaration (`declare global { namespace JSX { ... } }`). tsup may not emit it since no entry point imports it. Add a triple-slash reference in `src/index.ts` at the top:

```typescript
/// <reference path="./jsx.d.ts" />
```

This ensures TypeScript includes the JSX namespace when consumers import `@getforma/core`.

- [ ] **Step 9: Verify build works**

```bash
cd ~/formajs && npx tsup
```
Expected: All build outputs generated. Check `dist/index.d.ts` contains or references JSX namespace.

- [ ] **Step 10: Add Fragment to public API surface test**

In `~/formajs/src/__tests__/index-surface.test.ts`, add to the first test:

```typescript
expect(typeof forma.Fragment).toBe('symbol');
```

- [ ] **Step 11: Run surface test**

```bash
cd ~/formajs && npx vitest run src/__tests__/index-surface.test.ts
```
Expected: PASS

- [ ] **Step 12: Commit**

```bash
cd ~/formajs
git add src/jsx.d.ts src/dom/__tests__/jsx.test.tsx tsconfig.json vitest.config.ts src/__tests__/index-surface.test.ts
git commit -m "feat: add JSX type definitions and TypeScript JSX support"
```

---

## Chunk 2: Build Pipeline (forma-tools)

### Task 3: esbuild JSX Defaults in @getforma/build

**Files:**
- Modify: `~/forma-tools/packages/build/src/build.ts:464-470` (shared esbuild config)
- Test: `~/forma-tools/packages/build/tests/build.test.ts` (add JSX test)

**Context:** The `build()` function in `build.ts` constructs a shared esbuild options object. We need to add `jsx: 'transform'`, `jsxFactory: 'h'`, `jsxFragment: 'Fragment'` so `.tsx` files just work without user config. The esbuild config starts at line 464.

- [ ] **Step 1: Add JSX options to shared esbuild config**

In `~/forma-tools/packages/build/src/build.ts`, find the shared config (around line 464):

```typescript
const shared: Partial<esbuild.BuildOptions> = {
  bundle: true,
  format: 'esm',
  target: 'es2022',
  alias: config.formaAlias
    ? { '@getforma/core': config.formaAlias }
    : {},
  minify: !config.watch,
  sourcemap: config.watch ? 'inline' : false,
  logLevel: 'info',
};
```

Add JSX options:

```typescript
const shared: Partial<esbuild.BuildOptions> = {
  bundle: true,
  format: 'esm',
  target: 'es2022',
  jsx: 'transform',
  jsxFactory: 'h',
  jsxFragment: 'Fragment',
  alias: config.formaAlias
    ? { '@getforma/core': config.formaAlias }
    : {},
  minify: !config.watch,
  sourcemap: config.watch ? 'inline' : false,
  logLevel: 'info',
};
```

- [ ] **Step 2: Run existing build tests**

```bash
cd ~/forma-tools && npx vitest run packages/build/tests/
```
Expected: PASS (existing tests unaffected — JSX options are additive)

- [ ] **Step 3: Commit**

```bash
cd ~/forma-tools
git add packages/build/src/build.ts
git commit -m "feat: add JSX transform defaults to esbuild config"
```

---

### Task 4: Babel Parser JSX Support in @getforma/compiler

**Files:**
- Modify: `~/forma-tools/packages/compiler/src/esbuild-ssr-plugin.ts:39-42` (PARSE_OPTS)
- Modify: `~/forma-tools/packages/compiler/src/component-analyzer.ts:47-50` (PARSE_OPTS)
- Test: `~/forma-tools/packages/compiler/tests/component-analyzer.test.ts` (add JSX test)

**Context:** Both files use `@babel/parser` with `plugins: ['typescript']`. When a user writes `.tsx` files, the SSR plugin reads the SOURCE file (not esbuild output) to generate IR. Babel will choke on JSX syntax without the `'jsx'` plugin. This is a CRITICAL fix — without it, SSR breaks for any `.tsx` component.

- [ ] **Step 1: Add 'jsx' plugin to esbuild-ssr-plugin.ts**

In `~/forma-tools/packages/compiler/src/esbuild-ssr-plugin.ts:39-42`, change:

```typescript
const PARSE_OPTS = {
  sourceType: 'module' as const,
  plugins: ['typescript' as const],
};
```

to:

```typescript
const PARSE_OPTS = {
  sourceType: 'module' as const,
  plugins: ['typescript' as const, 'jsx' as const],
};
```

- [ ] **Step 2: Add 'jsx' plugin to component-analyzer.ts**

In `~/forma-tools/packages/compiler/src/component-analyzer.ts:47-50`, same change:

```typescript
const PARSE_OPTS = {
  sourceType: 'module' as const,
  plugins: ['typescript' as const, 'jsx' as const],
};
```

- [ ] **Step 3: Run existing compiler tests**

```bash
cd ~/forma-tools && npx vitest run packages/compiler/tests/
```
Expected: PASS (adding 'jsx' plugin doesn't break non-JSX parsing)

- [ ] **Step 4: Commit**

```bash
cd ~/forma-tools
git add packages/compiler/src/esbuild-ssr-plugin.ts packages/compiler/src/component-analyzer.ts
git commit -m "feat: add JSX babel plugin to SSR parser for .tsx support"
```

---

## Chunk 3: Templates + Publish

### Task 5: Update create-forma-app Templates

**Files:**
- Modify: `~/create-forma-app/src/index.ts:10` (add `.tsx` to TEXT_EXTS)
- Delete: `~/create-forma-app/templates/minimal/admin/src/home/app.ts`
- Delete: `~/create-forma-app/templates/minimal/admin/src/home/HomeIsland.ts`
- Delete: `~/create-forma-app/templates/minimal/admin/src/home/store.ts` (orphaned — signals moved inline)
- Create: `~/create-forma-app/templates/minimal/admin/src/home/app.tsx`
- Create: `~/create-forma-app/templates/minimal/admin/src/home/HomeIsland.tsx`
- Delete: `~/create-forma-app/templates/dashboard/admin/src/home/app.ts`
- Delete: `~/create-forma-app/templates/dashboard/admin/src/home/HomeIsland.ts`
- Create: `~/create-forma-app/templates/dashboard/admin/src/home/app.tsx`
- Create: `~/create-forma-app/templates/dashboard/admin/src/home/HomeIsland.tsx`
- Modify: both `admin/tsconfig.json` files (add JSX options)
- Modify: both `admin/build.ts` files (update entry point extension)
- Modify: `~/create-forma-app/tests/cli.test.ts` (update assertions)

**Context:** Templates currently use `h()` syntax. We rename to `.tsx` and rewrite in JSX. The `store.ts` in minimal template gets dropped (signal creation moves inline like dashboard already does). The `replacePlaceholders()` function needs `.tsx` added to its `TEXT_EXTS` set, otherwise `{{PROJECT_NAME}}` won't be replaced in `.tsx` files.

- [ ] **Step 1: Add `.tsx` to TEXT_EXTS in replacePlaceholders**

In `~/create-forma-app/src/index.ts:10`, change:

```typescript
const TEXT_EXTS = new Set(['.toml', '.rs', '.ts', '.json', '.md', '.css', '.html']);
```

to:

```typescript
const TEXT_EXTS = new Set(['.toml', '.rs', '.ts', '.tsx', '.json', '.md', '.css', '.html']);
```

- [ ] **Step 2: Update minimal template tsconfig.json**

In `~/create-forma-app/templates/minimal/admin/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "jsx": "react",
    "jsxFactory": "h",
    "jsxFragmentFactory": "Fragment",
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Rename and rewrite minimal template files**

Delete `app.ts`, `HomeIsland.ts`, and `store.ts`. Create `app.tsx` and `HomeIsland.tsx`:

`~/create-forma-app/templates/minimal/admin/src/home/app.tsx`:
```tsx
import { mount } from '@getforma/core';
import { HomeIsland } from './HomeIsland';

mount(() => HomeIsland(), '#app');
```

Note: `app.tsx` has no JSX syntax itself — it just calls `mount()`. No `h`/`Fragment` imports needed (avoids unused-import lint errors).

`~/create-forma-app/templates/minimal/admin/src/home/HomeIsland.tsx`:
```tsx
import { createSignal, h, Fragment } from '@getforma/core';

const [count, setCount] = createSignal(0);

export function HomeIsland() {
  return (
    <div style="font-family: system-ui; padding: 2rem; text-align: center;">
      <h1>{{PROJECT_NAME}}</h1>
      <p>Count: {() => count()}</p>
      <button onClick={() => setCount(count() + 1)}>Increment</button>
      <button onClick={() => setCount(0)} style="margin-left: 8px;">Reset</button>
    </div>
  );
}

// Equivalent h() syntax (for reference):
// h('div', { style: '...' },
//   h('h1', null, '{{PROJECT_NAME}}'),
//   h('p', null, () => count()),
//   h('button', { onClick: () => setCount(count() + 1) }, 'Increment'),
// )
```

- [ ] **Step 4: Update minimal build.ts entry point**

In `~/create-forma-app/templates/minimal/admin/build.ts`, change the entry point from `src/home/app.ts` to `src/home/app.tsx`.

- [ ] **Step 5: Rewrite dashboard template**

Update `~/create-forma-app/templates/dashboard/admin/tsconfig.json` (same JSX options as minimal).

Delete `app.ts` and `HomeIsland.ts`. Create `app.tsx` and `HomeIsland.tsx`:

`~/create-forma-app/templates/dashboard/admin/src/home/app.tsx`:
```tsx
import { mount } from '@getforma/core';
import { HomeIsland } from './HomeIsland';

mount(() => HomeIsland(), '#app');
```

`~/create-forma-app/templates/dashboard/admin/src/home/HomeIsland.tsx`:
```tsx
import { h, Fragment, createSignal, createList } from '@getforma/core';

interface Row {
  id: number;
  name: string;
  value: number;
}

const initialData: Row[] = Array.from({ length: 100 }, (_, i) => ({
  id: i + 1,
  name: `Item ${i + 1}`,
  value: Math.round(Math.random() * 1000) / 10,
}));

const [rows, setRows] = createSignal(initialData);
const [sortAsc, setSortAsc] = createSignal(true);

function toggleSort() {
  const asc = !sortAsc();
  setSortAsc(asc);
  setRows(
    [...rows()].sort((a, b) => (asc ? a.value - b.value : b.value - a.value)),
  );
}

export function HomeIsland() {
  return (
    <div>
      <h1>Dashboard</h1>
      <button onClick={toggleSort}>
        {() => `Sort by value (${sortAsc() ? '\u2191' : '\u2193'})`}
      </button>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {createList(
            rows,
            (r) => r.id,
            (r) => (
              <tr>
                <td>{String(r.id)}</td>
                <td>{r.name}</td>
                <td>{r.value.toFixed(1)}</td>
              </tr>
            ),
            { updateOnItemChange: 'rerender' },
          )}
        </tbody>
      </table>
    </div>
  );
}
```

Update `~/create-forma-app/templates/dashboard/admin/build.ts` entry point from `app.ts` to `app.tsx`.

- [ ] **Step 6: Update tests/cli.test.ts**

Key changes needed:

1. Line 66: `'app.ts'` → `'app.tsx'`, test description updated
2. Line 71-82: `'HomeIsland.ts'` → `'HomeIsland.tsx'`, replace `not.toContain('jsx')` with JSX-positive assertions:

```typescript
it('has admin/src/home/app.tsx with mount render function', () => {
  const app = fs.readFileSync(path.join(TEMPLATES_DIR, template, 'admin', 'src', 'home', 'app.tsx'), 'utf8');
  expect(app).toContain("mount(() => HomeIsland(), '#app')");
});

it('has admin/src/home/HomeIsland.tsx with JSX syntax', () => {
  const island = fs.readFileSync(
    path.join(TEMPLATES_DIR, template, 'admin', 'src', 'home', 'HomeIsland.tsx'),
    'utf8',
  );
  expect(island).toContain('@getforma/core');
  // Uses JSX syntax (not just h() calls)
  expect(island).toContain('<div');
  expect(island).toContain('onClick');
  // No virtual DOM patterns
  expect(island).not.toContain('createElement');
  expect(island).not.toContain('render(');
});
```

3. Dashboard specifics (line 100-112): Change `'HomeIsland.ts'` → `'HomeIsland.tsx'`, keep `createList` and `r.id`/`r.name`/`r.value` assertions.

4. Add new test for tsconfig JSX settings:

```typescript
it('has admin/tsconfig.json with JSX factory config', () => {
  const tsconfig = fs.readFileSync(path.join(TEMPLATES_DIR, template, 'admin', 'tsconfig.json'), 'utf8');
  expect(tsconfig).toContain('"jsxFactory"');
  expect(tsconfig).toContain('"jsxFragmentFactory"');
});
```

5. Add test for `.tsx` in TEXT_EXTS (replacePlaceholders):

```typescript
it('replaces placeholders in .tsx files', () => {
  fs.writeFileSync(
    path.join(TEST_OUTPUT, 'App.tsx'),
    '<h1>{{PROJECT_NAME}}</h1>',
  );
  replacePlaceholders(TEST_OUTPUT, { '{{PROJECT_NAME}}': 'my-app' });
  const result = fs.readFileSync(path.join(TEST_OUTPUT, 'App.tsx'), 'utf8');
  expect(result).toBe('<h1>my-app</h1>');
});
```

- [ ] **Step 7: Run tests**

```bash
cd ~/create-forma-app && npx vitest run
```
Expected: PASS (all tests updated and passing)

- [ ] **Step 8: Commit**

```bash
cd ~/create-forma-app
git add -A
git commit -m "feat: JSX templates — rename .ts to .tsx, JSX syntax as default"
```

---

### Task 6: Version Bump + Publish

**Files:**
- `~/formajs/package.json` (0.1.1 → 0.2.0)
- `~/forma-tools/packages/build/package.json` (0.1.0 → 0.1.1)
- `~/forma-tools/packages/compiler/package.json` (0.1.0 → 0.1.1)
- `~/create-forma-app/package.json` (0.1.2 → 0.2.0)

- [ ] **Step 1: Build and test formajs**

```bash
cd ~/formajs
npm version minor   # 0.1.1 → 0.2.0
npm run build
npx vitest run
npx tsc --noEmit
```
Expected: All pass

- [ ] **Step 2: Verify Fragment is in dist**

```bash
grep -l "Fragment" ~/formajs/dist/index.js ~/formajs/dist/index.d.ts
```
Expected: Both files found (Fragment exported in ESM and types)

- [ ] **Step 3: Verify jsx.d.ts is in dist**

```bash
ls ~/formajs/dist/jsx.d.ts 2>/dev/null || echo "CHECK: jsx.d.ts may be in src/ and included via package.json files field"
```

Note: `jsx.d.ts` is a global ambient declaration. It needs to be discoverable by consuming projects. If tsup doesn't copy it to dist, add `"src/jsx.d.ts"` to the `files` field in package.json, OR reference it in `index.d.ts` via `/// <reference path="./jsx.d.ts" />`.

- [ ] **Step 4: Publish @getforma/core**

```bash
cd ~/formajs && npm publish --access public
```

- [ ] **Step 5: Build and test forma-tools**

```bash
cd ~/forma-tools
npm version patch -w packages/compiler  # 0.1.0 → 0.1.1
npm version patch -w packages/build     # 0.1.0 → 0.1.1
npm run build -w packages/compiler
npm run build -w packages/build
npx vitest run
```

- [ ] **Step 6: Publish @getforma/compiler and @getforma/build**

```bash
cd ~/forma-tools
npm publish -w packages/compiler --access public
npm publish -w packages/build --access public
```

- [ ] **Step 7: Update create-forma-app deps and publish**

```bash
cd ~/create-forma-app
# Update template package.json deps to use new versions
npm version minor  # 0.1.2 → 0.2.0
npm run build
npx vitest run
npm publish --access public
```

- [ ] **Step 8: End-to-end verification**

```bash
cd /tmp
npx @getforma/create-app@0.2.0 test-jsx-app
cd test-jsx-app/admin
npm install
npx tsx build.ts --ssr
npx tsc --noEmit
echo "If no errors: JSX works end-to-end with published packages"
```

- [ ] **Step 9: Tag and push all repos**

```bash
cd ~/formajs && git tag v0.2.0 && git push origin main --tags
cd ~/forma-tools && git push origin main --tags
cd ~/create-forma-app && git tag v0.2.0 && git push origin main --tags
```

---

## Verification Gates

After all tasks complete:

1. **`npx @getforma/create-app test-app`** generates `.tsx` app
2. **App compiles with zero TypeScript errors** (`tsc --noEmit` passes)
3. **JSX and h() produce identical DOM output** (jsx.test.tsx assertion)
4. **FormaJS test suite passes** (all existing + new fragment + JSX tests)
5. **Compiler test suite passes** (Babel parses .tsx without errors)
6. **SSR works with .tsx files** (esbuild-ssr-plugin generates IR from JSX source)
