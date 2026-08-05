/**
 * Post-build script.
 *
 * 1. Copies jsx.d.ts to dist and prepends a reference directive to
 *    dist/index.d.ts / dist/index.d.cts so consumers get JSX types
 *    automatically when importing @getforma/core.
 * 2. Collapses the duplicate `//# sourceMappingURL` footer that tsup appends
 *    when its Rollup tree-shaking pass runs (Rollup emits one, tsup appends
 *    another), so devtools do not fetch each map twice.
 * 3. Copies the CDN-friendly short names.
 *
 * Everything here is deterministic and unconditional: there is no
 * "copy X if Y is missing" fallback any more, because a missing tsup output is
 * a build bug that scripts/verify-dist.mjs must surface, not paper over.
 */
import { copyFileSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REF = '/// <reference path="./jsx.d.ts" />\n';

// Copy jsx.d.ts to dist
copyFileSync('src/jsx.d.ts', 'dist/jsx.d.ts');

// Prepend reference to .d.ts and .d.cts entry files
for (const file of ['dist/index.d.ts', 'dist/index.d.cts']) {
  const content = readFileSync(file, 'utf8');
  if (!content.includes('jsx.d.ts')) {
    writeFileSync(file, REF + content);
  }
}

/** Keep only the LAST sourceMappingURL footer of every emitted JS file. */
function dedupeSourceMapComments(dir) {
  let fixed = 0;
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) {
      fixed += dedupeSourceMapComments(abs);
      continue;
    }
    if (!/\.(?:js|cjs)$/.test(name)) continue;
    const code = readFileSync(abs, 'utf8');
    const matches = code.match(/^\/\/# sourceMappingURL=.*$/gm);
    if (!matches || matches.length < 2) continue;
    const kept = matches[matches.length - 1];
    let seen = 0;
    const stripped = code.replace(/^\/\/# sourceMappingURL=.*$\n?/gm, () =>
      ++seen === matches.length ? `${kept}\n` : ''
    );
    writeFileSync(abs, stripped);
    fixed += 1;
  }
  return fixed;
}

const deduped = dedupeSourceMapComments('dist');
console.log(`post-build: collapsed duplicate sourceMappingURL footers in ${deduped} file(s)`);

// CDN-friendly short names (prefixed to avoid overwriting tsup ESM output).
// The IIFE bundles are classic scripts, not modules: `var FormaRuntime = …` is
// module-scoped under both ESM and CJS, so importing one would run the runtime
// without ever defining the global it exists to define. That is why they are
// reachable by URL (`<script src>`) only, and not through the exports map.
copyFileSync('dist/formajs-runtime.global.js', 'dist/forma-runtime.js');
console.log('post-build: copied dist/formajs-runtime.global.js → dist/forma-runtime.js');
copyFileSync('dist/formajs-runtime-hardened.global.js', 'dist/forma-runtime-csp.js');
console.log('post-build: copied dist/formajs-runtime-hardened.global.js → dist/forma-runtime-csp.js');

console.log('post-build: jsx.d.ts copied and referenced in type declarations');
