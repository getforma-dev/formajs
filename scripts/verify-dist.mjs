/**
 * Post-build assertions on the artifacts that are about to be published.
 *
 * `npm run build` runs this last, so `npm ci && npm run build` in CI, the
 * release workflow and `prepublishOnly` all enforce it. Every check here
 * corresponds to a property some doc or comment asserts; if a check is removed,
 * the corresponding claim must be removed too.
 *
 * Usage: node scripts/verify-dist.mjs [--baseline <dir>]
 *
 * `--baseline <dir>` also compares every production file (everything under
 * dist/ but dist/dev/) with the same path under `<dir>`, a dist/ built from
 * another commit, and fails on any file that differs, is missing or is new.
 * `node scripts/dist-baseline.mjs [ref]` builds that baseline from a git ref
 * (default `origin/main`) and runs this with it.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import {
  BROWSER_ESM_OUTPUT,
  CDN_URL_ARTIFACTS,
  DEV_CONDITION,
  DEV_OUT_DIR,
  EXTERNAL_DEPS_OUTPUTS,
  RAW_SOURCE_DEV_GLOBAL,
} from './build-defines.mjs';
import { parseImportSpecifiers, collectGraph } from './check-size.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
const { values: args } = parseArgs({ options: { baseline: { type: 'string' } } });

const failures = [];
const fail = (msg) => failures.push(msg);
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

/** True for a file of the development build (FORMA-169), false for production. */
const isDevelopment = (rel) => rel.startsWith(`${DEV_OUT_DIR}/`);

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
//
// The same holds for the development build under dist/dev/ (FORMA-169), with
// the constant folded to `true`: it decides development by how it was
// resolved, never by reading the environment.

const PRODUCTION_DEV_INITIALIZER = /^(?:false|!1)$/;
const DEVELOPMENT_DEV_INITIALIZER = /^(?:true|!0)$/;
/** Development files that bind `__DEV__` (to anything). */
const devBindings = new Set();

for (const rel of jsArtifacts()) {
  const code = read(rel);
  if (code.includes(RAW_SOURCE_DEV_GLOBAL)) {
    fail(`${rel} contains ${RAW_SOURCE_DEV_GLOBAL}: __DEV__ is computed at runtime, not fixed at build time`);
  }
  const expected = isDevelopment(rel) ? DEVELOPMENT_DEV_INITIALIZER : PRODUCTION_DEV_INITIALIZER;
  // Declaration only (`var __DEV__ = …`), and only up to the first separator:
  // syntax minification merges consecutive declarators into one `var` list.
  for (const m of code.matchAll(/\b(?:var|let|const)\s+__DEV__\s*=\s*([^,;\n]+)/g)) {
    const initializer = m[1].trim();
    if (isDevelopment(rel)) devBindings.add(rel);
    if (!expected.test(initializer)) {
      fail(`${rel} binds __DEV__ to ${initializer}; a ${isDevelopment(rel) ? 'development' : 'production'} artifact must bind it to the constant ${isDevelopment(rel) ? 'true' : 'false'}`);
    }
  }
}

// The development entries really are development builds: the root entry's
// module graph binds `__DEV__` in its shared chunk, and (above) binds it to
// `true`. Without this a twin built with the production define would pass
// every check in this section. (The hardened runtime is not code-split, so
// the constant is inlined at each use and no binding is left; section 6
// checks that its twin differs from it.)
for (const rel of [`${DEV_OUT_DIR}/index.js`, `${DEV_OUT_DIR}/index.cjs`]) {
  if (!existsSync(resolve(ROOT, rel))) continue; // reported by section 1
  if (!collectGraph(rel, ROOT).files.some((file) => devBindings.has(file))) {
    fail(`${rel} binds no __DEV__ anywhere in its module graph: it is not a development build`);
  }
}

// ---------------------------------------------------------------------------
// 3b. The deprecated entries' warnings are development-only
// ---------------------------------------------------------------------------
// `./server`, `./wasm` and `./ssr` log a coded deprecation the first time they
// load in a development build (src/deprecated.ts). Each call sits behind a
// condition the production define folds to `false`, so the build drops it and
// its import. If a code survives into a production artifact, the fold broke
// and the published bytes changed. The development twins must keep it: that
// warning is what they are for.
for (const rel of jsArtifacts()) {
  if (!isDevelopment(rel) && read(rel).includes('FORMA_W_DEPRECATED_')) {
    fail(`${rel} contains a FORMA_W_DEPRECATED_ warning: the development-only deprecation was not folded away`);
  }
}
for (const [entry, code] of [
  ['server', 'FORMA_W_DEPRECATED_SERVER'],
  ['wasm', 'FORMA_W_DEPRECATED_WASM'],
  ['ssr/index', 'FORMA_W_DEPRECATED_SSR'],
]) {
  for (const ext of ['js', 'cjs']) {
    const rel = `${DEV_OUT_DIR}/${entry}.${ext}`;
    if (!existsSync(resolve(ROOT, rel))) continue; // reported by section 1
    if (!collectGraph(rel, ROOT).files.some((file) => read(file).includes(code))) {
      fail(`${rel} does not log ${code}: the development build lost the deprecation warning`);
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
// 6. Every subpath has a development twin, and the two builds never mix
// ---------------------------------------------------------------------------
// FORMA-169. Each `import` and `require` branch reads
// `{ types, development: ./dist/dev/X, default: ./dist/X }`: the declarations
// are shared, and the development file is the production file's twin. A
// resolver takes the first condition it accepts, so `development` must come
// before `default`, or nothing would ever select it.

/** Each `{ …, default }` conditions object in `exports`, with its path. */
function conditionObjects(node, path = 'exports', out = []) {
  if (!node || typeof node !== 'object') return out;
  if (typeof node.default === 'string' || typeof node[DEV_CONDITION] === 'string') out.push([path, node]);
  for (const [key, value] of Object.entries(node)) {
    conditionObjects(value, key.startsWith('.') ? `${path}["${key}"]` : `${path}.${key}`, out);
  }
  return out;
}

const twinOf = (leaf) => leaf.replace(/^\.\/dist\//, `./${DEV_OUT_DIR}/`);

for (const [path, node] of conditionObjects(pkg.exports)) {
  if (typeof node.default !== 'string' || !/^\.\/dist\/.+\.c?js$/.test(node.default)) continue;
  const keys = Object.keys(node);
  if (node[DEV_CONDITION] !== twinOf(node.default)) {
    fail(`${path}.${DEV_CONDITION} is ${node[DEV_CONDITION] ?? 'missing'}; it must be ${twinOf(node.default)}, the development twin of ${node.default}`);
  } else if (keys.indexOf(DEV_CONDITION) > keys.indexOf('default')) {
    fail(`${path}.${DEV_CONDITION} comes after default, so no resolver would ever select it`);
  } else {
    const [prod, dev] = [node.default, node[DEV_CONDITION]].map((leaf) => resolve(ROOT, leaf));
    // Same sources and options: a twin identical to its production file was
    // built with the production define.
    if (existsSync(prod) && existsSync(dev) && readFileSync(prod).equals(readFileSync(dev))) {
      fail(`${path}.${DEV_CONDITION} (${node[DEV_CONDITION]}) is byte-identical to ${node.default}: it is not a development build`);
    }
  }
}

// The graphs never cross. A development entry imports only development
// chunks and a production entry only production ones, so a resolver, which
// applies one set of conditions to every specifier, reaches one build's copy
// of core's reactive state, never both.
for (const [path, node] of conditionObjects(pkg.exports)) {
  for (const [condition, leaf] of Object.entries(node)) {
    if (typeof leaf !== 'string' || !/\.c?js$/.test(leaf)) continue;
    const rel = leaf.replace(/^\.\//, '');
    if (!existsSync(resolve(ROOT, rel))) continue; // reported by section 1
    const development = condition === DEV_CONDITION;
    for (const file of collectGraph(rel, ROOT).files) {
      if (isDevelopment(file) !== development) {
        fail(`${path}.${condition} (${rel}) loads ${file}: a ${development ? 'development' : 'production'} entry must not load the other build`);
      }
    }
  }
}

// What Node actually resolves, for every subpath and both module systems,
// without and with the condition. A bundler's resolver follows the same
// algorithm; Node's is the reference implementation of it.
const SPECIFIERS = Object.keys(pkg.exports)
  .filter((key) => key !== './package.json')
  .map((key) => [key, key === '.' ? pkg.name : `${pkg.name}/${key.slice(2)}`]);

function resolvedBy(conditions) {
  const script = [
    "import { createRequire } from 'node:module';",
    "import { fileURLToPath } from 'node:url';",
    `const require = createRequire(${JSON.stringify(resolve(ROOT, 'package.json'))});`,
    'const out = {};',
    `for (const spec of ${JSON.stringify(SPECIFIERS.map(([, spec]) => spec))}) {`,
    '  out[spec] = { import: fileURLToPath(import.meta.resolve(spec)), require: require.resolve(spec) };',
    '}',
    'console.log(JSON.stringify(out));',
  ].join('\n');
  const result = spawnSync(
    process.execPath,
    [...conditions.map((c) => `--conditions=${c}`), '--input-type=module', '-e', script],
    { cwd: ROOT, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    fail(`node ${conditions.map((c) => `--conditions=${c}`).join(' ')} could not resolve the subpaths: ${result.stderr.trim()}`);
    return undefined;
  }
  return JSON.parse(result.stdout);
}

for (const conditions of [[], [DEV_CONDITION]]) {
  const resolved = resolvedBy(conditions);
  if (!resolved) continue;
  const leaf = conditions.length ? DEV_CONDITION : 'default';
  for (const [key, spec] of SPECIFIERS) {
    for (const system of ['import', 'require']) {
      const expected = pkg.exports[key][system]?.[leaf];
      if (!expected) continue;
      const actual = relative(ROOT, resolved[spec][system]).replace(/\\/g, '/');
      if (actual !== expected.replace(/^\.\//, '')) {
        fail(`${system} ${spec} ${conditions.length ? `with --conditions=${DEV_CONDITION}` : 'without conditions'} resolved to ${actual}, expected ${expected}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 7. Optionally: the production files are another build's, byte for byte
// ---------------------------------------------------------------------------
// With `--baseline <dir>`: every file under dist/ but dist/dev/, maps and
// declarations included, must be identical to the same path under <dir>, and
// the two must hold the same set of files. FORMA-169 used it to prove that
// adding the development build changed no production byte.

/** Every file under `dir`, as paths relative to it. */
function filesUnder(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) filesUnder(abs, base, out);
    else out.push(relative(base, abs).replace(/\\/g, '/'));
  }
  return out;
}

let baselineSummary = '';
if (args.baseline) {
  const baseline = resolve(args.baseline);
  const devPrefix = `${DEV_OUT_DIR.replace(/^dist\//, '')}/`;
  const ours = filesUnder(resolve(ROOT, 'dist')).filter((rel) => !rel.startsWith(devPrefix));
  const theirs = existsSync(baseline) ? filesUnder(baseline).filter((rel) => !rel.startsWith(devPrefix)) : [];
  if (theirs.length === 0) fail(`--baseline ${args.baseline} holds no build`);
  const theirSet = new Set(theirs);
  let same = 0;
  for (const rel of ours) {
    if (!theirSet.has(rel)) fail(`dist/${rel} is new: the baseline has no such production file`);
    else if (!readFileSync(resolve(ROOT, 'dist', rel)).equals(readFileSync(join(baseline, rel)))) fail(`dist/${rel} differs from the baseline`);
    else same += 1;
  }
  for (const rel of theirs) {
    if (!ours.includes(rel)) fail(`dist/${rel} is missing: the baseline has it`);
  }
  baselineSummary = `; ${same} of ${theirs.length} production files byte-identical to ${args.baseline}`;
}

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error('verify-dist: FAILED');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`verify-dist: ok (${jsArtifacts().length} JS artifacts checked${baselineSummary})`);
