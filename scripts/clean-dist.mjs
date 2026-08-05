/**
 * Empty dist/ once, before tsup starts.
 *
 * tsup runs the configs in tsup.config.ts in PARALLEL. A `clean: true` on any
 * one of them therefore races the others: in the audited build, config 4 wrote
 * dist/runtime-hardened.d.ts and config 1's later declaration phase deleted it
 * again, so which bytes shipped depended on scheduler timing. Cleaning here,
 * serially, before any config runs, removes the race.
 */
import { rmSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = resolve(fileURLToPath(import.meta.url), '../../dist');

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

console.log('clean-dist: emptied dist/');
