import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { publishVersionArtwork } from '../site.mjs';
import { sha256 } from '../core.mjs';

const root = new URL('../../', import.meta.url);
test('website artwork comes from the released SHA and resumes a pending deployment without recommitting', async () => {
  const manifest = JSON.parse(readFileSync(new URL('app/assets/brand/generated/manifest.json', root)));
  const sha = 'a'.repeat(40);
  const state = { version: manifest.productVersion, sourceSha: sha, steps: {} };
  const blobs = new Map(); let commits = 0, saved = 0;
  const ledger = { state, save: async () => { saved++; }, gh: { file: async (file, ref) => {
    assert.equal(ref, sha); return { bytes: readFileSync(new URL(file, root)) };
  } } };
  const site = { api: async (route, options) => {
    if (route === 'git/ref/heads/main') return { object: { sha: 'head' } };
    if (route === 'git/commits/head') return { tree: { sha: 'tree' } };
    if (route === 'git/trees/tree?recursive=1') return { tree: [] };
    if (route === 'git/blobs') { const bytes = Buffer.from(options.body.content, 'base64'); const digest = sha256(bytes); blobs.set(digest, bytes); return { sha: digest }; }
    if (route === 'git/trees') return { sha: 'new-tree' };
    if (route === 'git/commits') { commits++; return { sha: 'new-commit' }; }
    if (route === 'git/refs/heads/main') return {};
    throw new Error('Unexpected website operation');
  } };
  let deployed = false;
  const handle = mock.method(globalThis, 'fetch', async (url) => {
    if (!deployed) return new Response(null, { status: 404 });
    const file = state.artworkInventory.find((f) => url.endsWith('/' + f.path));
    assert.ok(file); return new Response(blobs.get(file.sha256));
  });
  try {
    assert.equal(await publishVersionArtwork(ledger, site), false);
    assert.equal(state.artworkInventory.length, 37);
    deployed = true;
    ledger.gh.file = async () => { throw new Error('Retry must use its durable inventory'); };
    assert.equal(await publishVersionArtwork(ledger, site), true);
    assert.equal(commits, 1);
    assert.ok(saved >= 3);
  } finally { handle.mock.restore(); }
});
test('artwork from a different version cannot be published', async () => {
  const ledger = { state: { version: '1.0.0', steps: {} }, gh: { file: async () => ({ bytes: Buffer.from(JSON.stringify({ schema: 1, productVersion: '0.1.1' })) }) } };
  await assert.rejects(publishVersionArtwork(ledger, {}), /does not match/);
});
