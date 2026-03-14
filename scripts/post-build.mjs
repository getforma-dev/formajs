/**
 * Post-build script: copies jsx.d.ts to dist and prepends a reference
 * directive to dist/index.d.ts and dist/index.d.cts so consumers get
 * JSX types automatically when importing @getforma/core.
 */
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';

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

console.log('post-build: jsx.d.ts copied and referenced in type declarations');
