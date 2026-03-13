/**
 * Forma DOM - Portal
 *
 * Renders children into a different DOM container than the parent.
 * Useful for modals, tooltips, dropdowns that need to escape overflow.
 *
 * SolidJS equivalent: <Portal mount={}>
 */

import { createEffect } from 'forma/reactive';

/**
 * Render content into an external DOM container.
 *
 * ```ts
 * const modal = createPortal(
 *   () => h('div', { class: 'modal' }, 'Modal content'),
 *   document.body,
 * );
 * ```
 *
 * Returns a comment node placeholder. The actual content is rendered
 * into the target container. Cleanup removes content from target.
 */
export function createPortal(
  children: () => Node,
  target?: Element | string,
): Comment {
  const placeholder = document.createComment('forma-portal');

  const resolvedTarget = typeof target === 'string'
    ? document.querySelector(target)
    : (target ?? document.body);

  if (!resolvedTarget) {
    throw new Error(`createPortal: target not found: ${target}`);
  }

  let mountedNode: Node | null = null;
  const removeMountedNode = () => {
    if (mountedNode && mountedNode.parentNode === resolvedTarget) {
      resolvedTarget.removeChild(mountedNode);
    }
    mountedNode = null;
  };

  createEffect(() => {
    const node = children();

    // Remove previous
    removeMountedNode();

    mountedNode = node;
    resolvedTarget.appendChild(node);

    // Ensure portal content is removed when the owner root disposes.
    return () => {
      removeMountedNode();
    };
  });

  return placeholder;
}
