// Dev-only: symlink sibling Sovran packages into node_modules when they are
// checked out next to this repo, so local edits are picked up by both tsc
// (types) and vitest/bun (runtime) without committing a `file:` dependency.
//
// `@sovranbitcoin/schemas` is the shared cross-repo contract this library
// validates against. It stays a peerDependency (the consumer — sovran-app —
// owns the single installed copy) so production resolution is the registry
// version. This script only overrides it LOCALLY: when ../sovran-schemas is
// checked out next to nagg-ts, link to its source so unpublished contract
// changes are picked up immediately. When the sibling is absent (CI/publish),
// it no-ops and the peer/registry copy is used as-is.
//
// Runs from the `postinstall` chain, so every `bun install` re-establishes the
// link (a fresh install would otherwise drop it).

import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// package name → sibling directory, relative to the repo root.
const SIBLINGS = [{ pkg: '@sovranbitcoin/schemas', dir: '../sovran-schemas' }];

function pathExists(target) {
  try {
    lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

for (const { pkg, dir } of SIBLINGS) {
  const target = resolve(repoRoot, dir);
  if (!existsSync(target)) {
    // CI / publish (or a contributor without the sibling checkout): leave the
    // peer/registry resolution in place.
    continue;
  }

  const linkPath = join(repoRoot, 'node_modules', pkg);
  try {
    if (pathExists(linkPath)) rmSync(linkPath, { recursive: true, force: true });
    mkdirSync(dirname(linkPath), { recursive: true });
    symlinkSync(target, linkPath);
    console.log(`[link-local-siblings] linked ${pkg} -> ${target}`);
  } catch (err) {
    console.warn(`[link-local-siblings] could not link ${pkg}: ${err.message}`);
  }
}
