// Typed query helpers

export function $<T extends HTMLElement = HTMLElement>(
  selector: string,
  parent?: ParentNode,
): T | null {
  return (parent ?? document).querySelector<T>(selector);
}

export function $$<T extends HTMLElement = HTMLElement>(
  selector: string,
  parent?: ParentNode,
): T[] {
  return Array.from((parent ?? document).querySelectorAll<T>(selector));
}
