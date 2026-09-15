import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const workflows = path.join(import.meta.dirname, '..', '..', '.github', 'workflows');
const root = path.join(workflows, '..', '..');

// The bitchat iOS/Android native sources are git submodules under
// app/modules/bitchat-module. EAS archives the checked-out tree, so every
// checkout of the release source must initialize submodules or the native
// builds compile against empty vendor directories.
test('release source checkouts initialize submodules', () => {
  for (const file of ['release.yml', 'release-stage.yml']) {
    const text = readFileSync(path.join(workflows, file), 'utf8');
    const blocks = text.split(/\n\s+- (?:if: [^\n]+\n\s+)?uses: actions\/checkout@/).slice(1);
    const sources = blocks.filter((block) => /^\s+path: source$/m.test(block));
    assert.ok(sources.length >= 1, `${file} checks out the release source`);
    for (const block of sources) assert.match(block, /^\s+submodules: true$/m, `${file} source checkout sets submodules: true`);
  }
});

test('site consolidation does not retarget publishers or broaden release triggers', () => {
  const workflow = readFileSync(path.join(workflows, 'release.yml'), 'utf8');
  assert.match(workflow, /paths: \[app\/app\.json\]/);
  const config = JSON.parse(readFileSync(path.join(root, 'release/config.json'), 'utf8'));
  assert.equal(config.websiteRepository, 'SovranBitcoin/sovran.money');
  assert.equal(config.bucketRewrite, undefined);
  const stages = readFileSync(path.join(workflows, 'release-stage.yml'), 'utf8');
  assert.match(stages, /repositories: sovran\.money/);
});

test('both native archive roots exclude website and press without excluding shared legal or brand sources', () => {
  for (const file of ['.easignore', 'app/.easignore']) {
    const lines = readFileSync(path.join(root, file), 'utf8').split('\n').filter((line) => line && !line.startsWith('#'));
    for (const excluded of ['site/', 'press/']) assert.ok(lines.includes(excluded), `${file}: ${excluded}`);
    assert.ok(!lines.some((line) => /(?:^|\/)(copy|brand)\//.test(line)), `${file}: shared/native inputs must remain`);
  }
  const rootPackage = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(rootPackage.workspaces.includes('copy'));
  assert.ok(!rootPackage.workspaces.includes('site'));
  const app = JSON.parse(readFileSync(path.join(root, 'app/package.json'), 'utf8'));
  assert.equal(app.dependencies.copy, 'workspace:*');
  assert.match(app.scripts['eas-build-post-install'], /brand-assets/);
});
