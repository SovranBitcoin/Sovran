#!/usr/bin/env node
/**
 * Per-FILE React Compiler audit — the gate `check:react-compiler` cannot be.
 *
 * The aggregate healthcheck ("Successfully compiled N out of N") silently
 * DROPS files whose transform throws: they vanish from the denominator, so
 * 694/694 can be true while whole screens render unmemoized. This script runs
 * babel-plugin-react-compiler per file at the app's runtime panic threshold
 * ('none', matching app.json experiments.reactCompiler) with the plugin's
 * logger attached, and reports every component/hook the compiler SKIPPED and
 * why. A file with zero compiled functions and zero skips has nothing the
 * compiler recognizes — treat manual memos there as load-bearing.
 *
 * Usage:
 *   node scripts/react-compiler-file-audit.mjs <file.tsx> [...more]  # audit files, exit 1 if any skip
 *   node scripts/react-compiler-file-audit.mjs --all                 # sweep app/features/shared/navigation
 *   node scripts/react-compiler-file-audit.mjs --all --quiet         # only files with skips
 *
 * Stage-6 rule (pass-pitfalls §Stage 6): a memo may only be removed from a
 * file whose components this audit shows COMPILED. `0 of 0` or a skip = the
 * gate is blind there = keep the memo.
 */

import { transformFileAsync } from '@babel/core';
import { globSync } from 'glob';
import path from 'node:path';

const args = process.argv.slice(2);
const quiet = args.includes('--quiet');
const sweep = args.includes('--all');
const files = sweep
  ? globSync('{app,features,shared,navigation}/**/*.{ts,tsx}', {
      ignore: ['**/__tests__/**', '**/*.test.*', '**/e2e/**', '**/node_modules/**'],
    })
  : args.filter((a) => !a.startsWith('--'));

if (files.length === 0) {
  console.error('No input files. Pass file paths or --all.');
  process.exit(2);
}

let filesWithSkips = 0;
let totalCompiled = 0;
let totalSkipped = 0;

for (const file of files) {
  const events = [];
  const logger = {
    logEvent(_filename, event) {
      events.push(event);
    },
  };
  let threw = null;
  try {
    await transformFileAsync(path.resolve(file), {
      configFile: false,
      babelrc: false,
      presets: [['@babel/preset-typescript', { isTSX: true, allExtensions: true }]],
      plugins: [['babel-plugin-react-compiler', { panicThreshold: 'none', logger }]],
    });
  } catch (e) {
    threw = e;
  }
  const compiled = events.filter((e) => e.kind === 'CompileSuccess');
  const skipped = events.filter((e) => e.kind === 'CompileError' || e.kind === 'CompileSkip');
  totalCompiled += compiled.length;
  totalSkipped += skipped.length;

  const bad = threw || skipped.length > 0;
  if (bad) filesWithSkips += 1;
  if (bad || !quiet) {
    console.log(`${file}: compiled ${compiled.length}, skipped ${skipped.length}`);
    if (threw) console.log(`  TRANSFORM THREW: ${String(threw.message).split('\n')[0]}`);
    for (const s of skipped) {
      const name = s.fnName ?? s.fnLoc?.identifierName ?? '(anonymous)';
      const reason =
        s.detail?.reason ?? s.detail?.options?.reason ?? s.reason ?? s.kind ?? 'unknown';
      const line = s.fnLoc?.start?.line ?? s.detail?.loc?.start?.line ?? '?';
      console.log(`  SKIPPED ${name} (line ${line}): ${reason}`);
    }
  }
}

console.log(
  `\n${files.length} files: ${totalCompiled} functions compiled, ${totalSkipped} skipped, ${filesWithSkips} files with skips.`
);
process.exit(filesWithSkips > 0 ? 1 : 0);
