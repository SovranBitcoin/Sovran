#!/usr/bin/env node
/**
 * React Compiler coverage gate.
 *
 * The whole React-Compiler memoization strategy (app.json
 * `experiments.reactCompiler`) rests on ONE premise: the compiler actually
 * compiles every component. When a function "bails out" (a ref written in
 * render, a rules-of-hooks violation, an unsupported pattern such as
 * try/finally), the compiler SILENTLY skips it — it renders unmemoized, and any
 * manual memo that was removed as "redundant" is now genuinely missing. There
 * is no runtime error; the only symptom is jank, or a stale identity re-firing
 * an effect.
 *
 * The `eslint-plugin-react-compiler` rule that would normally surface this is
 * dead in this repo — it throws at config load under the repo-wide `zod@4`
 * override (see eslint.config.js) and falls back to a no-op. So nothing in the
 * lint run catches a new bailout. This gate restores that signal.
 *
 * WHY NOT `react-compiler-healthcheck`: it reports `compiled out of total`
 * where `total = successes + failures`, and it runs the compiler inside a
 * swallowed try/catch at `panicThreshold: 'critical_errors'`. A file whose
 * functions all fail contributes NOTHING to either side of that ratio, so
 * `compiled < total` can never trip:
 *
 *     $ bunx react-compiler-healthcheck --src 'features/map/screens/MapScreen.tsx'
 *     Successfully compiled 0 out of 0 components.      # MapScreen BAILS
 *     $ bunx react-compiler-healthcheck --src 'features/wallet/screens/WalletScreen.tsx'
 *     Successfully compiled 1 out of 1 components.      # clean files DO count
 *
 * The old stdin-parsing gate therefore reported "zero bailouts" while 95 files
 * were bailing. It is replaced here by a direct plugin run with the PRODUCTION
 * options (`panicThreshold: 'none'`, `compilationMode: 'infer'`) and a
 * `logEvent` collector that counts anything other than CompileSuccess.
 *
 * Bailouts are ratcheted, not banned: `react-compiler-bailouts.json` holds the
 * known-bailing files. A NEW bailout fails the gate; a file that starts
 * compiling must be removed from the list (run with `--update`), so the list
 * can only shrink.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { Glob } from 'bun';
import * as babel from '@babel/core';

const APP_DIR = resolve(import.meta.dirname, '..');
const BASELINE_PATH = resolve(APP_DIR, 'react-compiler-bailouts.json');
const SRC_GLOB = '{app,features,shared,components}/**/*.{ts,tsx,js,jsx}';

const shouldUpdate = process.argv.includes('--update');

/** Production compiler options — must mirror babel-preset-expo's wiring. */
const COMPILER_OPTIONS = {
  compilationMode: 'infer',
  panicThreshold: 'none',
  target: '19',
};

function sweep() {
  const files = [...new Glob(SRC_GLOB).scanSync({ cwd: APP_DIR, absolute: true })]
    .filter((file) => !file.includes('/__tests__/') && !file.includes('/__mocks__/'))
    .sort();

  const bailouts = new Map();
  let compiledFns = 0;
  let bailedFns = 0;

  for (const file of files) {
    const reasons = [];
    const logEvent = (_filename, event) => {
      if (event.kind === 'CompileSuccess') {
        compiledFns += 1;
        return;
      }
      if (event.kind === 'CompileError' || event.kind === 'CompileSkip') {
        bailedFns += 1;
        const detail = event.detail ?? event.error ?? {};
        const reason =
          detail.reason ??
          detail.message ??
          detail.description ??
          (Array.isArray(detail.details) ? detail.details[0]?.description : undefined) ??
          event.kind;
        reasons.push(String(reason).split('\n')[0].slice(0, 160));
      }
    };

    try {
      babel.transformSync(readFileSync(file, 'utf8'), {
        filename: file,
        presets: [['@babel/preset-typescript', { isTSX: true, allExtensions: true }]],
        plugins: [['babel-plugin-react-compiler', { ...COMPILER_OPTIONS, logger: { logEvent } }]],
        configFile: false,
        babelrc: false,
      });
    } catch (error) {
      // A parse/transform throw is itself a total bailout for the file.
      bailedFns += 1;
      reasons.push(`transform threw: ${String(error.message).split('\n')[0].slice(0, 160)}`);
    }

    if (reasons.length > 0) bailouts.set(relative(APP_DIR, file), [...new Set(reasons)]);
  }

  return { files, bailouts, compiledFns, bailedFns };
}

const { files, bailouts, compiledFns, bailedFns } = sweep();

if (files.length === 0) {
  console.error('✗ Swept 0 files — wrong glob?');
  process.exit(2);
}

if (shouldUpdate) {
  writeFileSync(
    BASELINE_PATH,
    `${JSON.stringify(
      {
        $comment:
          'Files containing at least one function the React Compiler cannot compile. Ratcheted by scripts/check-react-compiler.mjs — this list may only shrink. Regenerate with `bun run check:react-compiler:update`.',
        bailouts: Object.fromEntries([...bailouts].sort(([a], [b]) => a.localeCompare(b))),
      },
      null,
      2
    )}\n`
  );
  console.error(
    `✓ Banked ${bailouts.size} bailing files (${compiledFns} functions compiled, ${bailedFns} bailed).`
  );
  process.exit(0);
}

if (!existsSync(BASELINE_PATH)) {
  console.error(`✗ Missing ${relative(APP_DIR, BASELINE_PATH)} — run with --update to create it.`);
  process.exit(2);
}

const baseline = new Set(Object.keys(JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).bailouts));
const added = [...bailouts.keys()].filter((file) => !baseline.has(file)).sort();
const fixed = [...baseline].filter((file) => !bailouts.has(file)).sort();

console.error(
  `React Compiler: ${compiledFns} functions compiled, ${bailedFns} bailed across ${bailouts.size} of ${files.length} files.`
);

if (added.length > 0) {
  console.error(`\n✗ ${added.length} NEW React Compiler bailout(s):\n`);
  for (const file of added) {
    console.error(`    ${file}`);
    for (const reason of bailouts.get(file)) console.error(`      ${reason}`);
  }
  console.error(
    '\n  These functions render UNMEMOIZED. Either fix the bailout (ref-in-render,\n' +
      '  rules-of-hooks, try/finally) or keep the manual memo — and if a memo is\n' +
      '  load-bearing, annotate it `ast-grep-ignore: no-manual-memo-tsx` with the\n' +
      '  identity contract it upholds.'
  );
  process.exit(1);
}

if (fixed.length > 0) {
  console.error(`\n✗ ${fixed.length} file(s) now compile and must leave the baseline:\n`);
  for (const file of fixed) console.error(`    ${file}`);
  console.error('\n  Ratchet down with: bun run check:react-compiler:update');
  process.exit(1);
}

console.error(`\n✓ No new bailouts (${bailouts.size} known, ratcheted).`);
