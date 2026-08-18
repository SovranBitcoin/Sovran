#!/usr/bin/env node
/**
 * Guard: the styling debt this repo carries may shrink, never grow.
 *
 * The app is meant to be styled with Tailwind classes through Uniwind, but four
 * other styling languages are still in the tree: `StyleSheet.create`, inline
 * `style={{…}}` objects, the layout props on `VStack`/`HStack`, and
 * `contentContainerStyle` on scroll containers (which Uniwind gives a
 * `contentContainerClassName` counterpart for).
 *
 * Rather than ban them outright — that would fail on day one across hundreds of
 * files — this records the current per-file count of each and fails when a count
 * goes UP, or when a file that had none acquires some. Same shape and same idea
 * as `eslint-suppressions.json`: every entry is debt, and the only allowed
 * direction is down.
 *
 *   node scripts/check-styling.mjs            # check (exits 1 on regression)
 *   node scripts/check-styling.mjs --update   # re-record after reducing debt
 *
 * Counting is textual and deliberately crude. It does not need to be exact — it
 * needs to be *stable*, so that the same file yields the same number until
 * someone actually changes how it is styled.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['app', 'features', 'shared', 'navigation', 'config'];
const BUDGET_FILE = 'styling-budget.json';

/** Layout props on the stack primitives that have exact Tailwind equivalents. */
const STACK_LAYOUT_PROP =
  /<(?:VStack|HStack)\b[^>]*?\s(?:gap|align|justify|flex|wrap|flexGrow|flexShrink|flexBasis)=/gs;

const PATTERNS = {
  /** `StyleSheet.create({…})` — should be `className`. */
  'stylesheet-create': /\bStyleSheet\.create\(/g,
  /** Inline `style={{…}}` object literals — should be `className`. */
  'inline-style': /style=\{\{/g,
  /** `<VStack gap={…}>` etc — should be `className="gap-…"`. */
  'stack-layout-props': STACK_LAYOUT_PROP,
  /** Uniwind types a `contentContainerClassName` counterpart for these. */
  'content-container-style': /contentContainerStyle=/g,
};

/** @param {string} dir @param {string[]} out */
function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === '__tests__' || name === '__mocks__') continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else if (name.endsWith('.tsx') || name.endsWith('.ts')) out.push(full);
  }
}

function measure() {
  const files = [];
  for (const root of ROOTS) walk(root, files);

  /** @type {Record<string, Record<string, number>>} */
  const counts = {};
  for (const file of files.sort()) {
    const src = readFileSync(file, 'utf8');
    /** @type {Record<string, number>} */
    const entry = {};
    for (const [name, pattern] of Object.entries(PATTERNS)) {
      const n = (src.match(pattern) ?? []).length;
      if (n > 0) entry[name] = n;
    }
    if (Object.keys(entry).length > 0) counts[file.replace(/\\/g, '/')] = entry;
  }
  return { counts, scanned: files.length };
}

const { counts, scanned } = measure();

if (process.argv.includes('--update')) {
  writeFileSync(BUDGET_FILE, `${JSON.stringify(counts, null, 2)}\n`);
  const total = Object.values(counts).reduce(
    (sum, e) => sum + Object.values(e).reduce((a, b) => a + b, 0),
    0
  );
  console.log(`✓ Styling budget recorded: ${Object.keys(counts).length} files, ${total} sites.`);
  process.exit(0);
}

/** @type {Record<string, Record<string, number>>} */
let budget;
try {
  budget = JSON.parse(readFileSync(BUDGET_FILE, 'utf8'));
} catch {
  console.error(
    `✖ Styling guard: ${BUDGET_FILE} is missing or unreadable.\n` +
      '  Run `node scripts/check-styling.mjs --update` to record the current state.'
  );
  process.exit(1);
}

const regressions = [];
const improvements = [];

for (const [file, entry] of Object.entries(counts)) {
  for (const [name, n] of Object.entries(entry)) {
    const allowed = budget[file]?.[name] ?? 0;
    if (n > allowed) regressions.push(`${file}  ${name}: ${allowed} → ${n}`);
  }
}
for (const [file, entry] of Object.entries(budget)) {
  for (const [name, allowed] of Object.entries(entry)) {
    const n = counts[file]?.[name] ?? 0;
    if (n < allowed) improvements.push(`${file}  ${name}: ${allowed} → ${n}`);
  }
}

if (regressions.length > 0) {
  console.error('✖ Styling guard: new styling debt.\n');
  for (const r of regressions) console.error(`    ${r}`);
  console.error(
    '\n  Style with Tailwind classes instead — `className`, and the' +
      '\n  `contentContainerClassName` / `*ClassName` props Uniwind adds.' +
      '\n  See skills/sovran-ui. If a site genuinely cannot take a class' +
      '\n  (Reanimated worklets, Skia, native module props), record it with' +
      '\n  `node scripts/check-styling.mjs --update` and say why in the commit.'
  );
  process.exit(1);
}

const total = Object.values(counts).reduce(
  (sum, e) => sum + Object.values(e).reduce((a, b) => a + b, 0),
  0
);

if (improvements.length > 0) {
  console.log(`✓ Styling guard: no new debt, and ${improvements.length} count(s) went down:\n`);
  for (const i of improvements.slice(0, 20)) console.log(`    ${i}`);
  if (improvements.length > 20) console.log(`    … and ${improvements.length - 20} more`);
  console.log('\n  Run `node scripts/check-styling.mjs --update` to bank the reduction.');
  process.exit(0);
}

console.log(`✓ Styling guard: ${scanned} files scanned, ${total} sites, none new.`);
