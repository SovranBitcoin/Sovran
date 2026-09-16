import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { validateRecipe, recipeHash, recipeFromHash, resolveCapture } from './composition-recipe.mjs';
import { buildSourceCatalog, readCaptureSource, sha256 } from './source-catalog.mjs';
import { renderComposition } from './composition.mjs';
import { localArtwork } from './local-artwork.mjs';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const sharp = require('sharp');
const base = { version: 1, id: 'wallet', title: 'Wallet', headline: 'Cash on your phone.', subtitle: 'Its value depends on the mint.', background: 'charcoal', width: 640, height: 640, preset: 'single-front', phones: [{ captureId: 'ios/wallet' }], draft: true };

test('recipe boundary rejects unbounded data, prototype fields, paths, markup backgrounds, nonfinite poses and count mismatches', () => {
  assert.deepEqual(recipeFromHash(recipeHash(base)), base);
  for (const change of [{ version: 2 }, { id: undefined }, { id: '../file' }, { headline: 'x'.repeat(181) }, { subtitle: '\0' }, { width: 8192 }, { width: 320, height: 2560 }, { height: NaN }, { width: 2560, height: 2560 }, { background: 'url(http://example.com)' }, { preset: 'constructor' }, { phones: [] }, { phones: Array(5).fill(base.phones[0]) }, { arbitrary: true }, { draft: 'yes' }, { phones: [{ captureId: 'https://example.com' }] }, { phones: [{ captureId: 'ios/wallet', frameId: 'android-emulator' }] }, { phones: [{ captureId: 'ios/wallet', pose: { rotateY: 75 } }] }, { phones: [{ captureId: 'ios/wallet', pose: { scale: Infinity } }] }, { phones: [{ captureId: 'ios/wallet', pose: { file: '/etc/passwd' } }] }]) assert.throws(() => validateRecipe({ ...base, ...change }), JSON.stringify(change));
  assert.throws(() => recipeFromHash('#recipe=' + 'x'.repeat(24001)));
});

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'sovran-composition-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (file, value) => { await mkdir(dirname(join(root, file)), { recursive: true }); await writeFile(join(root, file), Buffer.isBuffer(value) || typeof value === 'string' ? value : JSON.stringify(value)); };
  const registry = {};
  for (const [id, width, height] of [['ios/wallet', 402, 874], ['android/wallet', 360, 800], ['ios/feed', 402, 874], ['ios/send', 402, 874]]) {
    const bytes = await sharp({ create: { width, height, channels: 4, background: '#54885b' } }).png().toBuffer();
    registry[id] = { file: `source/screenshots/${id}.png`, run: 'run-fixture', sha256: sha256(bytes), context: id.split('/')[1] };
    await put(`press/artwork/${registry[id].file}`, bytes);
  }
  await put('press/artwork/source/screenshots.json', registry);
  await put('app/e2e/schema/pages.ts', await readFile(join(repoRoot, 'app/e2e/schema/pages.ts')));
  await put('press/artwork/source/screenshot-context.json', { contexts: { wallet: { page: 'wallet', caption: 'Wallet', relatedPages: ['feed', 'send'] } }, collections: [] });
  for (const weight of ['ExtraBold', 'Medium']) { const file = `app/assets/fonts/MonaSans/MonaSans-${weight}.ttf`; await put(file, await readFile(join(repoRoot, file))); }
  // The published watermark is a real brand output, so renders need the real
  // lockups rather than a stand-in shape.
  const brand = JSON.parse(await readFile(join(repoRoot, 'app/assets/brand/generated/manifest.json'), 'utf8'));
  await put('app/assets/brand/generated/manifest.json', brand);
  for (const variant of brand.variants) if (variant.svg) await put(`app/assets/brand/${variant.svg}`, await readFile(join(repoRoot, `app/assets/brand/${variant.svg}`)));
  return { root, put, registry };
}

test('catalog never substitutes missing, mismatched, withdrawn or symlinked pixels; inventory alone is not image authority', async t => {
  const { root, put, registry } = await fixture(t);
  await put('press/screenshots/inventory.json', { version: 1, targets: [{ platform: 'android', page: 'settings', state: 'default', baseline: true, status: 'planned', file: '/etc/passwd' }] });
  let catalog = await buildSourceCatalog(root);
  assert(catalog.captures.find(capture => capture.id === 'ios/wallet').available);
  assert.equal(catalog.captures.find(capture => capture.id === 'android/settings').freshness, 'notattempted');
  registry['ios/wallet'].sha256 = '0'.repeat(64);
  registry['android/wallet'].availability = 'unavailable';
  await put('press/artwork/source/screenshots.json', registry);
  catalog = await buildSourceCatalog(root);
  assert.equal(catalog.captures.find(capture => capture.id === 'ios/wallet').freshness, 'missing');
  assert.equal(catalog.captures.find(capture => capture.id === 'android/wallet').freshness, 'withdrawn');
  await assert.rejects(renderComposition(base, { repoRoot: root }), /unavailable/);
  await rm(join(root, 'press/artwork/source/screenshots/ios/feed.png'));
  await symlink(join(root, 'press/artwork/source/screenshots/ios/send.png'), join(root, 'press/artwork/source/screenshots/ios/feed.png'));
  assert.equal((await buildSourceCatalog(root)).captures.find(capture => capture.id === 'ios/feed').available, false);
});

async function libraryFixture(t) {
  const setup = await fixture(t);
  const { root, put, registry } = setup;
  const records = [];
  for (const [platform, page, state] of [['ios', 'wallet', 'default'], ['android', 'wallet', 'default'], ['ios', 'ai', 'model-picker']]) {
    const width = platform === 'ios' ? 1320 : 1080, height = platform === 'ios' ? 2868 : 2400;
    const bytes = await sharp({ create: { width, height, channels: 4, background: page === 'ai' ? '#374459' : '#374458' } }).png().toBuffer();
    const record = { platform, page, state, file: `${platform}/${page}${state === 'default' ? '' : `--${state}`}.png`,
      evidenceClass: platform === 'ios' ? 'native-fixture' : 'native-navigation', functionalResult: 'not-established',
      privacy: platform === 'ios' ? 'public-fixture' : 'disposable-profile', publicationEligibility: 'eligible', status: 'verified',
      scenario: 'store.screenshots', occurrence: 1, stepId: 'T1', runId: 'run-synthetic-importer', capturedAt: '2026-09-15T12:00:00.000Z',
      sourceFingerprint: '1'.repeat(64), appSource: { fingerprint: '2'.repeat(64), gitSha: '3'.repeat(40), gitDirty: false },
      nativeBuild: { fingerprint: '4'.repeat(40), artifactSha256: 'a'.repeat(64), appVersion: '0.1.3', buildNumber: '2', gitSha: '3'.repeat(40), builtAt: '2026-09-15T10:00:00.000Z' },
      recipeSha256: '5'.repeat(64), manifestSha256: '6'.repeat(64), eventsSha256: '7'.repeat(64), originalSha256: '8'.repeat(64), sha256: sha256(bytes), width, height,
      sessionSha256: '9'.repeat(64), captureProfile: { profile: 'library-v1',
        model: platform === 'ios' ? 'iPhone 17 Pro Max' : 'sdk_gphone64_arm64', runtime: platform === 'ios' ? '26.2' : '16',
        ...(platform === 'android' ? { systemImage: 'system-images/android-36.1/google_apis_playstore/arm64-v8a' } : {}),
        resolution: { width, height }, density: platform === 'ios' ? { scale: 3 } : { dpi: 420 }, locale: 'en-US', appearance: 'light', fontScale: 1 } };
    records.push(record);
    await put(`press/screenshots/${record.file}`, bytes);
  }
  const targets = records.map(record => ({ platform: record.platform, page: record.page, state: record.state, baseline: record.state === 'default',
    scenario: record.scenario, occurrence: record.occurrence, stepId: record.stepId, evidenceClass: record.evidenceClass, privacy: record.privacy,
    publicationEligibility: 'eligible-after-verification', status: 'planned', blocker: null, readiness: [], readinessStepIds: ['T0'], routes: [] }));
  const manifest = { version: 1, baselineDenominator: 202, inventory: targets, captures: records };
  const inventory = { version: 1, targets: structuredClone(targets), campaign: { id: 'synthetic', status: 'running' } };
  inventory.targets[0] = { ...inventory.targets[0], status: 'failed', reason: 'Latest run timed out', lastAttempt: { status: 'failed', at: '2026-09-15T13:00:00.000Z', reason: 'Timeout' } };
  registry['ios/ai-model-picker'] = { ...registry['ios/wallet'], file: 'source/screenshots/ios/ai-model-picker.png', page: 'ai', context: 'ai-model-picker' };
  await put('press/artwork/source/screenshots/ios/ai-model-picker.png', await readFile(join(root, 'press/artwork/source/screenshots/ios/wallet.png')));
  await put('press/artwork/source/screenshots.json', registry);
  await put('press/artwork/source/screenshot-context.json', { contexts: { wallet: { page: 'wallet', relatedPages: ['ai'] }, 'ai-model-picker': { page: 'ai', caption: 'Model picker' } } });
  await put('press/artwork/source/concepts/ai-models.json', { id: 'ai-models', platform: 'ios', screenshots: ['ai-model-picker'] });
  await put('press/screenshots/manifest.json', manifest);
  await put('press/screenshots/inventory.json', inventory);
  return { ...setup, records, manifest, inventory };
}

test('all 202 canonical baseline slots exist before captures and inventory preserves blocked/planned/failed statuses', async t => {
  const { root, put } = await fixture(t);
  let catalog = await buildSourceCatalog(root);
  assert.equal(catalog.coverage.baselineDenominator, 202);
  assert.equal(catalog.coverage.baselineSlots, 202);
  const camera = resolveCapture(catalog, 'ios/camera');
  assert.equal(camera.attemptStatus, 'blocked'); assert.match(camera.blocker, /plan unavailable/);
  await put('press/screenshots/inventory.json', { version: 1, targets: [
    { platform: 'ios', page: 'camera', state: 'default', baseline: true, status: 'blocked', blocker: 'Permission fixture required', privacy: 'blocked' },
    { platform: 'android', page: 'camera', state: 'default', baseline: true, status: 'planned', reason: 'Awaiting run' },
    { platform: 'ios', page: 'wallet', state: 'default', baseline: true, status: 'failed', lastAttempt: { reason: 'Timeout' } },
  ] });
  catalog = await buildSourceCatalog(root);
  assert.equal(catalog.coverage.baselineSlots, 202);
  assert.equal(resolveCapture(catalog, 'ios/camera').attemptStatus, 'blocked');
  assert.equal(resolveCapture(catalog, 'ios/camera').blocker, 'Permission fixture required');
  assert.equal(resolveCapture(catalog, 'android/camera').attemptStatus, 'planned');
  const wallet = resolveCapture(catalog, 'ios/wallet');
  assert.equal(wallet.available, true); assert.equal(wallet.freshness, 'unverified'); assert.equal(wallet.attemptStatus, 'failed');
  assert.deepEqual(wallet.latestAttempt, { reason: 'Timeout' });
  assert.equal(wallet.plan.source, 'press/screenshots/inventory.json');
});

test('importer library images replace press pixels, preserve logical aliases and report evidence independently of failed latest attempts', async t => {
  const { root, records, registry } = await libraryFixture(t);
  const catalog = await buildSourceCatalog(root);
  const wallet = resolveCapture(catalog, 'ios/wallet');
  assert.equal(wallet.source, 'library'); assert.equal(wallet.sha256, records[0].sha256); assert.notEqual(wallet.sha256, registry['ios/wallet'].sha256);
  assert.equal(wallet.available, true); assert.equal(wallet.freshness, 'unknown'); assert.equal(wallet.attemptStatus, 'failed');
  assert.equal(wallet.latestAttempt.reason, 'Timeout');
  assert.equal(wallet.evidenceClass, 'native-fixture'); assert.equal(wallet.functionalResult, 'not-established');
  assert.equal(wallet.publicationEligibility, 'eligible'); assert.equal(wallet.publicationReview, 'not-established');
  assert.equal(resolveCapture(catalog, 'android/wallet').evidenceClass, 'native-navigation');
  const alias = resolveCapture(catalog, 'ios/ai-model-picker');
  assert.equal(alias.id, 'ios/ai--model-picker'); assert.equal(alias.source, 'library'); assert.equal(alias.stateId, 'model-picker');
  assert.equal(catalog.concepts[0].captureIds[0], 'ios/ai-model-picker');
  assert(!catalog.concepts[0].captureIds.some(id => id.includes('camera')));
  const result = await renderComposition({ ...base, phones: [{ captureId: 'ios/ai-model-picker' }] }, { repoRoot: root });
  assert.equal(result.provenance.captures[0].sha256, alias.sha256);
  assert.equal(result.provenance.captures[0].canonicalId, 'ios/ai--model-picker');
  assert.equal(result.provenance.captures[0].publicationReview, 'not-established');
});

test('library approval rejects private, malformed, wrong-profile, duplicate and unapproved captures even in draft mode', async t => {
  const { root, put, manifest } = await libraryFixture(t);
  for (const change of [{ privacy: 'private' }, { publicationEligibility: 'blocked' }, { functionalResult: 'passed' }, { evidenceClass: 'unavailable' },
    { status: 'captured' }, { sessionSha256: null }, { file: '../wallet.png' }, { file: 'android/wallet.png' },
    { width: 402 }, { captureProfile: { ...manifest.captures[0].captureProfile, locale: 'en-GB' } }]) {
    await put('press/screenshots/manifest.json', { ...manifest, captures: [{ ...manifest.captures[0], ...change }] });
    const wallet = resolveCapture(await buildSourceCatalog(root), 'ios/wallet');
    assert.equal(wallet.available, false, JSON.stringify(change));
    assert.equal(wallet.freshness, 'withdrawn');
    await assert.rejects(renderComposition(base, { repoRoot: root }), /unavailable/);
  }
  await put('press/screenshots/manifest.json', { ...manifest, captures: [manifest.captures[0], manifest.captures[0]] });
  assert.equal(resolveCapture(await buildSourceCatalog(root), 'ios/wallet').available, false);
});

test('library image serving verifies exact bytes and revokes cached URLs after tamper, symlinks or changed approval', async t => {
  const { root, put, manifest, inventory } = await libraryFixture(t);
  let middleware;
  localArtwork({ repoRoot: root }).configureServer({ middlewares: { use(handler) { middleware = handler; } } });
  const server = createServer((request, response) => middleware(request, response, () => { response.writeHead(404); response.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const catalog = await (await fetch(`${origin}/__artwork/sources`)).json();
  const wallet = resolveCapture(catalog, 'ios/wallet'), url = `${origin}${wallet.imageUrl}`;
  const bytes = await readCaptureSource(root, wallet);
  assert.deepEqual(Buffer.from(await (await fetch(url)).arrayBuffer()), bytes);
  assert.equal((await fetch(url, { method: 'HEAD' })).status, 200);
  manifest.captures[0].privacy = 'private'; await put('press/screenshots/manifest.json', manifest);
  assert.equal((await fetch(url)).status, 409);
  manifest.captures[0].privacy = 'public-fixture'; await put('press/screenshots/manifest.json', manifest);
  await put(wallet.file, Buffer.concat([bytes, Buffer.from('tampered')]));
  assert.equal((await fetch(url)).status, 409);
  assert.equal(resolveCapture(await buildSourceCatalog(root), 'ios/wallet').available, false);
  await rm(join(root, wallet.file));
  await symlink(join(root, 'press/artwork/source/screenshots/ios/wallet.png'), join(root, wallet.file));
  assert.equal((await fetch(url)).status, 409);
  assert.equal(resolveCapture(await buildSourceCatalog(root), 'ios/wallet').available, false);
  await rm(join(root, wallet.file)); await put(wallet.file, bytes);
  inventory.targets[0].privacy = 'blocked'; await put('press/screenshots/inventory.json', inventory);
  assert.equal((await fetch(url)).status, 409);
  inventory.targets[0].privacy = 'public-fixture'; await put('press/screenshots/inventory.json', inventory);
  await rm(join(root, 'press/screenshots/ios'), { recursive: true });
  await put('press/screenshots/redirect/wallet.png', bytes);
  await symlink(join(root, 'press/screenshots/redirect'), join(root, 'press/screenshots/ios'));
  assert.equal((await fetch(url)).status, 409);
  assert.equal(resolveCapture(await buildSourceCatalog(root), 'ios/wallet').available, false);
});

test('the brand watermark is placed, reserves its own band, and only drafts carry a label', async t => {
  const { root } = await fixture(t);
  const images = svg => (svg.match(/<image\b/g) ?? []).length;
  const box = svg => svg.match(/<svg x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/).slice(1).map(Number);
  const render = brand => renderComposition({ ...base, width: 1200, height: 630, brand }, { repoRoot: root });
  const plain = await render({ placement: 'none' });
  const bottomLeft = await render({ placement: 'bottom-left' });
  const topCenter = await render({ placement: 'top-center' });
  // One extra embedded image is the lockup itself; 'none' opts out entirely.
  assert.equal(images(plain.svg), 1);
  assert.equal(images(bottomLeft.svg), 2);
  assert.equal(bottomLeft.provenance.brand.placement, 'bottom-left');
  assert.equal(plain.provenance.brand.lockup, 'wordmark');
  // A top watermark pushes the phones down; a bottom one only shortens them.
  const [, plainY, , plainHeight] = box(plain.svg);
  const [, topY, , topHeight] = box(topCenter.svg);
  const [, bottomY, , bottomHeight] = box(bottomLeft.svg);
  assert(topY > plainY, 'A top watermark must reserve space above the phones.');
  assert.equal(bottomY, plainY);
  assert(bottomHeight < plainHeight && topHeight < plainHeight);
  // The label is what a viewer sees; publishable renders show nothing.
  assert.equal(bottomLeft.provenance.imageLabel, bottomLeft.provenance.disclosure);
  assert.equal(bottomLeft.provenance.draft, true);
  const symbol = await render({ placement: 'bottom-right', lockup: 'symbol', scale: 1.4 });
  assert.equal(symbol.provenance.brand.scale, 1.4);
  assert.notEqual(symbol.svg.match(/<image[^>]*data:image\/png[^>]*\/>/g).at(-1), bottomLeft.svg.match(/<image[^>]*data:image\/png[^>]*\/>/g).at(-1));
});

test('final SVG and PNG agree exactly, text is outlined/escaped, mixed platforms and 1-4 phone presets render with draft evidence', async t => {
  const { root } = await fixture(t);
  await assert.rejects(renderComposition({ ...base, draft: false }, { repoRoot: root }), /Explicitly enable draft/);
  for (const [count, preset] of [[1, 'single-front'], [2, 'duo-mirror'], [3, 'triple-fan'], [4, 'quartet-grid']]) {
    const phones = ['ios/wallet', 'android/wallet', 'ios/feed', 'ios/send'].slice(0, count).map(captureId => ({ captureId }));
    const result = await renderComposition({ ...base, title: '<script>alert(1)</script>', preset, phones }, { repoRoot: root });
    const metadata = await sharp(result.png).metadata();
    assert.equal(metadata.width, 640); assert.equal(metadata.height, 640);
    assert.deepEqual(await sharp(Buffer.from(result.svg)).png().toBuffer(), result.png);
    assert(!result.svg.includes('<script>')); assert(result.svg.includes('&lt;script&gt;'));
    assert(!result.svg.includes('<text')); assert(result.svg.includes('DRAFT'));
    assert.equal(result.provenance.captures.length, count);
    assert(result.provenance.captures.every(capture => capture.freshness === 'unverified'));
    if (count > 1) assert(result.svg.includes('data-platform="android"'));
  }
  await assert.rejects(renderComposition({ ...base, phones: [{ captureId: 'ios/wallet', frameId: 'iphone-17-pro-max' }] }, { repoRoot: root }), /aspect ratio/);
  await assert.rejects(renderComposition({ ...base, headline: 'x'.repeat(180) }, { repoRoot: root }), /too wide/);
});
