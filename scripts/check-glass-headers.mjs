#!/usr/bin/env node
/**
 * Guard: every screen that puts an app-owned glass header button
 * (ScreenHeaderAction / HeaderProfileButton / HeaderGlassCircle / HeaderIconButton)
 * into a `headerLeft`/`headerRight` option MUST route those options through
 * `withGlassHeaderItems` (directly, or via `buildExpoRouterHeaderOptions` /
 * `createFlowLayoutScreenOptions`, which both call it).
 *
 * Why: on iOS 26 a raw `headerLeft`/`headerRight` gets the system Liquid-Glass
 * capsule stacked on top of the app's own glass (doubled chrome) AND the capsule
 * swallows taps. `withGlassHeaderItems` mirrors the option into the SDK 56
 * header-items API with `hidesSharedBackground: true`, which fixes both. This
 * check stops a future screen from silently re-introducing that regression.
 *
 * Heuristic (deliberately conservative): a file is flagged when it BOTH sets a
 * `headerLeft:`/`headerRight:` option AND renders one of the glass header
 * components, but does NOT reference the wrapping helpers. Files that don't use
 * the standard glass components, or only set `() => null`, are not flagged.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['app', 'features', 'shared', 'config'];

// Files that legitimately set a header option without wrapping (verified by audit).
const ALLOWLIST = new Set([
  // The helper itself + its builders.
  'navigation/headerItems.tsx',
]);

const GLASS_COMPONENTS =
  /\b(ScreenHeaderAction|HeaderProfileButton|HeaderGlassCircle|HeaderIconButton)\b/;
const HEADER_OPTION = /header(Left|Right)\s*:/;
const WRAPPED =
  /\b(withGlassHeaderItems|buildExpoRouterHeaderOptions|createFlowLayoutScreenOptions)\b/;

/** @param {string} dir @param {string[]} out */
function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '__tests__') continue;
      walk(full, out);
    } else if (name.endsWith('.tsx')) {
      out.push(full);
    }
  }
}

const files = [];
for (const root of ROOTS) walk(root, files);

const violations = [];
for (const file of files) {
  const rel = file.replace(/\\/g, '/');
  if (ALLOWLIST.has(rel)) continue;
  const src = readFileSync(file, 'utf8');
  if (!HEADER_OPTION.test(src)) continue;
  if (!GLASS_COMPONENTS.test(src)) continue;
  if (WRAPPED.test(src)) continue;
  violations.push(rel);
}

if (violations.length > 0) {
  console.error(
    '✖ Glass header guard: these files set a glass headerLeft/headerRight without\n' +
      '  routing options through withGlassHeaderItems (iOS 26 doubled-glass + tap loss):\n'
  );
  for (const v of violations) console.error(`    ${v}`);
  console.error(
    '\n  Wrap the screen options in withGlassHeaderItems(...) (see navigation/headerItems.tsx).\n' +
      '  Genuine exceptions go in the ALLOWLIST in scripts/check-glass-headers.mjs.'
  );
  process.exit(1);
}

console.log(`✓ Glass header guard: ${files.length} files scanned, all glass headers wrapped.`);
