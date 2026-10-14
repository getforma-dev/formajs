/**
 * The zero-build runtime's parser's policy, `forma-runtime` (DR-20's second
 * policy), for `reconcile()` alone: kept out of `trusted-html.ts` so that
 * core's entry, which has no `reconcile()`, does not carry it.
 *
 * The handle every copy of core shares takes only a browser `TrustedHTML`:
 * nothing on the registry mints a `forma-runtime` value from a string.
 */

import { createPolicy, factory, registry } from './trusted-html.js';

/**
 * What the runtime's parser gets for markup that arrived as a browser
 * `TrustedHTML`, from {@link runtimeParser}.
 */
export interface RuntimeParser {
  /** The markup, trimmed, minted through `forma-runtime`. */
  html: string;
  /**
   * A fresh parse of {@link html}: in an inert `<template>`, or, given
   * `context`, in that element's own context (`Range.createContextualFragment`,
   * a Trusted Types sink that takes the minted value), so what the parse
   * yields is what the element would have parsed itself and the nodes can be
   * written as they are, never as a string parsed again.
   */
  parse(context?: Element): DocumentFragment;
  /**
   * The `srcdoc` of an iframe that {@link parse} produced, minted through
   * `forma-runtime`; null for any other element. Its value came out of
   * trusted markup, and on a page enforcing Trusted Types only a trusted
   * write can have changed it since.
   */
  srcdoc(el: Element): string | null;
}

/**
 * The zero-build runtime's parser (DR-20's second policy) for `value`, when
 * `value` is a browser `TrustedHTML` and the page has `forma-runtime`; null
 * otherwise, a string or Forma's stand-in included, whose markup the runtime
 * then writes as a string.
 *
 * Verified by: src/dom/__tests__/trusted-html.test.ts > "reconcile() parses trusted markup through the forma-runtime policy and a string through no policy"
 * Verified by: src/dom/__tests__/trusted-html.test.ts > "the shared registry holds no policy, and its forma-runtime handle mints nothing from a string"
 */
export function runtimeParser(value: unknown): RuntimeParser | null {
  const reg = registry();
  if (reg.runtime === undefined) {
    const runtime = createPolicy('forma-runtime');
    reg.runtime = runtime && ((trusted: unknown): RuntimeParser | null => {
      const tt = factory();
      if (!tt || typeof trusted !== 'object' || trusted === null || !tt.isHTML(trusted)) return null;
      const html = runtime.createHTML(String(trusted).trim()) as string;
      const parsed = new WeakSet<Element>();
      return {
        html,
        parse(context) {
          let content: DocumentFragment;
          if (context) {
            const range = context.ownerDocument.createRange();
            range.selectNodeContents(context);
            content = range.createContextualFragment(html);
          } else {
            const tpl = document.createElement('template');
            tpl.innerHTML = html;
            content = tpl.content;
          }
          for (const frame of content.querySelectorAll('iframe')) parsed.add(frame);
          return content;
        },
        srcdoc(el) {
          const doc = parsed.has(el) ? el.getAttribute('srcdoc') : null;
          return doc === null ? null : runtime.createHTML(doc) as string;
        },
      };
    });
  }
  return reg.runtime ? reg.runtime(value) as RuntimeParser | null : null;
}
