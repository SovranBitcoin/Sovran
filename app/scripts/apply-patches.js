const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..');
const patchesDir = path.join(appRoot, 'patches');

// Under the bun workspace, dependencies hoist to the workspace root, so resolve
// patch-package's node_modules by walking up from app/ rather than assuming app/.
function nmRootFor(pkg) {
  let dir = appRoot;
  for (let i = 0; i < 6; i += 1) {
    if (fs.existsSync(path.join(dir, 'node_modules', pkg))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return appRoot;
}

const patchPackageRoot = nmRootFor('patch-package');
const patchPackageEntry = path.join(patchPackageRoot, 'node_modules', 'patch-package', 'index.js');
// patch-package requires --patch-dir to be relative to its cwd (patchPackageRoot).
const patchDirRel = path.relative(patchPackageRoot, patchesDir) || 'patches';

const result = fs.existsSync(patchPackageEntry)
  ? spawnSync(
      process.execPath,
      // NOTE: no --preserve-symlinks here. Under bun's isolated node_modules
      // (symlinks into a central .bun store), preserving symlinks stops node
      // from resolving patch-package's own deps (chalk) which live beside the
      // realpath in the store. Following symlinks is required.
      [patchPackageEntry, '--patch-dir', patchDirRel, '--error-on-fail'],
      {
        cwd: patchPackageRoot,
        env: process.env,
        stdio: 'inherit',
      }
    )
  : spawnSync('patch-package', ['--patch-dir', patchDirRel, '--error-on-fail'], {
      cwd: patchPackageRoot,
      env: process.env,
      stdio: 'inherit',
    });

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
