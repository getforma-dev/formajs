// Void elements that don't have closing tags
export const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

// Map of prop names to HTML attribute names
export const PROP_TO_ATTR: Record<string, string> = {
  className: 'class',
  htmlFor: 'for',
  tabIndex: 'tabindex',
};

// Escape HTML entities
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// Escape attribute values
export function escapeAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&#39;');
}

import { __DEV__ } from '../reactive/dev.js';
import {
  isDangerousUrl,
  isUrlAttr,
  isEventHandlerAttr,
  isRawHtmlAttr,
  isSafeAttrName,
  isSafeTagName,
} from '../security/url-safety.js';

/**
 * Decide whether a resolved prop should be emitted as an attribute, and return
 * the escaped `name="value"` fragment (or `name` for boolean `true`). Returns
 * null when the attribute must be dropped for safety. Shared by every SSR
 * renderer so the security rules cannot drift apart.
 *
 * `tag` is the element the attribute belongs to (`VNode.tag`); it decides
 * whether a `data:image/svg+xml` value lands in an image sink or a document
 * sink. Omitting it selects the strict interpretation, which rejects that
 * scheme rather than trusting an unnamed sink.
 *
 * Verified by: src/ssr/__tests__/render-safety.test.ts > "keeps data:image/svg+xml on an img but drops it on an iframe"
 */
export function renderAttr(key: string, resolved: unknown, tag?: string): string | null {
  const attrName = PROP_TO_ATTR[key] ?? key;
  // Never emit event-handler or malformed attribute names — an attacker who
  // controls a prop key could otherwise inject `onload=…` or break out of the
  // attribute entirely with whitespace/quotes.
  if (isEventHandlerAttr(attrName) || !isSafeAttrName(attrName)) return null;
  if (resolved === true) return ' ' + attrName;
  if (resolved === false || resolved == null) return null;
  const str = String(resolved);
  if (isUrlAttr(attrName) && isDangerousUrl(str, tag)) return null;
  // srcdoc is emitted, never blocked: a sandboxed `<iframe srcdoc>` is a
  // legitimate pattern. But escaping does NOT make it safe — the browser
  // entity-decodes the attribute and parses the result as an HTML document that
  // is same-origin with the page — so it is a trusted-content sink like
  // dangerouslySetInnerHTML, and says so in dev.
  // Verified by: src/ssr/__tests__/render-safety.test.ts > "warns in dev that srcdoc is a raw-HTML sink but still emits it"
  if (__DEV__ && isRawHtmlAttr(attrName)) {
    console.warn(
      `[forma] "${attrName}" is a raw-HTML sink: the browser parses its value as ` +
      `an HTML document, and attribute escaping does not neutralize that. Pass ` +
      `only trusted markup, and prefer a sandboxed iframe.`,
    );
  }
  return ' ' + attrName + '="' + escapeAttr(str) + '"';
}

export interface VNode {
  tag: string;
  props: Record<string, unknown> | null;
  children: unknown[];
}

/**
 * Server-side hyperscript — creates a virtual node instead of a DOM element.
 */
export function sh(tag: string, props?: Record<string, unknown> | null, ...children: unknown[]): VNode {
  return { tag, props: props ?? null, children };
}

/**
 * Render a FormaJS virtual tree to an HTML string.
 *
 * Uses an array buffer internally to avoid O(n^2) string concatenation
 * for large trees, then joins once at the end.
 *
 * Usage:
 * ```ts
 * import { renderToString, sh } from '@getforma/core/ssr';
 *
 * const html = renderToString(
 *   sh('div', { class: 'app' },
 *     sh('h1', null, 'Hello SSR!'),
 *     sh('p', null, () => count()),  // signal getters resolved synchronously
 *   )
 * );
 * ```
 */
export function renderToString(node: unknown): string {
  const parts: string[] = [];
  renderToBuffer(node, parts);
  return parts.join('');
}

/**
 * Internal: recursively render into a string array buffer.
 * Avoids O(n^2) string concatenation for large trees.
 */
function renderToBuffer(node: unknown, parts: string[]): void {
  // null/undefined/boolean → empty
  if (node == null || node === true || node === false) return;

  // String → escaped text
  if (typeof node === 'string') { parts.push(escapeHtml(node)); return; }

  // Number → stringified
  if (typeof node === 'number') { parts.push(String(node)); return; }

  // Function (signal getter) → resolve and render
  if (typeof node === 'function') { renderToBuffer(node(), parts); return; }

  // Array → render each
  if (Array.isArray(node)) {
    for (const child of node) renderToBuffer(child, parts);
    return;
  }

  // VNode
  if (isVNode(node)) {
    const { tag, props, children } = node;

    // A tag is interpolated verbatim, so it needs the same validation prop
    // names get: a tag taken from data (a CMS block type, an FMIR component
    // name) could otherwise inject an attribute or close the tag outright.
    // Verified by: src/ssr/__tests__/render-safety.test.ts > "drops a VNode whose tag would inject an attribute"
    if (!isSafeTagName(tag)) {
      if (__DEV__) console.warn(`[forma] Skipped VNode with an unsafe tag name: ${JSON.stringify(tag)}`);
      return;
    }

    parts.push('<', tag);

    // Render props as attributes
    if (props) {
      for (const [key, value] of Object.entries(props)) {
        // Skip refs and internal props; event handlers and unsafe attribute
        // names are dropped inside renderAttr.
        if (key === 'ref' || key === 'dangerouslySetInnerHTML') continue;

        // Resolve reactive values
        const resolved = typeof value === 'function' ? value() : value;

        const frag = renderAttr(key, resolved, tag);
        if (frag !== null) parts.push(frag);
      }
    }

    // Void elements
    if (VOID_ELEMENTS.has(tag)) { parts.push(' />'); return; }

    parts.push('>');

    // dangerouslySetInnerHTML
    if (props?.['dangerouslySetInnerHTML']) {
      const raw = props['dangerouslySetInnerHTML'];
      if (typeof raw === 'object' && raw != null && '__html' in raw) {
        const html = (raw as { __html: unknown }).__html;
        if (typeof html === 'string') {
          parts.push(html);
        } else {
          throw new TypeError('dangerouslySetInnerHTML must be { __html: string }');
        }
      } else {
        throw new TypeError('dangerouslySetInnerHTML must be { __html: string }');
      }
    } else {
      // Render children
      for (const child of children) {
        renderToBuffer(child, parts);
      }
    }

    parts.push('</', tag, '>');
    return;
  }

  // Fallback: stringify
  parts.push(escapeHtml(String(node)));
}

export function isVNode(v: unknown): v is VNode {
  return v != null && typeof v === 'object' && 'tag' in v && 'children' in v;
}
