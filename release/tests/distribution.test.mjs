import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { config, sha256 } from '../core.mjs';
import { updateSource, formatSource } from '../freedom.mjs';
import { validateManifest, verifyHosted, commitFiles } from '../hosting.mjs';
import { selectUniversal } from '../android.mjs';
import { crossChannel, certificateContinuity, zapstoreEvidence, signingBlocks } from '../verify.mjs';
import { validateBuild } from '../build.mjs';
import { mergeChannels } from '../site.mjs';

const state = () => ({ version: '0.1.1', sourceSha: 'a'.repeat(40), createdAt: '2026-09-10T00:00:00Z', builds: { ios: { number: '170' }, android: { number: '30' } }, adp: { url: 'https://sovran.money/ios/releases/new/', size: 20, minOSVersion: '16.4' }, screenshots: ['https://sovran.money/ios/media/example.png'] });
const source = () => ({ apps: [{ bundleIdentifier: config.bundleId, marketplaceID: config.appleAppId, versions: [{ version: '0.1.0', buildVersion: '169', downloadURL: 'https://sovran.money/ios/releases/old/' }] }, { bundleIdentifier: 'other.app', versions: [] }] });

test('Freedom updates are append-only and retry idempotent', () => {
  const original = source(); const next = updateSource(original, state());
  assert.equal(original.apps[0].versions.length, 1);
  assert.deepEqual(next.apps[0].versions[1], original.apps[0].versions[0]);
  assert.deepEqual(next.apps[1], original.apps[1]);
  assert.deepEqual(updateSource(next, state()), next);
});
test('Freedom refuses reused ADPs, conflicting builds and downgrades', () => {
  const reused = state(); reused.adp.url = source().apps[0].versions[0].downloadURL;
  assert.throws(() => updateSource(source(), reused), /reused/);
  const next = updateSource(source(), state());
  next.apps[0].versions[0].downloadURL = 'https://sovran.money/other/';
  assert.throws(() => updateSource(next, state()), /another package/);
  const future = source(); future.apps[0].versions[0].version = '0.2.0';
  assert.throws(() => updateSource(future, state()), /newer/);
});
test('ADP checks all identity fields and does not invent a minimum OS', () => {
  const good = { bundleId: config.bundleId, appleItemId: config.appleAppId, shortVersionString: '0.1.1', bundleVersion: '170', minimumSystemVersions: { ios: '16.4' } };
  validateManifest(good, state());
  for (const key of ['bundleId', 'appleItemId', 'shortVersionString', 'bundleVersion']) assert.throws(() => validateManifest({ ...good, [key]: 'wrong' }, state()));
  assert.throws(() => validateManifest({ ...good, minimumSystemVersions: {} }, state()));
});
test('every hosted ADP file is checked; HTML fallbacks and incomplete deploys fail', async () => {
  await assert.rejects(verifyHosted([]), /Empty publication inventory/);
  const bytes = Buffer.from('binary');
  const inventory = ['manifest.json', 'variant/file'].map((path) => ({ path, size: bytes.length, sha256: sha256(bytes) }));
  let calls = 0;
  const handle = mock.method(globalThis, 'fetch', async () => new Response(++calls === 1 ? bytes : 'html!!'));
  try { assert.equal(await verifyHosted(inventory), false); assert.equal(calls, 2); }
  finally { handle.mock.restore(); }
});
test('website publication cannot overwrite an existing immutable asset', async () => {
  const gh = { api: async (route) => {
    if (route === 'git/ref/heads/main') return { object: { sha: 'head' } };
    if (route === 'git/commits/head') return { tree: { sha: 'tree' } };
    if (route === 'git/trees/tree?recursive=1') return { tree: [{ path: 'public/ios/releases/id/manifest.json', sha: 'different' }] };
    throw new Error('Unexpected mutation');
  } };
  await assert.rejects(commitFiles(gh, [{ path: 'public/ios/releases/id/manifest.json', immutable: true, bytes: Buffer.from('changed') }], 'release'), /overwrite/);
});
test('website metadata read before a concurrent update cannot overwrite that update', async () => {
  const gh = { api: async (route) => {
    if (route === 'git/ref/heads/main') return { object: { sha: 'new-head' } };
    if (route === 'git/commits/new-head') return { tree: { sha: 'new-tree' } };
    if (route === 'git/trees/new-tree?recursive=1') return { tree: [{ path: 'public/releases/channels.json', sha: 'new-blob' }] };
    throw new Error('Unexpected mutation');
  } };
  await assert.rejects(commitFiles(gh, [{ path: 'public/releases/channels.json', expectedSha: 'old-blob', bytes: Buffer.from('{}') }], 'release'), /concurrently/);
});
test('Google universal APK selection rejects upload keys and absent universal output', () => {
  const expected = 'a'.repeat(64);
  assert.equal(selectUniversal({ generatedApks: [{ certificateSha256Hash: expected, generatedUniversalApk: { downloadId: 'correct' } }] }, expected), 'correct');
  assert.throws(() => selectUniversal({ generatedApks: [{ certificateSha256Hash: 'b'.repeat(64), generatedUniversalApk: { downloadId: 'wrong' } }] }, expected));
  assert.throws(() => selectUniversal({ generatedApks: [{ certificateSha256Hash: expected, generatedSplitApks: [{}] }] }, expected));
});
test('EAS provenance rejects dirty builds even when commit hash matches', () => {
  const release = state();
  const build = { app: { id: config.expoProjectId }, gitCommitHash: release.sourceSha, appIdentifier: config.bundleId, platform: 'IOS', distribution: 'STORE', buildProfile: 'production', appVersion: release.version, appBuildVersion: '170', isGitWorkingTreeDirty: false, message: `release:${release.version}:${release.sourceSha}` };
  validateBuild(build, release, 'ios');
  assert.throws(() => validateBuild({ ...build, isGitWorkingTreeDirty: true }, release, 'ios'));
  assert.throws(() => validateBuild({ ...build, message: 'manual' }, release, 'ios'));
});
test('pending stores preserve old availability; conflicting APK hashes are rejected', () => {
  const current = { schemaVersion: 1, channels: { appStore: { version: '0.1.0', build: '169' }, githubApk: null } };
  const next = mergeChannels(current, { githubApk: { version: '0.1.1', build: '30', sha256: 'a'.repeat(64) } });
  assert.deepEqual(next.channels.appStore, current.channels.appStore);
  assert.throws(() => mergeChannels(next, { githubApk: { version: '0.1.1', build: '30', sha256: 'b'.repeat(64) } }));
  assert.deepEqual(mergeChannels(next, { appStore: { version: '0.0.9', build: '100' } }), next);
});

test('large publication files go through a partial clone and a non-force git push', async () => {
  const childProcess = (await import('node:child_process')).default;
  const { syncBuiltinESMExports } = await import('node:module');
  const { mock } = await import('node:test');
  const { GIT_PUBLISH_THRESHOLD } = await import('../hosting.mjs');
  const { GitHub } = await import('../core.mjs');
  const gh = new GitHub('fake-canary-token', 'SovranBitcoin/sovran.money');
  const big = Buffer.alloc(GIT_PUBLISH_THRESHOLD + 1, 1);
  const calls = [];
  const handle = mock.method(childProcess, 'execFileSync', (binary, args, options) => {
    assert.equal(binary, 'git'); calls.push(args);
    assert.ok(!args.join(' ').includes('fake-canary-token'), 'token must not appear in argv');
    assert.ok(String(options.env.GIT_CONFIG_VALUE_0).startsWith('AUTHORIZATION: basic '));
    if (args[0] === 'rev-parse') return calls.some((c) => c[0] === 'push') ? 'new-head\n' : 'old-head\n';
    if (args[0] === 'ls-tree') return args.at(-1) === 'public/ios/releases/id/existing.ipa' ? '100644 blob deadbeef\tpublic/ios/releases/id/existing.ipa\n' : '';
    return '';
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(commitFiles(gh, [{ path: 'public/ios/releases/id/existing.ipa', bytes: big, immutable: true }], 'x'), /Refusing to overwrite immutable release asset/);
    calls.length = 0;
    const sha = await commitFiles(gh, [{ path: 'public/ios/releases/id/variant/a.ipa', bytes: big, immutable: true }, { path: 'public/releases/0.1.3-ios.json', bytes: Buffer.from('[]'), immutable: true }], 'chore: publish');
    assert.equal(sha, 'new-head');
    const clone = calls.find((c) => c[0] === 'clone'); assert.ok(clone.includes('--filter=blob:none') && clone.includes('--no-checkout'));
    assert.ok(calls.some((c) => c[0] === 'read-tree'));
    assert.deepEqual(calls.filter((c) => c[0] === 'add').map((c) => c.at(-1)), ['public/ios/releases/id/variant/a.ipa', 'public/releases/0.1.3-ios.json']);
    const push = calls.find((c) => c[0] === 'push'); assert.deepEqual(push, ['push', '--quiet', 'origin', 'HEAD:main']);
  } finally { handle.mock.restore(); syncBuiltinESMExports(); }
});

test('Freedom source keeps upstream Prettier formatting and date shape', async () => {
  const next = updateSource(source(), state());
  const entry = next.apps[0].versions[0];
  assert.match(entry.date, /^\d{4}-\d{2}-\d{2}$/, 'catalog dates are plain calendar days like every other entry');
  const upstream = '{\n  "apps": [\n    {\n      "entitlements": ["com.apple.developer.associated-domains"],\n      "versions": [{ "version": "0.1.0" }]\n    }\n  ]\n}\n';
  assert.equal(await formatSource(JSON.parse(upstream)), upstream, 'formatting a Prettier-formatted file is a no-op');
  const formatted = await formatSource(next);
  assert.ok(!formatted.includes('[\n        "https://'), 'short arrays stay on one line');
  assert.ok(formatted.endsWith('\n') && !formatted.endsWith('\n\n'));
});

const certificate = 'c'.repeat(64);
const androidState = () => ({
  version: '0.1.3', sourceSha: 'd'.repeat(40), builds: { android: { number: '24' } },
  channels: {
    googlePlay: { version: '0.1.3', build: '24', sourceSha: 'd'.repeat(40) },
    githubApk: { version: '0.1.3', build: '24', sourceSha: 'd'.repeat(40), sha256: 'e'.repeat(64), certificateSha256: certificate, size: 10, url: 'https://github.com/x/y/releases/download/v0.1.3/a.apk' },
    zapstore: { version: '0.1.3', build: '24', sourceSha: 'd'.repeat(40), sha256: 'e'.repeat(64), certificateSha256: certificate, size: 10 },
  },
});
const zapstoreEvents = () => ({
  app: { tags: [['d', config.bundleId]] },
  release: { tags: [['d', `${config.bundleId}@0.1.3`], ['i', config.bundleId], ['version', '0.1.3'], ['c', 'main'], ['e', 'asset-id']] },
  asset: { id: 'asset-id', tags: [['i', config.bundleId], ['x', 'e'.repeat(64)], ['version', '0.1.3'], ['version_code', '24'], ['size', '10'], ['apk_certificate_hash', certificate], ['commit', 'd'.repeat(40)]] },
});

test('a channel serving different APK bytes, certificate or build is not cross-updatable', () => {
  const expected = crossChannel(androidState());
  assert.deepEqual(expected, { version: '0.1.3', versionCode: '24', sha256: 'e'.repeat(64), certificateSha256: certificate, size: 10, url: androidState().channels.githubApk.url });
  for (const [channel, field, value] of [['zapstore', 'sha256', 'f'.repeat(64)], ['zapstore', 'certificateSha256', 'f'.repeat(64)], ['zapstore', 'size', 11]]) {
    const state = androidState(); state.channels[channel][field] = value;
    assert.throws(() => crossChannel(state), /different APKs/);
  }
  for (const [channel, field, value] of [['googlePlay', 'build', '25'], ['githubApk', 'version', '0.1.2'], ['zapstore', 'sourceSha', 'a'.repeat(40)]]) {
    const state = androidState(); state.channels[channel][field] = value;
    assert.throws(() => crossChannel(state), /disagree/);
  }
  for (const channel of ['googlePlay', 'githubApk', 'zapstore']) {
    const state = androidState(); delete state.channels[channel];
    assert.throws(() => crossChannel(state), /has not confirmed/);
  }
});

test('the signing certificate may never change and version codes only rise', () => {
  const releases = [{ version: '0.1.4', versionCode: '25', certificateSha256: certificate }, { version: '0.1.3', versionCode: '24', certificateSha256: certificate }, { version: '0.1.2', versionCode: '23' }];
  assert.deepEqual(certificateContinuity(releases), { certificate, releases: ['0.1.3 (24)', '0.1.4 (25)'] });
  assert.throws(() => certificateContinuity([...releases.slice(1), { version: '0.1.5', versionCode: '26', certificateSha256: 'f'.repeat(64) }]), /second signing certificate/);
  assert.throws(() => certificateContinuity([...releases.slice(1), { version: '0.1.5', versionCode: '24', certificateSha256: certificate }]), /version code/);
  assert.throws(() => certificateContinuity([{ version: '0.1.2', versionCode: '23' }]), /No published Android release/);
});

test('Zapstore events must describe the published APK, not merely the same app', () => {
  const expected = crossChannel(androidState());
  assert.equal(zapstoreEvidence(zapstoreEvents(), expected).commit, 'd'.repeat(40));
  const mutate = (part, tag, value) => { const events = zapstoreEvents(); events[part].tags = events[part].tags.map((t) => (t[0] === tag ? [tag, value] : t)); return events; };
  assert.throws(() => zapstoreEvidence(mutate('asset', 'x', 'f'.repeat(64)), expected), /does not describe/);
  assert.throws(() => zapstoreEvidence(mutate('asset', 'apk_certificate_hash', 'f'.repeat(64)), expected), /certificate or version code/);
  assert.throws(() => zapstoreEvidence(mutate('asset', 'version_code', '25'), expected), /certificate or version code/);
  assert.throws(() => zapstoreEvidence(mutate('release', 'e', 'other-asset'), expected), /does not reference/);
  assert.throws(() => zapstoreEvidence(mutate('app', 'd', 'com.other.app'), expected), /another package/);
  assert.throws(() => zapstoreEvidence({ ...zapstoreEvents(), asset: undefined }, expected), /missing an application/);
  const duplicate = zapstoreEvents(); duplicate.asset.tags.push(['x', 'f'.repeat(64)]);
  assert.throws(() => zapstoreEvidence(duplicate, expected), /Duplicate Zapstore scalar tag/);
});

test('every APK signing block is named, so a new scheme cannot pass unnoticed', () => {
  const entry = (id, size) => { const value = Buffer.alloc(size); const head = Buffer.alloc(12); head.writeBigUInt64LE(BigInt(size + 4)); head.writeUInt32LE(id, 8); return Buffer.concat([head, value]); };
  const entries = Buffer.concat([entry(0x7109871a, 16), entry(0x70e1c89f, 32), entry(0xdeadbeef, 8)]);
  const size = BigInt(entries.length + 24);
  const head = Buffer.alloc(8); head.writeBigUInt64LE(size);
  const foot = Buffer.alloc(8); foot.writeBigUInt64LE(size);
  const block = Buffer.concat([head, entries, foot, Buffer.from('APK Sig Block 42')]);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50); eocd.writeUInt32LE(block.length, 16);
  assert.deepEqual(signingBlocks(Buffer.concat([block, eocd])), ['v2', 'v3.2 hybrid', 'unknown 0xdeadbeef']);
  assert.throws(() => signingBlocks(Buffer.concat([Buffer.alloc(block.length), eocd])), /no signing block/);
});
