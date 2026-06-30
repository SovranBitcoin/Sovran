#!/usr/bin/env node
/**
 * React Compiler coverage gate (stdin parser).
 *
 * The whole React-Compiler memoization strategy (app.json
 * `experiments.reactCompiler`) rests on ONE premise: the compiler actually
 * compiles every component. When a component "bails out" (a ref read in
 * render, a rules-of-hooks violation, an unsupported pattern), the compiler
 * SILENTLY skips it — it renders unmemoized, and any manual memo that was
 * removed as "redundant" is now genuinely missing. There is no runtime error;
 * the only symptom is jank.
 *
 * The `eslint-plugin-react-compiler` rule that would normally surface this is
 * dead in this repo — it throws at config load under the repo-wide `zod@4`
 * override (see eslint.config.js) and falls back to a no-op. So nothing in the
 * lint run catches a new bailout. This gate restores that signal: the npm
 * script pipes `react-compiler-healthcheck` output into this parser, which
 * FAILS when compiled < total. See docs/adr/0007-react-compiler-coverage-gate.md.
 */

let input = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) input += chunk;

process.stdout.write(input);

const m = input.match(/Successfully compiled\s+(\d+)\s+out of\s+(\d+)\s+components/);
if (!m) {
  console.error('\n✗ Could not parse react-compiler-healthcheck output — refusing to pass blind.');
  process.exit(2);
}

const compiled = Number(m[1]);
const total = Number(m[2]);
if (total === 0) {
  console.error('\n✗ Healthcheck found 0 components — wrong --src glob?');
  process.exit(2);
}
if (compiled < total) {
  console.error(
    `\n✗ React Compiler bailout: ${total - compiled} of ${total} components did NOT compile.\n` +
      '  Those components render unmemoized — a removed manual memo is now missing.\n' +
      '  Find them with: bunx react-compiler-healthcheck --verbose, then either fix the\n' +
      '  bailout (ref-in-render, rules-of-hooks) or restore the manual memo.'
  );
  process.exit(1);
}

console.error(`\n✓ React Compiler covers all ${total} components (zero bailouts).`);
