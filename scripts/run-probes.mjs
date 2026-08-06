#!/usr/bin/env node
/**
 * Mutation-probe harness — a curated mutation-testing run.
 *
 * Each entry in `probes/corpus.json` is one surgical edit that breaks a real
 * property of this codebase, and most of them are edits that reproduce a defect
 * this repo actually shipped (see `docs/archive/2026-08-05-hardening-audit.md`). The harness
 * applies each one, runs the whole suite, records whether the suite went red,
 * and restores the file.
 *
 * A SURVIVOR is always news: it means a property nothing in the suite defends.
 *
 * Why this and not Stryker: Stryker generates thousands of mutants, most of
 * them equivalent or uninteresting, and takes hours. This corpus takes ~15
 * minutes and every mutant in it is a defect shape we have already been bitten
 * by, so the score is meaningful rather than merely large. Every probe written
 * during a bug investigation gets committed here, which is what makes the audit
 * compound instead of expire.
 *
 * Usage:
 *   node scripts/run-probes.mjs                 # full run, writes probes/results.json
 *   node scripts/run-probes.mjs --check         # anchors only, no test runs (seconds)
 *   node scripts/run-probes.mjs --only=a,b      # named probes
 *   node scripts/run-probes.mjs --tag=security  # one subset
 *   node scripts/run-probes.mjs --floor=85      # exit non-zero below this rate
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';

const ROOT = process.cwd();
const CORPUS = resolve(ROOT, 'probes/corpus.json');
const OUT = resolve(ROOT, 'probes/results.json');

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const checkOnly = args.includes('--check');
const only = flag('only')?.split(',');
const tag = flag('tag');
const floor = flag('floor') ? Number(flag('floor')) : null;

const corpus = JSON.parse(readFileSync(CORPUS, 'utf8'));
const selected = corpus.filter(
  (p) => (!only || only.includes(p.id)) && (!tag || (p.tags ?? []).includes(tag)),
);

/**
 * `probe-corpus.test.ts` asserts that every probe's anchor still applies to the
 * file it names — by reading that production file. Under a probe, the anchor it
 * just replaced is by definition gone, so that test fails for EVERY mutant and
 * every mutant scores as CAUGHT whether or not a real test noticed. This lane's
 * own first measurement reported 93/93 for exactly that reason and was wrong.
 * It is excluded here, and it is the only file that may be.
 */
const SELF_REFERENTIAL = '**/probe-corpus.test.ts';
const VITEST_ARGS = ['--reporter=dot', '--bail=1', '--exclude', SELF_REFERENTIAL];

const vitest = join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');
if (!checkOnly && !existsSync(vitest)) {
  console.error('vitest not installed — run npm ci first');
  process.exit(2);
}

const results = [];
for (const p of selected) {
  const abs = resolve(ROOT, p.file);
  if (!existsSync(abs)) {
    results.push({ id: p.id, status: 'FILE_MISSING' });
    console.log(`${p.id.padEnd(44)} FILE_MISSING`);
    continue;
  }
  const original = readFileSync(abs, 'utf8');
  const norm = original.replace(/\r\n/g, '\n');
  const hits = norm.split(p.find).length - 1;
  if (hits === 0 || (hits > 1 && !p.all)) {
    results.push({ id: p.id, status: 'ANCHOR_STALE', hits });
    console.log(`${p.id.padEnd(44)} ANCHOR_STALE (${hits} hits)`);
    continue;
  }
  if (checkOnly) {
    results.push({ id: p.id, status: 'APPLIES' });
    continue;
  }

  writeFileSync(abs, norm.split(p.find).join(p.replace));
  try {
    const r = spawnSync(process.execPath, [vitest, 'run', ...VITEST_ARGS], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 15 * 60_000,
    });
    if (r.error) throw r.error;
    // Strip ANSI so `killedBy` resolves — the name of the test that actually
    // went red is what makes a CAUGHT auditable rather than merely counted.
    // eslint-disable-next-line no-control-regex
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.replace(/\[[0-9;]*m/g, '');
    const caught = r.status !== 0;
    const killedBy = (out.match(/^\s*FAIL\s+(.+)$/m) ?? [])[1]?.trim() ?? null;
    // A probe marked `equivalent` cannot change observable behaviour — the
    // corpus entry carries the proof. It is expected to survive, so it is
    // reported but kept out of the rate; leaving it in would put a permanent
    // ceiling on a number that is supposed to be reachable.
    const status = caught ? 'CAUGHT' : p.equivalent ? 'EQUIVALENT' : 'SURVIVED';
    results.push({
      id: p.id, file: p.file, tags: p.tags ?? [], note: p.note,
      equivalent: p.equivalent ?? null, status, killedBy,
    });
    console.log(`${p.id.padEnd(44)} ${status}${killedBy ? `  ${killedBy}` : ''}`);
  } finally {
    writeFileSync(abs, original);
  }
  writeFileSync(OUT, `${JSON.stringify(results, null, 1)}\n`);
}

if (checkOnly) {
  const stale = results.filter((r) => r.status !== 'APPLIES');
  console.log(`${results.length - stale.length}/${results.length} probes still apply`);
  process.exit(stale.length ? 1 : 0);
}

writeFileSync(OUT, `${JSON.stringify(results, null, 1)}\n`);

const scored = results.filter((r) => r.status === 'CAUGHT' || r.status === 'SURVIVED');
const rate = (subset) =>
  subset.length ? Math.round((100 * subset.filter((r) => r.status === 'CAUGHT').length) / subset.length) : null;

const overall = rate(scored);
const security = rate(scored.filter((r) => (r.tags ?? []).includes('security')));
const render = rate(scored.filter((r) => r.file === 'src/ssr/render.ts'));

console.log('\n--- detection ---');
console.log(`overall        ${scored.filter((r) => r.status === 'CAUGHT').length}/${scored.length} = ${overall}%`);
if (security !== null) console.log(`security       ${security}%`);
if (render !== null) console.log(`ssr/render.ts  ${render}%`);

const equivalent = results.filter((r) => r.status === 'EQUIVALENT');
if (equivalent.length) {
  console.log(`\nequivalent mutants, excluded from the rate (${equivalent.length}):`);
  for (const e of equivalent) console.log(`  ${e.id.padEnd(40)} ${e.equivalent}`);
}

const survivors = results.filter((r) => r.status === 'SURVIVED');
if (survivors.length) {
  console.log('\nsurvivors (each one is a property nothing defends):');
  for (const s of survivors) console.log(`  ${s.id.padEnd(40)} ${s.note}`);
}

if (floor !== null && overall < floor) {
  console.error(`\ndetection ${overall}% is below the ${floor}% floor`);
  process.exit(1);
}
