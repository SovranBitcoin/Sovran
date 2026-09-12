import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const workflows = path.join(import.meta.dirname, '..', '..', '.github', 'workflows');

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
