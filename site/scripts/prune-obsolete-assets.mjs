import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSourceFile, sha256 } from './source-catalog.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const directories = ['press/artwork/generated', 'press/mockups', 'site/public/mockups'];

// This is deliberately not a recursive directory deletion. Ignored exports,
// edited files, source registries, capture libraries and manifests are retained.
export async function pruneObsoleteAssets({ repoRoot = root, apply = false } = {}) {
  const git = args => execFileSync('git', args, { cwd: repoRoot }).toString().split('\0').filter(Boolean);
  const tracked = new Set(git(['ls-files', '-z', '--cached', '--', ...directories]));
  const dirty = new Set([...git(['diff', '--name-only', '-z', '--', ...directories]),
    ...git(['diff', '--cached', '--name-only', '-z', '--', ...directories])]);
  const files = [], skipped = [];
  for (const directory of directories) {
    const manifestFile = `${directory}/manifest.json`;
    if (!tracked.has(manifestFile) || dirty.has(manifestFile)) { skipped.push(`${manifestFile}: untracked or edited`); continue; }
    const manifest = JSON.parse((await readSourceFile(repoRoot, manifestFile)).toString());
    const records = [...Object.entries(manifest.images ?? {}).map(([file, sha256]) => ({ file, sha256 })),
      ...Object.values(manifest.featureGraphic ?? {}),
      ...Object.values(manifest.concepts ?? {}).flatMap(concept => [...(concept.outputs ?? []), ...Object.values(concept.variants ?? {})])];
    const seen = new Set();
    for (const record of records) {
      if (!/^[a-z0-9-]+(?:\/[a-z0-9-]+)*\.(?:png|svg)$/.test(record.file) || !/^[a-f0-9]{64}$/.test(record.sha256)) continue;
      const file = `${directory}/${record.file}`;
      if (seen.has(file)) continue;
      seen.add(file);
      if (!tracked.has(file) || dirty.has(file)) { skipped.push(`${file}: untracked or edited`); continue; }
      try {
        if (sha256(await readSourceFile(repoRoot, file)) !== record.sha256) { skipped.push(`${file}: hash mismatch`); continue; }
        files.push({ file, sha256: record.sha256 });
      } catch (error) { skipped.push(`${file}: ${error.code === 'ENOENT' ? 'already absent' : error.message}`); }
    }
  }
  if (apply) {
    const unchanged = await pruneObsoleteAssets({ repoRoot });
    assert.deepEqual(unchanged.files, files, 'Obsolete output ownership changed; nothing removed.');
    for (const { file, sha256: hash } of files) {
      assert.equal(sha256(await readSourceFile(repoRoot, file)), hash, `Output changed: ${file}`);
      await unlink(join(repoRoot, file));
    }
  }
  return { mode: apply ? 'applied' : 'plan', files, skipped };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert(process.argv.slice(2).every(arg => arg === '--apply') && process.argv.length <= 3, 'Usage: node site/scripts/prune-obsolete-assets.mjs [--apply]');
    console.log(JSON.stringify(await pruneObsoleteAssets({ apply: process.argv.includes('--apply') }), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
