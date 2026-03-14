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
