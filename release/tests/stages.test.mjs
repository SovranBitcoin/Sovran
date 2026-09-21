import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { config, sha256 } from '../core.mjs';
import { freedomRelease, updateSource, formatSource } from '../freedom.mjs';
import { hostApple } from '../hosting.mjs';
import { zapstoreRelease } from '../publish.mjs';
import { websiteRelease } from '../site.mjs';

const hosted = Buffer.from('package');
const state = () => ({
  version: '0.1.1', sourceSha: 'a'.repeat(40), createdAt: '2026-09-10T00:00:00Z', adpId: 'adp',
  builds: { ios: { number: '170' }, android: { number: '30' } }, steps: { assetsHosted: true }, channels: {},
  adp: { url: 'https://sovran.money/ios/releases/new/', size: 20, minOSVersion: '16.4' },
  screenshots: ['https://sovran.money/ios/media/example.png'],
  inventory: [{ path: 'ios/releases/new/manifest.json', size: hosted.length, sha256: sha256(hosted) }],
});
const source = () => ({ apps: [{ bundleIdentifier: config.bundleId, marketplaceID: config.appleAppId, versions: [{ version: '0.1.0', buildVersion: '169', downloadURL: 'https://sovran.money/ios/releases/old/' }] }] });
const ledgerFor = (value) => { const ledger = { state: value, saved: 0, save: async () => { ledger.saved++; } }; return ledger; };
const unused = () => { throw new Error('A skipped stage must not build its clients'); };
const network = () => mock.method(globalThis, 'fetch', async (url) => new Response(String(url).startsWith(config.freedomSource) ? JSON.stringify(source()) : hosted));
async function withFork(run) {
  const previous = process.env.FREEDOM_FORK; process.env.FREEDOM_FORK = 'sovran-bot/freedomstore';
  const handle = network();
  try { await run(); } finally { handle.mock.restore(); if (previous === undefined) delete process.env.FREEDOM_FORK; else process.env.FREEDOM_FORK = previous; }
}

test('skipped stages return before building any client', async () => {
  const pending = state(); pending.steps.assetsHosted = false;
  await freedomRelease(ledgerFor(pending), { github: unused });
  const done = state(); done.channels.freedomStore = { version: done.version };
  await freedomRelease(ledgerFor(done), { github: unused });
  await hostApple(ledgerFor({ ...state(), adpId: undefined }), { apple: unused, site: unused });
  await zapstoreRelease(ledgerFor(state()), { pool: unused });
});

test('Freedom resumes its own open PR without opening another', async () => {
  const current = state(), ledger = ledgerFor(current), writes = [], repositories = [];
  const bytes = Buffer.from(await formatSource(updateSource(source(), current)));
  const clients = {
    [config.freedomRepository]: {
      pages: async (route) => { assert.match(route, /^pulls\?state=all&head=sovran-bot%3Asovran-release-0\.1\.1-170$/); return [{ number: 7, state: 'open', merged_at: null }]; },
      api: async (route, options) => { if (options?.method) writes.push(route); assert.equal(route, 'git/ref/heads/main'); return { object: { sha: 'head' } }; },
      file: async (file, ref) => { assert.deepEqual([file, ref], ['altstore-source.json', 'head']); return { bytes: Buffer.from(JSON.stringify(source())) }; },
    },
    'sovran-bot/freedomstore': {
      optional: async () => ({ object: { sha: 'head' } }),
      api: async (route) => { writes.push(route); return {}; },
      file: async () => ({ bytes }),
    },
  };
  await withFork(() => freedomRelease(ledger, { github: (repository) => { repositories.push(repository); return clients[repository]; } }));
  assert.deepEqual(repositories, [config.freedomRepository, 'sovran-bot/freedomstore']);
  assert.deepEqual(writes, []);
  assert.equal(current.freedomPr, 7);
  assert.equal(ledger.saved, 1);
});

test('Freedom never opens a PR beside a closed or competing Sovran PR', async () => {
  for (const [pulls, open, message] of [
    [[{ number: 7, state: 'closed', merged_at: null }], [], /closed without merge/],
    [[{ number: 7 }, { number: 8 }], [], /Duplicate Freedom PRs/],
    [[], [{ number: 9, title: 'Update Sovran to 0.1.1' }], /Another Sovran Freedom PR is open/],
  ]) {
    const client = {
      pages: async (route) => (route.startsWith('pulls?state=all') ? pulls : open),
      api: async () => { throw new Error('Must not write to Freedom'); },
      optional: async () => { throw new Error('Must not write to Freedom'); },
    };
    const ledger = ledgerFor(state());
    await withFork(() => assert.rejects(freedomRelease(ledger, { github: () => client }), message));
    assert.equal(ledger.saved, 0);
  }
});

test('website stage takes its client and leaves unconfirmed releases untouched', async () => {
  const ledger = ledgerFor(state()); let built = 0;
  await websiteRelease(ledger, { site: () => { built++; return { file: unused, api: unused }; } });
  assert.equal(built, 1);
  assert.equal(ledger.saved, 0);
});

test('website stage publishes confirmed channels through the given client and waits for the deploy', async () => {
  const current = state(); current.steps.artworkHosted = true; current.artworkInventory = current.inventory;
  current.channels.githubApk = { version: current.version, build: '30' };
  const ledger = ledgerFor(current); let committed;
  const previous = { schemaVersion: 1, channels: { appStore: { version: '0.1.0', build: '169' } } };
  const site = {
    file: async (file) => { assert.equal(file, 'public/releases/channels.json'); return { sha: 'old', bytes: Buffer.from(JSON.stringify(previous)) }; },
    api: async (route, options) => {
      if (route === 'git/ref/heads/main') return { object: { sha: 'head' } };
      if (route === 'git/commits/head') return { tree: { sha: 'tree' } };
      if (route === 'git/trees/tree?recursive=1') return { tree: [{ path: 'public/releases/channels.json', sha: 'old' }] };
      if (route === 'git/blobs') { committed = JSON.parse(Buffer.from(options.body.content, 'base64')); return { sha: 'blob' }; }
      return { sha: 'next' };
    },
  };
  const handle = network();
  try { await websiteRelease(ledger, { site: () => site }); } finally { handle.mock.restore(); }
  assert.deepEqual(committed.channels, { ...previous.channels, githubApk: current.channels.githubApk });
  assert.equal(current.complete, undefined);
});
