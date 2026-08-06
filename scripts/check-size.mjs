/**
 * Bundle-size gate, shared by .github/workflows/ci.yml and release.yml.
 *
 * The gate this replaces gzipped `dist/index.js` alone. With `splitting: true`
 * most of the core lives in shared chunks that `dist/index.js` merely re-exports,
 * so moving code from the entry into a chunk — or growing a chunk — was free.
 * This version walks the ES module graph and weighs everything a consumer
 * actually downloads for that entry.
 *
 * Bare (non-relative) specifiers are reported but not weighed: they are real
 * dependencies the consumer installs, not bytes this repo emits. The browser
 * artifact has none by construction, which is checked separately in
 * scripts/verify-dist.mjs.
 *
 * Usage: node scripts/check-size.mjs [--json]
 */
import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, resolve, relative, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');

/**
 * Gate definitions.
 *
 * The two entries that carry no HTML runtime keep the historical policy —
 * roughly 20% above the measured size, so ordinary growth is visible in review
 * before it trips.
 *
 * The two RUNTIME bundles are deliberately tighter (~7%). They just absorbed
 * the largest single size change this package has taken: replacing the regex
 * expression parser and the `new Function` fallback with the allowlist AST
 * interpreter moved `formajs-runtime.global.js` from 26,194 to 31,763 B gzipped
 * (+5,569, +21%) and the hardened IIFE from 24,570 to 30,764 (+6,194, +25%).
 * The design note that costed this work projected roughly break-even from a
 * prototype that had no positional diagnostics, no DOM-host wrapping and no
 * handler statements; the shipped engine has all three, and it is twice the
 * prototype's size. A loose gate on top of that is how the next 5 KB arrives
 * unremarked, so these two are set close to the measurement on purpose.
 * Verified by: src/__tests__/check-size.test.ts > "gates every CDN runtime artifact the docs point at"
 */
export const GATES = [
  {
    entry: 'dist/index.js',
    limit: 30000,
    note: 'core ESM entry + every shared chunk it imports',
  },
  {
    entry: 'dist/formajs-runtime.global.js',
    limit: 34000,
    note: 'CDN runtime bundle (single self-contained IIFE)',
  },
  {
    entry: 'dist/forma.esm.js',
    limit: 29000,
    note: 'CDN browser ESM bundle (self-contained, inlines alien-signals)',
  },
  {
    // This artifact was gated NOWHERE — not here, not in ci.yml, not in
    // release.yml — while being the build the docs pointed CSP-strict users at
    // and the target of the `runtime-csp` exports subpath.
    entry: 'dist/formajs-runtime-hardened.global.js',
    limit: 33000,
    note: 'CDN hardened runtime bundle (single self-contained IIFE)',
  },
];

/**
 * Extract every module specifier referenced by static import/export-from
 * statements, bare side-effect imports, dynamic `import()` calls and CommonJS
 * `require()` calls (the .cjs half of the dual build uses the last form).
 *
 * Verified by: src/__tests__/check-size.test.ts > "parses static, side-effect, dynamic and require specifiers"
 */
export function parseImportSpecifiers(code) {
  const found = new Set();
  // `... from "spec"` covers `import x from`, `import {a} from`, `export * from`.
  // The leading class rules out `from` as the tail of an identifier or of a
  // string such as "data-forma-from", which would otherwise match.
  for (const m of code.matchAll(/(?:^|[\s;}*])from\s*["']([^"']+)["']/g)) found.add(m[1]);
  // Bare side-effect import at the start of a line: `import "spec";`
  for (const m of code.matchAll(/^[ \t]*import\s*["']([^"']+)["']/gm)) found.add(m[1]);
  // Dynamic import with a literal specifier.
  for (const m of code.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) found.add(m[1]);
  // CommonJS require with a literal specifier.
  for (const m of code.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g)) found.add(m[1]);
  return [...found];
}

/**
 * Walk the module graph from `entry` (a repo-relative path), following relative
 * specifiers only. Returns repo-relative file paths plus the bare specifiers
 * left unresolved.
 *
 * Verified by: src/__tests__/check-size.test.ts > "walks a chunked module graph transitively"
 */
export function collectGraph(entry, root = ROOT) {
  const absEntry = resolve(root, entry);
  if (!existsSync(absEntry)) throw new Error(`check-size: missing artifact ${entry}`);

  const files = [];
  const external = new Set();
  const seen = new Set();
  const queue = [absEntry];

  while (queue.length > 0) {
    const abs = queue.shift();
    if (seen.has(abs)) continue;
    seen.add(abs);
    files.push(relative(root, abs).split('\\').join('/'));

    const code = readFileSync(abs, 'utf8');
    for (const spec of parseImportSpecifiers(code)) {
      if (!spec.startsWith('.')) {
        external.add(spec);
        continue;
      }
      const target = resolve(dirname(abs), spec);
      if (!existsSync(target)) {
        throw new Error(`check-size: ${relative(root, abs)} imports missing file ${spec}`);
      }
      queue.push(target);
    }
  }

  return { files: files.sort(), external: [...external].sort() };
}

/** Gzipped size of a set of repo-relative files, summed. */
export function gzipTotal(files, root = ROOT) {
  let total = 0;
  for (const f of files) total += gzipSync(readFileSync(resolve(root, f))).length;
  return total;
}

/**
 * Weigh one gate. `over` is the verdict the CI step acts on, computed here
 * rather than at the call site so the comparison itself is testable.
 *
 * Verified by: src/__tests__/check-size.test.ts > "a gate reports over when its graph exceeds the limit"
 */
export function measure(gate, root = ROOT) {
  const { files, external } = collectGraph(gate.entry, root);
  const bytes = gzipTotal(files, root);
  return { ...gate, files, external, bytes, over: bytes > gate.limit };
}

function main() {
  const json = process.argv.includes('--json');
  const results = GATES.map((g) => measure(g));
  let failed = false;

  if (json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const r of results) {
      const pct = Math.round((r.bytes / r.limit) * 100);
      console.log(`${r.entry}`);
      console.log(`  ${r.bytes} B gzipped (limit ${r.limit}, ${pct}%) — ${r.note}`);
      console.log(`  files: ${r.files.map((f) => posix.basename(f)).join(', ')}`);
      if (r.external.length > 0) {
        console.log(`  external (not weighed): ${r.external.join(', ')}`);
      }
    }
  }

  for (const r of results) {
    if (r.over) {
      failed = true;
      console.error(`::error::${r.entry} is ${r.bytes} B gzipped, over the ${r.limit} B limit`);
    }
  }

  if (failed) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
