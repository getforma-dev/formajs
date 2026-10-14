/**
 * Raw HTML's typed entry (DR-19, DR-20, L-37).
 *
 * Core writes markup unescaped in five places, the raw sinks:
 * `dangerouslySetInnerHTML`, `setHTMLUnsafe()`, `template()` and
 * `templateMany()`, `reconcile()` (the zero-build runtime's) and a `srcdoc`
 * binding. `trustedHtml(markup)` is the one way to tell them that a string is
 * markup someone vouches for. The name is the control: a reviewer, or a
 * consumer's CI (SR8's allowlist), finds every raw entry in an application by
 * searching for `trustedHtml`, and nothing else in core makes the value.
 *
 * Where the browser has Trusted Types, `trustedHtml` returns a `TrustedHTML`
 * made by Forma's policy `forma`, so a page whose policy carries
 * `require-trusted-types-for 'script'; trusted-types forma forma-runtime`
 * accepts it at the sink. Elsewhere it returns a frozen stand-in that core's
 * sinks recognise and write as its markup. The policy passes markup through
 * unchanged: what `trustedHtml` is given is trusted, so the guarantee is the
 * name review and CI see, enforced at the sink by the browser.
 *
 * The 2.x bridge (L-18): every raw sink still takes a plain string and writes
 * it exactly as before; in a development build the first string each sink
 * receives logs one warning with a code:
 *
 * | Code | Sink |
 * |---|---|
 * | FORMA_W_RAW_INNER_HTML | `dangerouslySetInnerHTML` |
 * | FORMA_W_RAW_SET_HTML | `setHTMLUnsafe()` |
 * | FORMA_W_RAW_TEMPLATE | `template()`, `templateMany()` |
 * | FORMA_W_RAW_RECONCILE | `reconcile()` |
 * | FORMA_W_RAW_SRCDOC | `srcdoc` |
 * | FORMA_W_SCRIPT_ELEMENT | `h('script')` (refused in 3.0.0) |
 *
 * Under a Trusted Types policy a string written to a sink is the browser's
 * business: reported under Report-Only, refused when enforced.
 *
 * The second policy, `forma-runtime`, is the zero-build runtime's parser's
 * own: `reconcile()` trims what it is given before it parses it, and markup
 * that arrived as trusted HTML is minted again, trimmed, through it. A string
 * given to `reconcile()` is never minted: it reaches the sink as a string.
 */

import { __DEV__ } from '../reactive/dev.js';
import { isRawHtmlAttr } from '../security/url-safety.js';

declare const __FORMA_DEV_BUILD__: boolean | undefined;

/**
 * Markup vouched for by {@link trustedHtml}: a browser `TrustedHTML` where the
 * browser has Trusted Types, else Forma's frozen stand-in. Every raw sink takes
 * one beside a string; 3.0.0's sinks take only this.
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
interface HtmlPolicy {
  createHTML(input: string): unknown;
}

/** The part of `window.trustedTypes` core uses. */
interface TrustedTypesFactory {
  createPolicy(name: string, rules: { createHTML(input: string): string }): HtmlPolicy;
  isHTML(value: unknown): boolean;
}

/**
 * What every copy of core on a page shares, on `globalThis` under a
 * `Symbol.for` key: a policy name can be created once per page, and the
 * runtime's IIFE, core's ESM build and a development twin (FORMA-169) are
 * separate copies of this module.
 */
interface Registry {
  /** Forma's two policies, made on first use; `null` where there is none. */
  policies: Record<string, HtmlPolicy | null | undefined>;
  /** Each stand-in core made, with its markup. */
  minted: WeakMap<object, string>;
  /** The development codes already logged. */
  warned: Set<string>;
}

const REGISTRY_KEY = Symbol.for('@getforma/core#trusted-types');

function registry(): Registry {
  const host = globalThis as unknown as Record<symbol, Registry | undefined>;
  return host[REGISTRY_KEY] ??= { policies: {}, minted: new WeakMap(), warned: new Set() };
}

function factory(): TrustedTypesFactory | undefined {
  return (globalThis as { trustedTypes?: TrustedTypesFactory }).trustedTypes;
}

/**
 * Forma's policy `name`, made once per page on first use. `null` where the
 * browser has no Trusted Types, or refused the name (a page policy whose
 * `trusted-types` directive does not list it, enforced): markup is then
 * written as a string, which such a page reports or refuses at the sink.
 */
function policy(name: 'forma' | 'forma-runtime'): HtmlPolicy | null {
  const reg = registry();
  let found = reg.policies[name];
  if (found === undefined) {
    found = null;
    const tt = factory();
    if (tt) {
      try {
        found = tt.createPolicy(name, { createHTML: (input) => input });
      } catch {
        found = null;
      }
    }
    reg.policies[name] = found;
  }
  return found;
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
  const forma = policy('forma');
  if (forma) return forma.createHTML(html) as TrustedHtml;
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
 * What a sink writes for a value that is not a string: a `TrustedHTML` as it
 * is, so the browser sees a typed value; Forma's stand-in as its markup;
 * anything else as it is, for the sink to convert as it always did. Typed
 * `string` because that is what the DOM's typings take.
 */
export function htmlOf(value: unknown): string {
  const markup = registry().minted.get(value as object);
  return (markup ?? value) as string;
}

/**
 * What raw sink `sink` writes for `value`: {@link htmlOf}, and a plain string
 * as it is, after the sink's development warning (once per process).
 *
 * Verified by: src/dom/__tests__/trusted-html.test.ts > "a string to each raw sink still renders, and warns once with the sink's code in development"
 */
export function rawHtml(value: unknown, sink: RawSink): string {
  if (typeof value === 'string') {
    warnRawString(sink);
    return value;
  }
  return htmlOf(value);
}

/**
 * The zero-build runtime's parser's input (DR-20's second policy): `markup`,
 * trimmed from a value that arrived as trusted HTML, minted again through
 * `forma-runtime` where the browser has Trusted Types.
 *
 * Verified by: src/dom/__tests__/trusted-html.test.ts > "reconcile() parses trusted markup through the forma-runtime policy and a string through no policy"
 */
export function runtimeHtml(markup: string): string {
  const runtime = policy('forma-runtime');
  return (runtime ? runtime.createHTML(markup) : markup) as string;
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

/** Log `code`'s line once per page or process, whichever copy of core asks. */
function warnOnce(code: string, message: string): void {
  const warned = registry().warned;
  if (warned.has(code)) return;
  warned.add(code);
  console.warn(`[forma] ${code}: ${message}`);
}

/**
 * The development warning for a plain string given to raw sink `sink`.
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
      `${where} was given a plain string. ${note}Wrap markup you vouch for in trustedHtml(), ` +
      'so review and CI can find every raw entry; a string still works in 2.x, is reported ' +
      'by a page whose policy requires Trusted Types and refused where it enforces them, ' +
      'and 3.0.0 accepts only trustedHtml() (DR-19). Logged once, in development builds.',
    );
  }
}

/**
 * The development warning for a plain string written to attribute `name`,
 * when that attribute is a raw sink (`srcdoc`). The checks are inside the
 * build's condition, so a production build drops the call with them.
 *
 * Verified by: src/dom/__tests__/element-url-safety.test.ts > "emits srcdoc but warns that escaping does not neutralize it"
 */
export function warnRawAttr(name: string, value: unknown): void {
  // The condition of warnRawString, for the same reason.
  if ((typeof __FORMA_DEV_BUILD__ === 'boolean' && __FORMA_DEV_BUILD__)
    || (typeof __FORMA_DEV_BUILD__ !== 'boolean' && __DEV__)) {
    if (typeof value === 'string' && isRawHtmlAttr(name)) warnRawString('srcdoc');
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
      "h('script') built a script element. Under the page's 'strict-dynamic' policy a " +
      'script inserted by trusted code runs whatever its src or text names, so 3.0.0 ' +
      "refuses h('script') (DR-19): load scripts from the page or the build instead. " +
      'Logged once, in development builds.',
    );
  }
}
