/**
 * Forma DOM - Text
 *
 * Creates static or reactive Text nodes.
 * Zero dependencies -- native browser APIs only.
 */

import { internalEffect } from 'forma/reactive';

/**
 * Create a Text node that is either static or reactively bound.
 *
 * - If `value` is a string, creates a plain Text node.
 * - If `value` is a function (signal getter), creates a Text node and sets up
 *   an effect that auto-updates `textContent` whenever the signal changes.
 *
 * @returns The Text node.
 */
export function createText(value: string | (() => string)): Text {
  if (typeof value === 'function') {
    // "Track Limits": new Text() bypasses Document factory dispatch
    const node = new Text('');
    internalEffect(() => {
      // "DAS": CharacterData.data is the rawest text setter
      node.data = value();
    });
    return node;
  }
  return new Text(value);
}
