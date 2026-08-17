/**
 * Collapses duplicate @cashu/* installs down to the single copy at the
 * workspace root.
 *
 * Why this exists: coco is declared once, at the workspace root, but bun still
 * materialises a second copy under wallet/node_modules whenever it resolves
 * colada's optional `@cashu/coco-core` peer. Two copies means two class
 * identities, and colada classifies retryable failures with `instanceof`:
 *
 *   err instanceof NetworkError || (err instanceof HttpResponseError && ...)
 *
 * With a duplicate, those checks silently return false — no error, no type
 * failure, just retries that stop happening. The duplicate reappears after any
 * `bun add` / `bun install`, so this runs on postinstall rather than being a
 * one-time cleanup.
 *
 * `cashu-ts` is covered too, defensively. Nothing currently `instanceof`-checks
 * a cashu-ts export (coco-core re-exports the error classes, and those are what
 * colada tests), and cashu-ts's classes carry no `#private` fields, so a second
 * copy would most likely be inert rather than actively wrong. But it is the
 * package that derives blinding factors and secrets, `app/package.json` and
 * `wallet/package.json` both declare it directly, and coco-core has it as a hard
 * dependency — so the single-realm invariant currently rests entirely on the
 * root `overrides` pin. `metro.config.js` pins the three coco packages into
 * `extraNodeModules` but not this one. Cheap belt to go with that brace.
 */
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const rootScope = path.join(repoRoot, 'node_modules', '@cashu');

// Workspaces that may end up with their own copy.
const WORKSPACES = ['app', 'wallet', 'nostr', 'docs'];
const PACKAGES = ['coco-core', 'coco-react', 'coco-expo-sqlite', 'cashu-ts'];

let removed = 0;

for (const workspace of WORKSPACES) {
  for (const pkg of PACKAGES) {
    const duplicate = path.join(repoRoot, workspace, 'node_modules', '@cashu', pkg);
    if (!fs.existsSync(duplicate)) continue;

    // Only remove it when the canonical root copy is present to resolve up to.
    if (!fs.existsSync(path.join(rootScope, pkg))) {
      console.warn(`[dedupe-coco] ${workspace}/${pkg}: no root copy, leaving in place`);
      continue;
    }

    fs.rmSync(duplicate, { recursive: true, force: true });
    console.log(`[dedupe-coco] removed duplicate ${workspace}/node_modules/@cashu/${pkg}`);
    removed++;
  }
}

if (removed === 0) {
  console.log('[dedupe-coco] no duplicates found');
}
