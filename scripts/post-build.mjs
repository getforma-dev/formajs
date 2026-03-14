/**
 * Post-build script: copies jsx.d.ts to dist and prepends a reference
 * directive to dist/index.d.ts and dist/index.d.cts so consumers get
 * JSX types automatically when importing @getforma/core.
 */
import { copyFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

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

// Ensure runtime-hardened type declarations exist (same types as runtime)
for (const ext of ['.d.ts', '.d.cts']) {
  const src = `dist/runtime${ext}`;
  const dest = `dist/runtime-hardened${ext}`;
  if (existsSync(src) && !existsSync(dest)) {
    copyFileSync(src, dest);
    console.log(`post-build: copied ${src} → ${dest}`);
  }
}

// CDN-friendly short names
copyFileSync('dist/formajs-runtime.global.js', 'dist/runtime.js');
console.log('post-build: copied dist/formajs-runtime.global.js → dist/runtime.js');
copyFileSync('dist/formajs-runtime-hardened.global.js', 'dist/runtime-csp.js');
console.log('post-build: copied dist/formajs-runtime-hardened.global.js → dist/runtime-csp.js');

console.log('post-build: jsx.d.ts copied and referenced in type declarations');
