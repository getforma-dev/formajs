/**
 * Run publint and attw over the development build, as `npm run check:pack`
 * runs them over the production one (FORMA-169).
 *
 * attw resolves `exports` under its own fixed conditions (node10, node16 from
 * CJS and from ESM, bundler) and has no option to add `development`, so on the
 * real package it never looks at dist/dev/. This script packs a copy of the
 * package in which every `development` leaf has taken its `default` leaf's
 * place, and lints that: attw then checks each development file against the
 * declarations it shares with production (the module format each resolution
 * mode expects, and that the CommonJS file really exports the names the
 * declarations promise), and publint checks the files' formats.
 *
 * Usage (after `npm run build`): node scripts/check-pack-development.mjs
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEV_CONDITION } from './build-defines.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

/** The JavaScript file behind an installed devDependency's command. */
function cli(name, command) {
  const dir = join(ROOT, 'node_modules', name);
  return join(dir, JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).bin[command]);
}

/** Replace each `{ …, development, default }` with `{ …, default: development }`. */
function promote(node) {
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === DEV_CONDITION) continue;
    out[key] = key === 'default' && typeof node[DEV_CONDITION] === 'string' ? node[DEV_CONDITION] : promote(value);
  }
  return out;
}

const promoted = { ...pkg, exports: promote(pkg.exports) };
const promotedLeaves = JSON.stringify(promoted.exports).match(/\.\/dist\/dev\//g)?.length ?? 0;
if (promotedLeaves === 0) {
  console.error(`check-pack-development: package.json has no ${DEV_CONDITION} condition to check`);
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), 'forma-pack-development-'));
let status = 0;
try {
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(promoted, null, 2)}\n`);
  cpSync(join(ROOT, 'dist'), join(dir, 'dist'), { recursive: true });
  cpSync(join(ROOT, 'LICENSE'), join(dir, 'LICENSE'));

  for (const [label, args] of [
    ['publint', [cli('publint', 'publint'), dir]],
    ['attw', [cli('@arethetypeswrong/cli', 'attw'), '--pack', dir]],
  ]) {
    console.log(`check-pack-development: ${label} over the development build (${promotedLeaves} leaves promoted)`);
    const result = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
    if (result.status !== 0) status = result.status ?? 1;
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
process.exit(status);
