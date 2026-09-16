import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pruneObsoleteAssets } from '../scripts/prune-obsolete-assets.mjs';

const site = fileURLToPath(new URL('../', import.meta.url));
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
test('legacy browser export has no automatic batch and uses an isolated internal build', async () => {
  const source = await readFile(new URL('../scripts/visual.mjs', import.meta.url), 'utf8');
  assert(!source.includes('planVariants'));
  assert(source.includes('const exportJobs = jobs;'));
  assert(source.includes('build:internal'));
  assert(source.includes("'.astro/internal-dist'"));
  assert(source.includes("capture.freshness === 'current'"));
  assert(source.includes('Scene inputs changed during export; rebuild and retry'));
  assert(source.includes('Refusing to overwrite an unrecognized or edited output'));
});

test('legacy CLI requires explicit screenshot selection and rejects removed batch arguments without writing', async () => {
  const output = join(tmpdir(), `sovran-rejected-export-${randomUUID()}`);
  for (const [args, error] of [
    [['--export', output], /Explicit --screenshots required/],
    [['--export', output, '--variants'], /Unknown argument/],
    [['--export', output, '--og-only'], /Unknown argument/],
    [['--format', 'wide'], /requires an export/],
    [['--export', output, '--screenshots', 'ios/wallet', '--poses', 'null'], /must be a JSON array/],
  ]) {
    const result = spawnSync(process.execPath, ['scripts/visual.mjs', ...args], { cwd: site, encoding: 'utf8' });
    assert.notEqual(result.status, 0); assert.match(result.stderr, error);
    await assert.rejects(stat(output), { code: 'ENOENT' });
  }
});
