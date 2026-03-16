/**
 * FormaJS SSR - Client Swap Script
 *
 * Tiny inline script injected into the HTML stream that handles
 * out-of-order Suspense boundary resolution.
 *
 * When the server resolves a Suspense boundary, it sends:
 *   <script>$FORMA_SWAP("forma-s:0","<resolved html>")</script>
 *
 * This script replaces the fallback placeholder with the resolved content.
 */

/**
 * Returns the client-side swap script as a string, ready to be injected
 * into the HTML stream (typically right after <body> or before first Suspense).
 */
export function getSwapScript(): string {
  return `<script>
function $FORMA_SWAP(id,html){
  var el=document.getElementById(id);
  if(el){
    var tpl=document.createElement('template');
    tpl.innerHTML=html;
    el.replaceWith(tpl.content);
  }
}
</script>`;
}

/**
 * Serializes a value to a JSON string that is safe to embed inside a
 * `<script>` block. Standard `JSON.stringify` does not escape `<` or `>`,
 * so a payload containing `</script>` would prematurely close the script
 * tag, enabling an injection attack. We also escape U+2028 and U+2029
 * which are valid JSON but treated as line terminators in JavaScript source.
 */
function safeJsonStringify(val: unknown): string {
  return JSON.stringify(val)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Returns a script tag that swaps a specific Suspense boundary's content.
 * Called when an async resource resolves during streaming.
 */
export function getSwapTag(id: string, html: string): string {
  // safeJsonStringify escapes <, >, U+2028, and U+2029 so the serialized
  // content cannot break out of the surrounding <script> block.
  return `<script>$FORMA_SWAP(${safeJsonStringify(id)},${safeJsonStringify(html)})</script>`;
}
