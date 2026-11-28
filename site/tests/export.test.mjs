import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { pruneObsoleteAssets } from '../scripts/prune-obsolete-assets.mjs';

test('obsolete cleanup plans only manifest-owned tracked derived outputs, never capture sources or arbitrary exports', async () => {
  const plan = await pruneObsoleteAssets();
  assert.equal(plan.mode, 'plan');
  for (const { file, sha256 } of plan.files) {
    assert.match(file, /^(press\/artwork\/generated|press\/mockups|site\/public\/mockups)\//);
    assert(!file.includes('/source/') && !file.endsWith('manifest.json'));
    assert.match(sha256, /^[a-f0-9]{64}$/);
    assert((await stat(new URL(`../${file}`, new URL('../', import.meta.url)))).isFile());
  }
});
