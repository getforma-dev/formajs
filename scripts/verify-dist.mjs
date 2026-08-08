/**
 * Post-build assertions on the artifacts that are about to be published.
 *
 * `npm run build` runs this last, so `npm ci && npm run build` in CI, the
 * release workflow and `prepublishOnly` all enforce it. Every check here
 * corresponds to a property some doc or comment asserts; if a check is removed,
 * the corresponding claim must be removed too.
 *
 * Usage: node scripts/verify-dist.mjs
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BROWSER_ESM_OUTPUT,
  CDN_URL_ARTIFACTS,
  EXTERNAL_DEPS_OUTPUTS,
  RAW_SOURCE_DEV_GLOBAL,
} from './build-defines.mjs';
import { parseImportSpecifiers, collectGraph } from './check-size.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));

const failures = [];
const fail = (msg) => failures.push(msg);
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

/** Every emitted JavaScript artifact under dist/ (not maps, not declarations). */
function jsArtifacts(dir = resolve(ROOT, 'dist'), out = []) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) jsArtifacts(abs, out);
    else if (/\.(?:js|cjs)$/.test(name)) out.push(relative(ROOT, abs).replace(/\\/g, '/'));
  }
  return out;
}

const SCRIPT_SRC = /<script[^>]+src=(?:"([^"]+)"|'([^']+)')/g;

/** Every .html file under examples/. */
function exampleHtmlFiles(dir = resolve(ROOT, 'examples'), out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) exampleHtmlFiles(abs, out);
    else if (name.endsWith('.html')) out.push(abs);
  }
  return out;
}

/** Collect every "./..." leaf from a nested exports/conditions object. */
function collectPaths(node, out = []) {
  if (typeof node === 'string') {
    if (node.startsWith('./')) out.push(node.slice(2));
    return out;
  }
  if (node && typeof node === 'object') {
    for (const value of Object.values(node)) collectPaths(value, out);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. Every path package.json promises actually exists
// ---------------------------------------------------------------------------

const sideEffectPaths = pkg.sideEffects.map((p) => p.replace(/^\.\//, ''));
const promised = new Set([
  ...collectPaths(pkg.exports),
  ...Object.values(pkg.typesVersions?.['*'] ?? {}).flat(),
  ...sideEffectPaths.filter((p) => !p.includes('*')),
  pkg.main.replace(/^\.\//, ''),
  pkg.module.replace(/^\.\//, ''),
  pkg.types.replace(/^\.\//, ''),
]);

for (const rel of [...promised].sort()) {
  if (rel === 'package.json') continue;
  if (!existsSync(resolve(ROOT, rel))) {
    fail(`package.json points at ${rel}, which the build did not produce`);
  }
}

for (const pattern of sideEffectPaths.filter((p) => p.includes('*'))) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*');
  const matcher = new RegExp(`^${escaped}$`);
  if (!jsArtifacts().some((rel) => matcher.test(rel))) {
    fail(`package.json sideEffects pattern ${pattern} matched no build artifact`);
  }
}

// A `require` condition must resolve to a file Node parses as CommonJS. Under
// "type": "module" that means the extension has to be .cjs.
function checkRequireLeaves(node, path = 'exports') {
  if (!node || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'require') {
      for (const target of collectPaths(value)) {
        if (target.endsWith('.js')) {
          fail(`${path}.require resolves to ${target}; a .js file is ESM under "type": "module"`);
        }
      }
    }
    checkRequireLeaves(value, `${path}.${key}`);
  }
}
checkRequireLeaves(pkg.exports);

// ---------------------------------------------------------------------------
// 2. The browser CDN artifact is self-contained; Node entries are not
// ---------------------------------------------------------------------------
// A `<script type="module">` loading from a CDN has no resolver: a bare
// specifier throws "Failed to resolve module specifier", and a relative chunk
// import turns one request into several. Neither may appear.

for (const rel of CDN_URL_ARTIFACTS) {
  if (!existsSync(resolve(ROOT, rel))) {
    fail(`missing ${rel} — a documented CDN URL would 404`);
  }
}

if (!existsSync(resolve(ROOT, BROWSER_ESM_OUTPUT))) {
  fail(`missing ${BROWSER_ESM_OUTPUT} — the documented ESM CDN recipe has no artifact`);
} else {
  const specifiers = parseImportSpecifiers(read(BROWSER_ESM_OUTPUT));
  if (specifiers.length > 0) {
    fail(`${BROWSER_ESM_OUTPUT} is not self-contained; it imports ${specifiers.join(', ')}`);
  }
}

// The Node-facing entries must keep their dependencies external, so that every
// consumer in a process shares one reactive graph.
for (const rel of EXTERNAL_DEPS_OUTPUTS) {
  const graph = collectGraph(rel, ROOT);
  for (const dep of Object.keys(pkg.dependencies ?? {})) {
    if (!graph.external.includes(dep)) {
      fail(`${rel} inlined ${dep}; it must stay external so consumers share one instance`);
    }
  }
}

// ---------------------------------------------------------------------------
// 3. __DEV__ is resolved at build time, never from NODE_ENV
// ---------------------------------------------------------------------------
// src/reactive/dev.ts mentions RAW_SOURCE_DEV_GLOBAL only inside the raw-source
// fallback that reads process.env.NODE_ENV. If the string survives into an
// artifact, the fallback was not folded away and dev warnings can fire in a
// production process that leaves NODE_ENV unset.

const CONSTANT_DEV_INITIALIZER = /^(?:false|!1)$/;

for (const rel of jsArtifacts()) {
  const code = read(rel);
  if (code.includes(RAW_SOURCE_DEV_GLOBAL)) {
    fail(`${rel} contains ${RAW_SOURCE_DEV_GLOBAL}: __DEV__ is computed at runtime, not fixed at build time`);
  }
  // Declaration only (`var __DEV__ = …`), and only up to the first separator:
  // syntax minification merges consecutive declarators into one `var` list.
  for (const m of code.matchAll(/\b(?:var|let|const)\s+__DEV__\s*=\s*([^,;\n]+)/g)) {
    const initializer = m[1].trim();
    if (!CONSTANT_DEV_INITIALIZER.test(initializer)) {
      fail(`${rel} binds __DEV__ to a non-constant initializer: ${initializer}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 4. NO artifact contains a dynamic-code path
// ---------------------------------------------------------------------------
// This used to check the two hardened runtime files. It now checks all of them:
// the `new Function` fallback and its `with (__scope)` wrapper were deleted
// from the source, so their absence is a property of every shipped byte rather
// than of one build's defines.
for (const rel of jsArtifacts()) {
  const code = read(rel);
  if (/new Function\s*\(/.test(code)) {
    fail(`${rel} contains \`new Function(\`; no build may emit dynamic code`);
  }
  if (/\bwith\s*\(\s*__scope\b/.test(code)) {
    fail(`${rel} still wraps expressions in \`with (__scope)\`; that sandbox is gone`);
  }
}

// ---------------------------------------------------------------------------
// 4b. Every <script src> in examples/ resolves to an emitted artifact
// ---------------------------------------------------------------------------
// examples/csp/index.html loaded dist/forma-runtime-csp.js while no build
// target emitted that name, so the one example whose whole point is CSP was
// dead on arrival.
for (const html of exampleHtmlFiles()) {
  const source = readFileSync(html, 'utf8');
  const rel = relative(ROOT, html).replace(/\\/g, '/');
  for (const m of source.matchAll(SCRIPT_SRC)) {
    const src = m[1];
    if (/^[a-z]+:/i.test(src) || src.startsWith('//')) continue;
    if (!existsSync(resolve(html, '..', src))) {
      fail(`${rel} loads ${src}, which the build does not produce`);
    }
  }
}

// ---------------------------------------------------------------------------
// 5. One source map reference per artifact
// ---------------------------------------------------------------------------
// A second //# sourceMappingURL is a symptom of one build stage appending
// output on top of another's, and makes devtools fetch the map twice.
for (const rel of jsArtifacts()) {
  const count = (read(rel).match(/^\/\/# sourceMappingURL=/gm) ?? []).length;
  if (count > 1) fail(`${rel} has ${count} sourceMappingURL comments; expected at most 1`);
}

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error('verify-dist: FAILED');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`verify-dist: ok (${jsArtifacts().length} JS artifacts checked)`);
