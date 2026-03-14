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
 * Returns a script tag that swaps a specific Suspense boundary's content.
 * Called when an async resource resolves during streaming.
 */
export function getSwapTag(id: string, html: string): string {
  // Use JSON.stringify for both arguments to handle all edge cases:
  // backslashes, quotes, newlines, null bytes, </script>, unicode escapes
  return `<script>$FORMA_SWAP(${JSON.stringify(id)},${JSON.stringify(html)})</script>`;
}
