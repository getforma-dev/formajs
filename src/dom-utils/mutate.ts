// DOM mutation helpers

/** Add one or more CSS classes to an element. */
export function addClass(el: HTMLElement, ...classes: string[]): void {
  el.classList.add(...classes);
}

/** Remove one or more CSS classes from an element. */
export function removeClass(el: HTMLElement, ...classes: string[]): void {
  el.classList.remove(...classes);
}

/** Toggle a CSS class on an element. Returns the resulting state. */
export function toggleClass(
  el: HTMLElement,
  className: string,
  force?: boolean,
): boolean {
  return el.classList.toggle(className, force);
}

/**
 * Apply multiple inline styles to an element at once.
 *
 * ```ts
 * setStyle(el, { opacity: '0', transform: 'translateY(-10px)' });
 * ```
 */
export function setStyle(
  el: HTMLElement,
  styles: Partial<CSSStyleDeclaration>,
): void {
  for (const [key, value] of Object.entries(styles)) {
    if (value !== undefined) {
      (el.style as any)[key] = value;
    }
  }
}

/**
 * Set or remove multiple attributes on an element.
 *
 * - `false` / `null` removes the attribute.
 * - `true` sets it as a boolean attribute (empty string).
 * - A string sets the attribute value.
 */
export function setAttr(
  el: HTMLElement,
  attrs: Record<string, string | boolean | null>,
): void {
  for (const [name, value] of Object.entries(attrs)) {
    if (value === false || value === null) {
      el.removeAttribute(name);
    } else if (value === true) {
      el.setAttribute(name, '');
    } else {
      el.setAttribute(name, value);
    }
  }
}

/** Set an element's text content. Safe for user-controlled strings. */
export function setText(el: HTMLElement, text: string): void {
  el.textContent = text;
}

/**
 * Set raw HTML on an element. **No sanitization is performed.**
 *
 * Prefer `setText()` for user-controlled content. Only use this when you
 * trust the HTML source (e.g., server-rendered markup you control).
 */
export function setHTMLUnsafe(el: HTMLElement, html: string): void {
  el.innerHTML = html;
}
