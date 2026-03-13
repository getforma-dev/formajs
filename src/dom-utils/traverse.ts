// DOM traversal helpers

export function closest<T extends HTMLElement = HTMLElement>(
  el: HTMLElement,
  selector: string,
): T | null {
  return el.closest<T>(selector);
}

export function children<T extends HTMLElement = HTMLElement>(
  el: HTMLElement,
  selector?: string,
): T[] {
  const all = Array.from(el.children) as HTMLElement[];
  if (!selector) return all as T[];
  return all.filter((child) => child.matches(selector)) as T[];
}

export function siblings<T extends HTMLElement = HTMLElement>(
  el: HTMLElement,
  selector?: string,
): T[] {
  const parentEl = el.parentElement;
  if (!parentEl) return [];
  const all = Array.from(parentEl.children) as HTMLElement[];
  const sibs = all.filter((child) => child !== el);
  if (!selector) return sibs as T[];
  return sibs.filter((child) => child.matches(selector)) as T[];
}

export function parent<T extends HTMLElement = HTMLElement>(
  el: HTMLElement,
): T | null {
  return el.parentElement as T | null;
}

export function nextSibling<T extends HTMLElement = HTMLElement>(
  el: HTMLElement,
  selector?: string,
): T | null {
  let sib = el.nextElementSibling;
  while (sib) {
    if (sib instanceof HTMLElement) {
      if (!selector || sib.matches(selector)) {
        return sib as T;
      }
    }
    sib = sib.nextElementSibling;
  }
  return null;
}

export function prevSibling<T extends HTMLElement = HTMLElement>(
  el: HTMLElement,
  selector?: string,
): T | null {
  let sib = el.previousElementSibling;
  while (sib) {
    if (sib instanceof HTMLElement) {
      if (!selector || sib.matches(selector)) {
        return sib as T;
      }
    }
    sib = sib.previousElementSibling;
  }
  return null;
}
