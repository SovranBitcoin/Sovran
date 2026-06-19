// Dev-only: symlink sibling Sovran packages into node_modules when they are
// checked out next to this repo, so local edits are picked up by both Metro
// (runtime bundle) and tsc (types) without committing a `file:` dependency.
//
// Committing `file:` would force EAS/CI to resolve the sibling too — but on
// those machines the sibling source isn't checked out, so the build would
// break. This script instead keeps the committed dependency on the registry
// version and only overrides it locally: when the sibling directory is absent
// (EAS/CI), it no-ops and the registry package installed from package.json is
// used as-is. The committed lockfile and `package.json` always describe the
// production resolution; the symlink is a purely local, post-install overlay.
//
// Runs from the `postinstall` chain, so every `bun install` re-establishes the
// link (a fresh install would otherwise replace it with the registry copy).

import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// package name → sibling directory, relative to the app root. Add a row when a
// registry-versioned sibling should resolve to local source during dev.
const SIBLINGS = [
  { pkg: '@sovranbitcoin/colada', dir: '../colada' },
  { pkg: '@sovranbitcoin/nagg-ts', dir: '../nagg-ts' },
];

function pathExists(target) {
  try {
    lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

for (const { pkg, dir } of SIBLINGS) {
  const target = resolve(appRoot, dir);
  if (!existsSync(target)) {
    // EAS/CI (or a contributor without the sibling checkout): leave the
    // registry install in place.
    continue;
  }

  const linkPath = join(appRoot, 'node_modules', pkg);
  try {
    if (pathExists(linkPath)) rmSync(linkPath, { recursive: true, force: true });
    mkdirSync(dirname(linkPath), { recursive: true });
    symlinkSync(target, linkPath);
    console.log(`[link-local-siblings] linked ${pkg} -> ${target}`);
  } catch (err) {
    console.warn(`[link-local-siblings] could not link ${pkg}: ${err.message}`);
  }
}
