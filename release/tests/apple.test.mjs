import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Apple, appleRelease, copyScreenshots, prepareListing } from '../apple.mjs';
import { config } from '../core.mjs';

test('interrupted owned screenshot reservation resumes upload and checksum commit', async () => {
  const calls = []; let complete = false;
  const existing = { id: 'new-shot', attributes: { fileName: 'sovran-target-old-shot.png', assetDeliveryState: { state: 'AWAITING_UPLOAD' } } };
  const apple = {
    list: async (route) => {
      if (route === 'appStoreVersionLocalizations/source/appScreenshotSets') return [{ id: 'old-set', attributes: { screenshotDisplayType: 'APP_IPHONE_65' } }];
      if (route === 'appStoreVersionLocalizations/target/appScreenshotSets') return [{ id: 'new-set', attributes: { screenshotDisplayType: 'APP_IPHONE_65' } }];
      if (route === 'appScreenshotSets/old-set/appScreenshots') return [{ id: 'old-shot', attributes: { imageAsset: { templateUrl: 'https://is1-ssl.mzstatic.com/image/{w}/{h}.{f}', width: 1, height: 1 } } }];
      if (route === 'appScreenshotSets/new-set/appScreenshots') return [{ ...existing, attributes: { ...existing.attributes, assetDeliveryState: { state: complete ? 'COMPLETE' : 'AWAITING_UPLOAD' } } }];
      throw new Error('Unexpected list');
    },
    api: async (route, method, body) => {
      calls.push({ route, method, body });
      if (route === 'appScreenshots/new-shot' && !method) return { data: { id: 'new-shot', attributes: { fileSize: 4, uploadOperations: [{ url: 'https://upload.apple.com/fixture', method: 'PUT', offset: 0, length: 4, requestHeaders: [] }] } } };
      if (route === 'appScreenshots/new-shot' && method === 'PATCH') { complete = true; return {}; }
      throw new Error('Unexpected mutation');
    },
  };
  const network = mock.method(globalThis, 'fetch', async (_url, options) => new Response(options?.method === 'PUT' ? null : Buffer.from('data')));
  try {
    assert.equal(await copyScreenshots(apple, { id: 'source' }, { id: 'target' }), true);
    assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
    assert.equal(calls.find((c) => c.method === 'PATCH').body.data.attributes.sourceFileChecksum, '8d777f385d3dfec8815d20f7496026dc');
  } finally { network.mock.restore(); }
});

test('inherited screenshots from a previous release are not duplicated', async () => {
  const apple = {
    list: async (route) => {
      if (route.includes('appStoreVersionLocalizations')) return [{ id: route.includes('/source/') ? 'old-set' : 'new-set', attributes: { screenshotDisplayType: 'APP_IPHONE_65' } }];
      if (route.includes('old-set')) return [{ id: 'old-1' }];
      return [1, 2].map((n) => ({ id: `inherited-${n}`, attributes: { fileName: `sovran-previous-locale-${n}.png`, assetDeliveryState: { state: 'COMPLETE' } } }));
    },
    api: async () => { throw new Error('Must preserve inherited/human media'); },
  };
  assert.equal(await copyScreenshots(apple, { id: 'source' }, { id: 'target' }), true);
});

test('READY_FOR_REVIEW resumes the existing owned item instead of creating another', async () => {
  const writes = [];
  const api = mock.method(Apple.prototype, 'api', async (route, method, body) => {
    if (route === `apps/${config.appleAppId}`) return { data: { attributes: { bundleId: config.bundleId } } };
    if (route.startsWith('builds?')) return { data: [{ id: 'binary', attributes: { processingState: 'VALID', expired: false }, relationships: { preReleaseVersion: { data: { id: 'prerelease' } } } }], included: [{ id: 'prerelease', type: 'preReleaseVersions', attributes: { version: '0.1.1', platform: 'IOS' } }] };
    if (route === 'appStoreVersions/target/relationships/build') return { data: { id: 'binary' } };
    writes.push({ route, method, body }); return {};
  });
  const list = mock.method(Apple.prototype, 'list', async (route) => {
    if (route.includes('/appStoreVersions?')) return [{ id: 'target', attributes: { versionString: '0.1.1', appVersionState: 'READY_FOR_REVIEW' } }];
    if (route.includes('/reviewSubmissions?')) return [{ id: 'submission', attributes: { state: 'READY_FOR_REVIEW' } }];
    assert.equal(route, 'reviewSubmissions/submission/items?include=appStoreVersion');
    return [{ relationships: { appStoreVersion: { data: { id: 'target' } } } }];
  });
  try {
    await appleRelease({ state: { version: '0.1.1', builds: { ios: { ready: true, number: '170' } } }, save: async () => {} });
    assert.equal(writes.length, 1);
    assert.equal(writes[0].route, 'reviewSubmissions/submission');
    assert.equal(writes[0].body.data.attributes.submitted, true);
  } finally { api.mock.restore(); list.mock.restore(); }
});

test('partial Apple drafts inherit missing required metadata while preserving edits', async () => {
  const writes = [];
  const apple = {
    api: async (route, method, body) => {
      if (method === 'PATCH') { writes.push({ route, attributes: body.data.attributes }); return {}; }
      if (route === 'appStoreVersions/target/appStoreReviewDetail') return { data: { id: 'contact', attributes: { contactFirstName: 'New', contactLastName: 'Contact', contactPhone: '', contactEmail: 'new@example.test', demoAccountRequired: false } } };
      if (route === 'appStoreVersions/previous/appStoreReviewDetail') return { data: { attributes: { contactFirstName: 'Old', contactLastName: 'Contact', contactPhone: 'fixture-phone', contactEmail: 'old@example.test', demoAccountRequired: true, demoAccountPassword: 'fake-review-canary' } } };
      throw new Error('Unexpected provider operation');
    },
    list: async (route) => {
      if (route === 'appStoreVersions/previous/appStoreVersionLocalizations') return [{ id: 'old-locale', attributes: { locale: 'en-US', description: 'Approved description', supportUrl: 'https://sovran.money', keywords: 'wallet', promotionalText: 'Old promotion' } }];
      if (route === 'appStoreVersions/target/appStoreVersionLocalizations') return [{ id: 'new-locale', attributes: { locale: 'en-US', description: 'Edited description', supportUrl: '', keywords: null, whatsNew: 'Edited release notes', promotionalText: '' } }];
      if (route.endsWith('/appScreenshotSets')) return [];
      throw new Error('Unexpected provider list');
    },
  };
  assert.equal(await prepareListing(apple, { id: 'previous' }, { id: 'target' }, '0.1.1'), true);
  assert.deepEqual(writes, [
    { route: 'appStoreReviewDetails/contact', attributes: { contactPhone: 'fixture-phone' } },
    { route: 'appStoreVersionLocalizations/new-locale', attributes: { keywords: 'wallet', supportUrl: 'https://sovran.money' } },
  ]);
  assert.ok(!JSON.stringify(writes).includes('fake-review-canary'));
});
