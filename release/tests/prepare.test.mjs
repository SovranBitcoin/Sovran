import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepare } from '../prepare.mjs';
import { config, artifactHosts } from '../core.mjs';

async function withReleaseEnvironment(run) {
  const names = ['GITHUB_REPOSITORY', 'GITHUB_REF', 'RELEASE_MODE', 'RELEASE_ENABLED', 'ARTIFACT_DOWNLOAD_HOSTS', 'ANDROID_CERT_SHA256', 'FREEDOM_FORK', 'ZAPSTORE_NPUB'];
  const old = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  Object.assign(process.env, { GITHUB_REPOSITORY: config.repository, GITHUB_REF: 'refs/heads/main', RELEASE_MODE: 'release', RELEASE_ENABLED: 'true', ANDROID_CERT_SHA256: 'a'.repeat(64), FREEDOM_FORK: 'bot/freedomstore', ZAPSTORE_NPUB: 'test-public-identity' });
  delete process.env.ARTIFACT_DOWNLOAD_HOSTS;
  try { await run(); } finally { for (const name of names) if (old[name] === undefined) delete process.env[name]; else process.env[name] = old[name]; }
}
function repository(productVersion) {
  return {
    api: async (route) => { assert.equal(route, 'git/ref/heads/main'); return { object: { sha: 'a'.repeat(40) } }; },
    file: async (file) => file === 'active.json' ? null : { bytes: Buffer.from(JSON.stringify({ expo: { version: productVersion, ios: { bundleIdentifier: config.bundleId }, android: { package: config.bundleId } } })) },
    optional: async () => { throw new Error('Unexpected operation before preflight passed'); },
  };
}
test('merging the pipeline version does not start publication or require provider secrets', () => withReleaseEnvironment(async () => {
  assert.equal(config.baselineVersion, '0.1.1');
  await prepare(repository(config.baselineVersion));
}));
test('the next version fails before state creation when artifact hosts are missing', () => withReleaseEnvironment(async () => {
  await assert.rejects(prepare(repository('0.1.2')), /Missing ARTIFACT_DOWNLOAD_HOSTS/);
}));
test('artifact hosts accept exact DNS hosts and reject URLs, wildcards and empty entries', () => withReleaseEnvironment(async () => {
  process.env.ARTIFACT_DOWNLOAD_HOSTS = 'artifacts.eascdn.net, storage.googleapis.com';
  assert.deepEqual(artifactHosts(), ['artifacts.eascdn.net', 'storage.googleapis.com']);
  for (const value of ['*.example.com', 'https://example.com/', 'example.com,', '127.0.0.1', 'example.com/private']) {
    process.env.ARTIFACT_DOWNLOAD_HOSTS = value;
    assert.throws(artifactHosts);
  }
}));
