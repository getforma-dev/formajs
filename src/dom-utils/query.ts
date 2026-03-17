// Typed query helpers

/**
 * Select a single element by CSS selector. Returns `null` if not found.
 *
 * ```ts
 * const btn = $<HTMLButtonElement>('.submit-btn');
 * const inner = $('span', container);
 * ```
 */
export function $<T extends HTMLElement = HTMLElement>(
  selector: string,
  parent?: ParentNode,
): T | null {
  return (parent ?? document).querySelector<T>(selector);
}

/**
 * Select all elements matching a CSS selector, returned as a plain array.
 *
 * ```ts
 * const items = $$<HTMLLIElement>('ul > li');
 * items.forEach((li) => li.classList.add('active'));
 * ```
 */
export function $$<T extends HTMLElement = HTMLElement>(
  selector: string,
  parent?: ParentNode,
): T[] {
  return Array.from((parent ?? document).querySelectorAll<T>(selector));
}
