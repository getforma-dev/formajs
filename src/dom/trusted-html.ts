/**
 * Raw HTML's typed entry (DR-19, DR-20, L-37).
 *
 * Core writes markup unescaped in five places, the raw sinks:
 * `dangerouslySetInnerHTML`, `setHTMLUnsafe()`, `template()` and
 * `templateMany()`, `reconcile()` (the zero-build runtime's) and a `srcdoc`
 * binding. `trustedHtml(markup)` is the one way to tell them that a string is
 * markup someone vouches for. The name is the control: a reviewer, or a
 * consumer's CI (SR8's allowlist), finds every raw entry in an application by
 * searching for `trustedHtml`, and nothing else in core makes the value. (The
 * zero-build runtime's own `srcdoc` bindings, `data-bind:srcdoc` and a list
 * row's `srcdoc`, are raw entries too, which no `trustedHtml()` can reach: see
 * {@link warnRuntimeSrcdoc}.)
 *
 * Where the browser has Trusted Types, `trustedHtml` returns a `TrustedHTML`
 * made by Forma's policy `forma`, so a page whose policy carries
 * `require-trusted-types-for 'script'; trusted-types forma forma-runtime`
 * accepts it at the sink. Elsewhere it returns a frozen stand-in that core's
 * sinks recognise and write as its markup. The policy passes markup through
 * unchanged: what `trustedHtml` is given is trusted, so the guarantee is the
 * name review and CI see, enforced at the sink by the browser.
 *
 * The 2.x bridge (L-18): every raw sink still takes what it took before and
 * writes it exactly as before; in a development build the first value each
 * sink receives that is not trusted HTML logs one warning with a code:
 *
 * | Code | Sink |
 * |---|---|
 * | FORMA_W_RAW_INNER_HTML | `dangerouslySetInnerHTML` |
 * | FORMA_W_RAW_SET_HTML | `setHTMLUnsafe()` |
 * | FORMA_W_RAW_TEMPLATE | `template()`, `templateMany()` |
 * | FORMA_W_RAW_RECONCILE | `reconcile()` |
 * | FORMA_W_RAW_SRCDOC | `srcdoc` (h(), adoption, `./ssr`) |
 * | FORMA_W_RAW_RUNTIME_SRCDOC | the runtime's `data-bind:srcdoc`, a list row's `srcdoc` |
 * | FORMA_W_SCRIPT_ELEMENT | `h('script')` (refused in 3.0.0) |
 * | FORMA_W_TT_POLICY_REFUSED | the page refused `forma` or `forma-runtime` |
 *
 * Under a Trusted Types policy a string written to a sink is the browser's
 * business: reported under Report-Only, refused when enforced.
 *
 * The second policy, `forma-runtime`, is the zero-build runtime's parser's
 * own: `reconcile()` trims what it is given before it parses it, so markup
 * that arrived as a browser `TrustedHTML` is minted again, trimmed, through
 * it, and so is the `srcdoc` of an iframe that markup parsed into, when the
 * diff writes it. A string given to `reconcile()` is never minted: it reaches
 * the sink as a string.
 */

import { __DEV__ } from '../reactive/dev.js';
import { isRawHtmlAttr } from '../security/url-safety.js';

declare const __FORMA_DEV_BUILD__: boolean | undefined;

/**
 * Markup vouched for by {@link trustedHtml}: a browser `TrustedHTML` where the
 * browser has Trusted Types, else Forma's frozen stand-in. Every raw sink takes
 * one beside a string; 3.0.0's sinks take only this. A `TrustedHTML` from an
 * application's own policy is accepted at run time too; TypeScript sees it as
 * this type only through a cast (`value as unknown as TrustedHtml`).
 */
export interface TrustedHtml {
  /**
   * Type-level brand only: no value carries this property. It keeps a plain
   * string, or any other object, from passing for trusted markup.
   */
  readonly __formaTrustedHtml: true;
}

/** The raw sinks, as the development warnings name them. */
export type RawSink = 'innerHTML' | 'setHTMLUnsafe' | 'template' | 'reconcile' | 'srcdoc';

/** The part of a browser's Trusted Types policy core uses. */
export interface HtmlPolicy {
  createHTML(input: string): unknown;
}

/** The part of `window.trustedTypes` core uses. */
interface TrustedTypesFactory {
  createPolicy(name: string, rules: { createHTML(input: string): string }): HtmlPolicy;
  isHTML(value: unknown): boolean;
}

/**
 * What every copy of core on a page shares, on `globalThis` under the
 * `Symbol.for` key `@getforma/core#trusted-types`: a policy name can be
 * created once per page, and the runtime's IIFE, core's ESM build and a
 * development twin (FORMA-169) are separate copies of this module.
 *
 * The policies themselves are not on it. What is shared is the narrowest
 * handle each use needs: for `forma`, the mint `trustedHtml()` is (any script
 * that can reach this key can call it, so SR8's lint lists the key as a raw
 * entry); for `forma-runtime`, a parser that takes only a browser
 * `TrustedHTML`, so nothing here mints a `forma-runtime` value from a string.
 * The record has no prototype, so a polluted `Object.prototype` adds nothing.
 */
export interface Registry {
  /** `markup` minted through `forma`; null where there is no such policy. Absent until first needed. */
  forma?: ((markup: string) => unknown) | null;
  /**
   * The runtime's parser for a browser `TrustedHTML` (`RuntimeParser`, in
   * runtime-parser.ts), null for anything else; null where there is no
   * `forma-runtime`. Absent until first needed.
   */
  runtime?: ((value: unknown) => unknown) | null;
  /** Each stand-in core made, with its markup. */
  minted: WeakMap<object, string>;
  /** The development warnings already logged. */
  warned: Set<string>;
}

const REGISTRY_KEY = Symbol.for('@getforma/core#trusted-types');

/** @internal The registry, made by the first copy of core that needs it. */
export function registry(): Registry {
  const host = globalThis as unknown as Record<symbol, Registry | undefined>;
  return host[REGISTRY_KEY] ??= Object.assign(Object.create(null) as Registry, {
    minted: new WeakMap<object, string>(),
    warned: new Set<string>(),
  });
}

/** @internal `window.trustedTypes`, if it is one: an element named `trustedTypes` is not. */
export function factory(): TrustedTypesFactory | undefined {
  const tt = (globalThis as { trustedTypes?: TrustedTypesFactory }).trustedTypes;
  return tt && typeof tt.createPolicy === 'function' && typeof tt.isHTML === 'function' ? tt : undefined;
}

/**
 * The page's Trusted Types policy `name`, created here, or null where the
 * browser has no Trusted Types or refuses the name (a page policy whose
 * `trusted-types` directive does not list it, enforced, or another script
 * that created it first): markup is then written as a string, which such a
 * page refuses at the sink.
 */
export function createPolicy(name: 'forma' | 'forma-runtime'): HtmlPolicy | null {
  const tt = factory();
  if (!tt) return null;
  try {
    return tt.createPolicy(name, { createHTML: (input) => input });
  } catch {
    warnPolicyRefused(name);
    return null;
  }
}

/** The shared `forma` mint, made by the first copy of core that needs it. */
function formaMint(): ((markup: string) => unknown) | null {
  const reg = registry();
  if (reg.forma === undefined) {
    const forma = createPolicy('forma');
    reg.forma = forma && ((markup: string) => forma.createHTML(markup));
  }
  return reg.forma;
}

/**
 * Vouch for `markup` as HTML a raw sink may write unescaped: the one raw
 * constructor in TypeScript (DR-19), so a search for its name finds every raw
 * entry. Nothing is sanitised: pass only markup you control, never a value an
 * end user supplied.
 *
 * ```ts
 * h('div', { dangerouslySetInnerHTML: { __html: trustedHtml(renderedMarkdown) } });
 * ```
 *
 * Verified by: src/dom/__tests__/trusted-html.test.ts > "every raw sink writes a trustedHtml() value without a warning, and the DOM holds its markup"
 * Verified by: src/dom/__tests__/trusted-html.test.ts > "trustedHtml() returns a TrustedHTML from the forma policy where the browser has Trusted Types"
 */
export function trustedHtml(markup: string): TrustedHtml {
  const html = String(markup);
  const mint = formaMint();
  if (mint) return mint(html) as TrustedHtml;
  const standIn = Object.freeze({ toString: () => html, toJSON: () => html });
  registry().minted.set(standIn, html);
  return standIn as unknown as TrustedHtml;
}

/**
 * True for a value made by {@link trustedHtml}, or for any `TrustedHTML` the
 * browser's own Trusted Types made (an application's own policy included).
 *
 * Verified by: src/dom/__tests__/trusted-html.test.ts > "a look-alike object is not trusted HTML"
 */
export function isTrustedHtml(value: unknown): value is TrustedHtml {
  if (typeof value !== 'object' || value === null) return false;
  if (registry().minted.has(value)) return true;
  const tt = factory();
  return !!tt && tt.isHTML(value);
}

/**
 * What a sink writes for trusted HTML: a `TrustedHTML` as it is, so the
 * browser sees a typed value; Forma's stand-in as its markup. Typed `string`
 * because that is what the DOM's typings take.
 */
export function htmlOf(value: TrustedHtml): string {
  const markup = registry().minted.get(value);
  return (markup ?? value) as unknown as string;
}

/**
 * What raw sink `sink` writes for `value`: trusted HTML as {@link htmlOf}
 * gives it; anything else as it is, converted by the sink as it always was,
 * after the sink's development warning (once per process).
 *
 * Verified by: src/dom/__tests__/trusted-html.test.ts > "a string to each raw sink still renders, and warns once with the sink's code in development"
 * Verified by: src/dom/__tests__/trusted-html.test.ts > "a look-alike object or a String object is written as before and warns as a string does"
 */
export function rawHtml(value: unknown, sink: RawSink): string {
  if (isTrustedHtml(value)) return htmlOf(value);
  warnRawString(sink);
  return value as string;
}

// ---------------------------------------------------------------------------
// Development warnings
// ---------------------------------------------------------------------------

/**
 * Each raw sink's development code, how its warning names it, and what the
 * warning adds for it.
 */
export const RAW_STRING_CODES: Record<RawSink, readonly [code: string, where: string, note?: string]> = {
  innerHTML: ['FORMA_W_RAW_INNER_HTML', 'dangerouslySetInnerHTML'],
  setHTMLUnsafe: ['FORMA_W_RAW_SET_HTML', 'setHTMLUnsafe()'],
  template: ['FORMA_W_RAW_TEMPLATE', 'template() or templateMany()'],
  reconcile: ['FORMA_W_RAW_RECONCILE', 'reconcile()'],
  srcdoc: [
    'FORMA_W_RAW_SRCDOC',
    'srcdoc',
    'The browser parses its value as an HTML document, and escaping does not neutralize ' +
    'that: pass only trusted markup, and prefer a sandboxed iframe. ',
  ],
};

/** The code the zero-build runtime's own `srcdoc` bindings log. */
export const RUNTIME_SRCDOC_CODE = 'FORMA_W_RAW_RUNTIME_SRCDOC';

/** The code a refused policy name logs. */
export const POLICY_REFUSED_CODE = 'FORMA_W_TT_POLICY_REFUSED';

/** Log `line` once per page or process under `key`, whichever copy of core asks. */
function warnOnce(key: string, line: string): void {
  const warned = registry().warned;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(line);
}

/**
 * The development warning for a value that is not trusted HTML given to raw
 * sink `sink`.
 *
 * Verified by: src/dom/__tests__/trusted-html.test.ts > "a string to each raw sink still renders, and warns once with the sink's code in development"
 */
export function warnRawString(sink: RawSink): void {
  // `__DEV__`, written out with the build flag so the build folds it at this
  // `if` whatever artifact or chunk the module lands in. Every published
  // artifact is built with the flag `false`, which drops the warning and the
  // table above with it; an imported `__DEV__`, or a module-level constant,
  // does not fold across a chunk boundary or in the runtime's IIFE.
  // Verified by: src/dom/__tests__/trusted-html-build.test.ts > "a production build carries none of the raw-HTML warnings, in any artifact"
  if ((typeof __FORMA_DEV_BUILD__ === 'boolean' && __FORMA_DEV_BUILD__)
    || (typeof __FORMA_DEV_BUILD__ !== 'boolean' && __DEV__)) {
    const [code, where, note = ''] = RAW_STRING_CODES[sink];
    warnOnce(
      code,
      `[forma] ${code}: ${where} was given a plain string, or another value that is not ` +
      `trustedHtml(). ${note}Wrap markup you vouch for in trustedHtml(), so review and CI ` +
      'can find every raw entry; anything else still works in 2.x, is reported by a page ' +
      'whose policy requires Trusted Types and refused where it enforces them, and 3.0.0 ' +
      'accepts only trustedHtml() (DR-19). Logged once, in development builds.',
    );
  }
}

/**
 * The development warning for a value that is not trusted HTML written to
 * attribute `name`, when that attribute is a raw sink (`srcdoc`). The checks
 * are inside the build's condition, so a production build drops the call with
 * them.
 *
 * Verified by: src/dom/__tests__/element-url-safety.test.ts > "emits srcdoc but warns that escaping does not neutralize it"
 */
export function warnRawAttr(name: string, value: unknown): void {
  // The condition of warnRawString, for the same reason.
  if ((typeof __FORMA_DEV_BUILD__ === 'boolean' && __FORMA_DEV_BUILD__)
    || (typeof __FORMA_DEV_BUILD__ !== 'boolean' && __DEV__)) {
    if (isRawHtmlAttr(name) && !isTrustedHtml(value)) warnRawString('srcdoc');
  }
}

/**
 * The development warning for the zero-build runtime's own `srcdoc` writes:
 * `data-bind:srcdoc`, and `{item…}` in a list row's `srcdoc`. Each writes an
 * expression's value, or a row's data, as a document: a raw entry that no
 * `trustedHtml()` can reach, written as a string and never minted, so a page
 * requiring Trusted Types reports or refuses it. 3.0.0 refuses these bindings
 * (FORMA-109).
 *
 * Verified by: src/__tests__/runtime-srcdoc.test.ts > "data-bind:srcdoc writes its string and warns once with the runtime code"
 * Verified by: src/__tests__/runtime-srcdoc.test.ts > "a list row's srcdoc writes its string and warns once with the runtime code"
 */
export function warnRuntimeSrcdoc(name: string): void {
  // The condition of warnRawString, for the same reason.
  if (((typeof __FORMA_DEV_BUILD__ === 'boolean' && __FORMA_DEV_BUILD__)
    || (typeof __FORMA_DEV_BUILD__ !== 'boolean' && __DEV__)) && isRawHtmlAttr(name)) {
    warnOnce(
      RUNTIME_SRCDOC_CODE,
      `[forma] ${RUNTIME_SRCDOC_CODE}: the HTML runtime wrote "${name}" from a binding ` +
      '(data-bind:srcdoc, or {item} in a list row): the browser parses it as a document, ' +
      'a raw entry no trustedHtml() can name, written as a string that a page requiring ' +
      'Trusted Types reports or refuses. 3.0.0 refuses srcdoc bindings in the runtime ' +
      '(FORMA-109): build the frame with h() and trustedHtml(). Logged once, in development builds.',
    );
  }
}

/**
 * The development warning for a policy name the page refused.
 *
 * Verified by: src/dom/__tests__/trusted-html.test.ts > "a refused policy name warns once in development, and the sinks then write strings the page refuses"
 */
function warnPolicyRefused(name: string): void {
  // The condition of warnRawString, for the same reason.
  if ((typeof __FORMA_DEV_BUILD__ === 'boolean' && __FORMA_DEV_BUILD__)
    || (typeof __FORMA_DEV_BUILD__ !== 'boolean' && __DEV__)) {
    warnOnce(
      `${POLICY_REFUSED_CODE} ${name}`,
      `[forma] ${POLICY_REFUSED_CODE}: the page refused the Trusted Types policy "${name}": ` +
      'its trusted-types directive does not list it, or another script created it first. ' +
      'Core then writes markup as a string, which the page refuses where it enforces ' +
      "Trusted Types. List both of core's policies: trusted-types forma forma-runtime. " +
      'Logged once, in development builds.',
    );
  }
}

/** The code children given beside `dangerouslySetInnerHTML` log. */
export const INNER_HTML_CHILDREN_CODE = 'FORMA_W_INNER_HTML_CHILDREN';

/**
 * The development warning for children given beside a `dangerouslySetInnerHTML`
 * prop that owns the element's content (a function, or a value that is not
 * `null`, `undefined` or `false`): the renderers disagree on them, so they are
 * a mistake to pass (FORMA-176).
 *
 * Verified by: src/dom/__tests__/adopt-inner-html.test.ts > "children beside the prop warn once in development, in h() and in adoption, and a falsy prop does not"
 */
export function warnInnerHtmlChildren(props: Record<string, unknown> | null | undefined, children: unknown[]): void {
  // The condition of warnRawString, for the same reason.
  if ((typeof __FORMA_DEV_BUILD__ === 'boolean' && __FORMA_DEV_BUILD__)
    || (typeof __FORMA_DEV_BUILD__ !== 'boolean' && __DEV__)) {
    const inner = props?.dangerouslySetInnerHTML;
    if ((typeof inner === 'function' || (inner != null && inner !== false))
      && children.some((child) => child != null && child !== false && child !== true)) {
      warnOnce(
        INNER_HTML_CHILDREN_CODE,
        `[forma] ${INNER_HTML_CHILDREN_CODE}: an element was given dangerouslySetInnerHTML and children. ` +
        'h() renders the markup and then the children, until the markup next changes and replaces ' +
        'them; ./ssr renders only the markup; adoption keeps only the markup and binds none of the ' +
        'children. Give the element one or the other. Logged once, in development builds.',
      );
    }
  }
}

/**
 * The development warning for `h(tag)` where `tag` is `script`, which 3.0.0
 * refuses (FORMA-109).
 *
 * Verified by: src/dom/__tests__/trusted-html.test.ts > "h('script') warns once in development and still builds the element"
 */
export function warnScriptElement(tag: string): void {
  // The condition of warnRawString, for the same reason.
  if (((typeof __FORMA_DEV_BUILD__ === 'boolean' && __FORMA_DEV_BUILD__)
    || (typeof __FORMA_DEV_BUILD__ !== 'boolean' && __DEV__)) && tag === 'script') {
    warnOnce(
      'FORMA_W_SCRIPT_ELEMENT',
      "[forma] FORMA_W_SCRIPT_ELEMENT: h('script') built a script element. Under the page's " +
      "'strict-dynamic' policy a script inserted by trusted code runs whatever its src or text " +
      "names, so 3.0.0 refuses h('script') (DR-19): load scripts from the page or the build " +
      'instead. Logged once, in development builds.',
    );
  }
}
