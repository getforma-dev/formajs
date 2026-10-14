/**
 * Prove a change left every production file where it was: build `dist/` from
 * another git ref and compare this checkout's `dist/` with it, byte for byte.
 *
 * Usage (after `npm run build`): node scripts/dist-baseline.mjs [ref]
 *
 * `ref` defaults to `origin/main`. The ref is checked out into a temporary git
 * worktree and built there as CI builds it (`npm ci`, then its own `npm run
 * build`), and then `scripts/verify-dist.mjs --baseline` compares every file
 * under `dist/` but `dist/dev/`, maps and declarations included. The worktree
 * is removed afterwards. (Linking this checkout's `node_modules` instead would
 * be faster but is not equivalent: the bundles that inline alien-signals name
 * its path in a comment, and the link changes that path.)
 *
 * FORMA-169 ran it to show the development build changed no production byte.
 * It is not a CI gate: most changes are meant to change the production files.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const ref = process.argv[2] ?? 'origin/main';

/** Run a command, inheriting stdio; exit with its status if it fails. */
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    console.error(`dist-baseline: \`${command} ${args.join(' ')}\` failed in ${cwd}`);
    cleanup();
    process.exit(result.status ?? 1);
  }
}

if (!existsSync(join(ROOT, 'dist'))) {
  console.error('dist-baseline: no dist/ here; run `npm run build` first');
  process.exit(1);
}

const scratch = mkdtempSync(join(tmpdir(), 'forma-baseline-'));
const worktree = join(scratch, 'worktree');
function cleanup() {
  spawnSync('git', ['worktree', 'remove', '--force', worktree], { cwd: ROOT, stdio: 'ignore' });
  rmSync(scratch, { recursive: true, force: true });
}

run('git', ['worktree', 'add', '--detach', worktree, ref], ROOT);
console.log(`dist-baseline: building ${ref} in ${worktree}`);
run('npm', ['ci', '--prefer-offline', '--no-audit', '--no-fund', '--silent'], worktree);
run('npm', ['run', 'build', '--silent'], worktree);
run(process.execPath, [join(ROOT, 'scripts/verify-dist.mjs'), '--baseline', join(worktree, 'dist')], ROOT);
cleanup();
