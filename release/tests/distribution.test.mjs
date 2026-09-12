import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { config, sha256 } from '../core.mjs';
import { updateSource } from '../freedom.mjs';
import { validateManifest, verifyHosted, commitFiles } from '../hosting.mjs';
import { selectUniversal } from '../android.mjs';
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
