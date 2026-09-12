import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { request, download, safeUrl, GitHub, Ledger, sha256, compareVersion, published, diagnostic, errorDetail } from '../core.mjs';

test('API credentials cannot follow redirects or escape the allowed origin', async () => {
  const calls = [];
  const handle = mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options }); return new Response(null, { status: 302, headers: { location: 'https://attacker.example/token' } });
  });
  try {
    await assert.rejects(request('https://api.github.com/repos/a/b', { hosts: ['api.github.com'], token: 'fake-canary' }), /HTTP 302/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.redirect, 'error');
    assert.throws(() => safeUrl('https://api.github.com@attacker.example/', ['api.github.com']));
    assert.throws(() => safeUrl('http://api.github.com/', ['api.github.com']));
    assert.throws(() => safeUrl('https://api.github.com:8443/', ['api.github.com']));
  } finally { handle.mock.restore(); }
});

test('artifact redirects are checked before the next request and never carry auth', async () => {
  let calls = 0;
  const handle = mock.method(globalThis, 'fetch', async (_url, options) => {
    calls++; assert.equal(options.headers, undefined);
    return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private' } });
  });
  try { await assert.rejects(download('https://github.com/artifact', ['github.com'])); assert.equal(calls, 1); }
  finally { handle.mock.restore(); }
});

test('network exception text never propagates signed URLs or credentials', async () => {
  const handle = mock.method(globalThis, 'fetch', async () => { throw new Error('https://host/?secret=fake-canary'); });
  try {
    await assert.rejects(request('https://api.github.com/', { hosts: ['api.github.com'] }), (error) => !error.message.includes('fake-canary'));
    await assert.rejects(download('https://github.com/', ['github.com']), (error) => !error.message.includes('fake-canary'));
  } finally { handle.mock.restore(); }
});

test('oversized provider data fails closed', async () => {
  const handle = mock.method(globalThis, 'fetch', async () => new Response('12345'));
  try { await assert.rejects(download('https://github.com/file', ['github.com'], 4)); }
  finally { handle.mock.restore(); }
});

test('write-ahead intent survives lost acknowledgement and is not issued twice', async () => {
  let saved; let calls = 0;
  const gh = {
    file: async () => saved ? { sha: 'one', bytes: saved } : null,
    put: async (_file, bytes) => { saved = Buffer.from(bytes); calls++; throw new Error('lost acknowledgement'); },
  };
  const ledger = new Ledger(gh);
  ledger.state = { schema: 1, version: '1.0.0', sourceSha: 'a'.repeat(40), intents: {} };
  await assert.rejects(ledger.intent('build-ios'));
  const resumed = new Ledger(gh); await resumed.load();
  assert.equal(await resumed.intent('build-ios'), false);
  assert.equal(calls, 1);
});

test('version comparison is numeric and rejects shell-shaped versions', () => {
  assert.equal(compareVersion('0.10.0', '0.9.9'), 1);
  assert.equal(compareVersion('1.0.0', '1.0.0'), 0);
  assert.throws(() => compareVersion('1.0.0;echo secret', '1.0.0'));
  assert.equal(sha256(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
test('reconfirming publication preserves timestamp and avoids website churn', () => {
  const state = { version: '1.0.0', sourceSha: 'a'.repeat(40), channels: {} };
  state.channels.appStore = published(state, 'appStore', '170', 'https://apps.apple.com/app/id6499554529');
  assert.equal(published(state, 'appStore', '170', state.channels.appStore.url), state.channels.appStore);
  assert.throws(() => published(state, 'appStore', '171', state.channels.appStore.url));
});

test('large checkpoint files resume through the immutable Git blob', async () => {
  const sha = 'a'.repeat(40);
  const calls = [];
  const handle = mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push(String(url));
    if (calls.length === 1) {
      assert.equal(options.headers.Accept, 'application/vnd.github.object+json');
      return Response.json({ type: 'file', sha, encoding: 'none', content: '' });
    }
    assert.ok(String(url).endsWith(`/git/blobs/${sha}`));
    return Response.json({ sha, encoding: 'base64', content: Buffer.from('checkpoint').toString('base64') });
  });
  try {
    const result = await new GitHub('fake-canary').file('active.json', 'release-state');
    assert.equal(result.bytes.toString(), 'checkpoint');
    assert.equal(result.sha, sha);
    assert.equal(calls.length, 2);
  } finally { handle.mock.restore(); }
});

test('diagnostics expose only error classes and codes, never provider text', async () => {
  const canary = 'fake-canary-secret';
  const network = Object.assign(new TypeError(`fetch failed ${canary}`), { code: 'ECONNRESET' });
  assert.equal(diagnostic(new Error(canary, { cause: network })), 'Error/ECONNRESET');
  assert.equal(diagnostic(new Error(canary, { cause: new TypeError(canary) })), 'Error/TypeError');
  assert.equal(diagnostic(new TypeError(canary)), 'TypeError');
  assert.equal(diagnostic(Object.assign(new Error(canary), { cause: { code: `bad ${canary}` } })), 'Error/unknown');
  assert.equal(diagnostic(undefined), 'unknown');
  const located = new TypeError(canary);
  located.stack = `TypeError: ${canary}\n    at androidRelease (file:///home/runner/work/Sovran/Sovran/controller/release/android.mjs:44:63)\n    at run (file:///x/release/run.mjs:20:5)`;
  assert.equal(diagnostic(located), 'TypeError@android.mjs:44:63');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw Object.assign(new TypeError(canary), { code: 'UND_ERR_SOCKET' }); };
  try {
    await assert.rejects(request('https://api.github.com/', { hosts: ['api.github.com'] }), (error) => /^Error\/UND_ERR_SOCKET@core\.mjs:\d+:\d+$/.test(diagnostic(error)) && !error.message.includes(canary));
    await assert.rejects(download('https://github.com/', ['github.com']), (error) => /^Error\/UND_ERR_SOCKET@core\.mjs:\d+:\d+$/.test(diagnostic(error)) && !error.message.includes(canary));
  } finally { globalThis.fetch = originalFetch; }
});

test('4xx JSON error envelopes surface only codes and a sanitized message', async () => {
  const canary = 'fake-canary-secret';
  const google = { error: { code: 400, message: `Version code 23 has already been used. <a href="https://x/${canary}?token=${canary}">\nsee</a>`, status: 'INVALID_ARGUMENT', errors: [{ reason: 'apkUpgradeVersionConflict', message: 'x' }] } };
  const detail = errorDetail(JSON.stringify(google));
  assert.match(detail, /^INVALID_ARGUMENT\/apkUpgradeVersionConflict: Version code 23 has already been used/);
  assert.ok(!detail.includes('<') && !detail.includes('?') && !detail.includes('='));
  assert.equal(errorDetail('not json'), '');
  const github = { message: 'Validation Failed', errors: [{ resource: 'Blob', code: 'too_large', field: 'content', message: `content is too large ${canary}` }], documentation_url: 'https://docs.github.com/x' };
  assert.equal(errorDetail(JSON.stringify(github)), 'too_large: Validation Failed Blob content content is too large fake-canary-secret');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json(google, { status: 400 });
  try {
    await assert.rejects(request('https://api.github.com/', { hosts: ['api.github.com'] }), (error) => error.status === 400 && /^Provider HTTP 400 INVALID_ARGUMENT\/apkUpgradeVersionConflict: Version code 23/.test(error.message) && /^[A-Za-z0-9 .:;()/_-]{1,180}$/.test(error.message));
  } finally { globalThis.fetch = originalFetch; }
  globalThis.fetch = async () => new Response('<html>oops</html>', { status: 502, headers: { 'content-type': 'text/html' } });
  try { await assert.rejects(request('https://api.github.com/', { hosts: ['api.github.com'] }), (error) => error.message === 'Provider HTTP 502'); } finally { globalThis.fetch = originalFetch; }
});

test('Apple and Play locales are configured separately and valid', async () => {
  const { config } = await import('../core.mjs');
  assert.match(config.locale, /^[a-z]{2}-[A-Z]{2}$/);
  assert.match(config.appleLocale, /^[a-z]{2}-[A-Z]{2}$/);
  assert.match(config.appleScreenshotSet, /^APP_IPHONE_\d{2}$/, 'the hosted screenshot set is pinned to the one the App Store listing serves');
});
