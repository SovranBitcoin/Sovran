import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer, request } from 'node:http';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ARTWORK_ROOTS, CATALOG_CAVEATS, buildArtworkCatalog, isCurrentArtwork, localArtwork } from './local-artwork.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1cAAAAASUVORK5CYII=', 'base64');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'sovran-gallery-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (path, value) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value));
  };
  await put('press/artwork/source/screenshots.json', {
    'ios/receive-qr': { file: 'source/screenshots/ios/receive-qr.png', availability: 'unavailable',
      unavailableReason: 'Replacement diagnostic capture aborted; retained capture is stale.' },
    'ios/wallet': { file: 'source/screenshots/ios/wallet.png' },
  });
  await put('press/artwork/source/screenshots/ios/receive-qr.png', png);
  await put('press/artwork/source/screenshots/ios/wallet.png', png);
  await put('press/artwork/source/concepts/receive-unified.json', { platform: 'ios', screenshots: ['receive-qr'] });
  await put('scripts/render.mjs', 'renderer');
  const output = { file: 'receive-unified/wide.png', sha256: sha(png), draft: true,
    sourceHashes: { 'source/screenshots/ios/receive-qr.png': sha(png) },
    renderer: { 'scripts/render.mjs': sha('renderer') },
    provenance: { note: 'Historical pixels' }, context: 'Receive', aspect: 'wide',
  };
  await put('press/artwork/generated/receive-unified/wide.png', png);
  await put('press/artwork/generated/manifest.json', { concepts: {
    'receive-unified': { title: 'Receive poster', outputs: [output] },
  } });
  await put('site/public/mockups/alias.png', png);
  await put('press/exports/variants/deep/new.png', Buffer.concat([png, Buffer.from('new')]));
  await put('app/assets/brand/generated/mark.png', Buffer.concat([png, Buffer.from('brand')]));
  return { root, put, output };
}

test('catalog deduplicates bytes, retains aliases, recursively includes variants and brand', async (t) => {
  const { root } = await fixture(t);
  const catalog = await buildArtworkCatalog(root);
  assert.equal(catalog.fileCount, 4);
  assert.equal(catalog.uniqueCount, 3);
  assert.deepEqual(catalog.diagnostics, []);
  const poster = catalog.items.find((item) => item.id === sha(png));
  assert.equal(poster.aliases.length, 2);
  assert.deepEqual(poster.families, ['artwork', 'mockups']);
  assert(poster.statuses.includes('current-render'));
  assert(!poster.statuses.includes('native-freshness-unverified'));
  assert(poster.statuses.includes('stale-known-capture'));
  assert(poster.statuses.includes('draft'));
  assert.equal(poster.aliases[0].title, 'Receive poster');
  assert.equal(poster.aliases[0].context, 'Receive');
  assert(poster.aliases[0].diagnostics.some((message) => message.includes('aborted')));
  assert.deepEqual(poster.aliases[1].statuses, ['untracked']);
  assert.deepEqual(catalog.caveats, ['native-freshness-unverified']);
  assert.equal(poster.current, false);
  assert(poster.aliases.every((alias) => alias.current === false));
  const brand = catalog.items.find((item) => item.families.includes('brand'));
  assert.deepEqual(brand.statuses, ['untracked']);
  assert.equal(brand.current, false);
});

test('changed output, renderer, source and provenance hashes mark stale-render; refresh discovers new files', async (t) => {
  const { root, put, output } = await fixture(t);
  output.provenanceHashes = { 'source/screenshots.json': '0'.repeat(64) };
  await put('press/artwork/generated/manifest.json', { concepts: { 'receive-unified': { outputs: [output] } } });
  await put('scripts/render.mjs', 'changed');
  await put('press/artwork/source/screenshots/ios/receive-qr.png', Buffer.concat([png, Buffer.from('changed')]));
  await put('press/artwork/generated/receive-unified/wide.png', Buffer.concat([png, Buffer.from('output')]));
  await put('press/exports/new/new.png', Buffer.concat([png, Buffer.from('refresh')]));
  const catalog = await buildArtworkCatalog(root);
  assert.equal(catalog.fileCount, 5);
  const poster = catalog.items.find((item) => item.aliases[0].path.endsWith('receive-unified/wide.png'));
  assert(poster.statuses.includes('stale-render'));
  assert(!poster.statuses.includes('current-render'));
  assert.equal(poster.aliases[0].diagnostics.filter((message) => message.startsWith('Changed')).length, 3);
  assert(poster.aliases[0].diagnostics.includes('Output bytes differ from manifest'));
});

test('unselected poster variants inherit their capture and draft evidence', async (t) => {
  const { root, put, output } = await fixture(t);
  const bytes = Buffer.concat([png, Buffer.from('variant')]);
  const variant = { ...output, file: 'variants/receive-unified/spotlight/tall.png', sha256: sha(bytes) };
  await put(`press/artwork/generated/${variant.file}`, bytes);
  await put('press/artwork/generated/manifest.json', { concepts: {
    'receive-unified': { outputs: [output], variants: { 'spotlight/tall': variant } },
  } });
  const image = (await buildArtworkCatalog(root)).items.find(item => item.id === sha(bytes));
  assert(image.statuses.includes('draft'));
  assert(image.statuses.includes('stale-known-capture'));
  assert.equal(image.aliases[0].title, 'receive-unified');
});

test('poster freshness includes canonical brand inputs', async (t) => {
  const { root, put, output } = await fixture(t);
  const config = JSON.stringify({ versionFont: 'app/assets/fonts/version.ttf' });
  await put('app/assets/brand/source/brand.json', config);
  await put('app/assets/brand/source/symbol.svg', 'mark');
  await put('app/assets/brand/source/wordmark.svg', 'wordmark');
  await put('app/assets/fonts/version.ttf', 'font');
  output.brand = { mark: sha('mark'), wordmark: sha('wordmark'), font: sha('font'), config: sha(config) };
  await put('press/artwork/generated/manifest.json', { concepts: { 'receive-unified': { outputs: [output] } } });
  let item = (await buildArtworkCatalog(root)).items.find(item => item.id === sha(png));
  assert(item.statuses.includes('current-render'));
  for (const [file, value] of [['symbol.svg', 'mark'], ['wordmark.svg', 'wordmark']]) {
    await put(`app/assets/brand/source/${file}`, 'changed');
    item = (await buildArtworkCatalog(root)).items.find(item => item.id === sha(png));
    assert(item.statuses.includes('stale-render'));
    assert(!item.statuses.includes('current-render'));
    await put(`app/assets/brand/source/${file}`, value);
  }
});

test('whole-build capture inputs are uncertainty, not proof a stale screenshot appears in an image', async (t) => {
  const { root, put } = await fixture(t);
  const bytes = Buffer.concat([png, Buffer.from('legacy-scene')]);
  await put('press/mockups/hero.png', bytes);
  await put('press/mockups/manifest.json', {
    images: { 'hero.png': sha(bytes) },
    inputs: { 'press/artwork/source/screenshots/ios/receive-qr.png': sha(png) },
  });
  const item = (await buildArtworkCatalog(root)).items.find(item => item.id === sha(bytes));
  assert(item.statuses.includes('capture-scope-unverified'));
  assert(!item.statuses.includes('stale-known-capture'));
  assert.equal(item.current, true);
  assert.equal(item.aliases[0].current, true);
});

test('native-freshness caveat is stated once on the catalog; current flags partition items for the default view', async (t) => {
  const { root, put, output } = await fixture(t);
  await put('press/artwork/source/concepts/receive-unified.json', { platform: 'ios', screenshots: ['wallet'] });
  output.draft = false;
  output.sourceHashes = { 'source/screenshots/ios/wallet.png': sha(png) };
  await put('press/artwork/generated/manifest.json', { concepts: { 'receive-unified': { outputs: [output] } } });
  const catalog = await buildArtworkCatalog(root);
  assert.deepEqual(catalog.caveats, CATALOG_CAVEATS);
  assert.deepEqual([...CATALOG_CAVEATS], ['native-freshness-unverified']);
  for (const item of catalog.items) {
    assert(!item.statuses.includes('native-freshness-unverified'), item.id);
    for (const alias of item.aliases) assert(!alias.statuses.includes('native-freshness-unverified'), alias.path);
  }
  const poster = catalog.items.find((item) => item.id === sha(png));
  assert.equal(poster.aliases[0].current, true);
  assert.equal(poster.aliases[1].current, false);
  assert.equal(poster.current, true);
  const current = catalog.items.filter((item) => item.current);
  const review = catalog.items.filter((item) => !item.current);
  assert.deepEqual(current.map((item) => item.id), [sha(png)]);
  assert.equal(review.length, 2);
  assert.equal(current.length + review.length, catalog.uniqueCount);
});

test('browser images/exports/inputs match bytes, prefer explicit screenshot keys, preserve metadata', async (t) => {
  const { root, put } = await fixture(t);
  const bytes = Buffer.concat([png, Buffer.from('browser')]);
  await put('press/mockups/browser.png', bytes);
  const manifest = { images: { 'browser.png': sha(bytes) }, renderer: 'Chrome',
    inputs: { 'scripts/render.mjs': sha('renderer'), 'press/artwork/source/screenshots/ios/receive-qr.png': sha(png) },
    exports: { 'browser.png': { title: '<img src=x onerror=alert(1)>', screenshots: ['ios/wallet'], format: 'square', context: 'Wallet' } },
  };
  await put('press/mockups/manifest.json', manifest);
  let image = (await buildArtworkCatalog(root)).items.find((item) => item.id === sha(bytes));
  assert(image.statuses.includes('current-render'));
  assert(!image.statuses.includes('stale-known-capture'));
  assert.equal(image.aliases[0].metadata[0].renderer, 'Chrome');
  manifest.exports['browser.png'].screenshots = ['ios/receive-qr'];
  await put('press/mockups/manifest.json', manifest);
  image = (await buildArtworkCatalog(root)).items.find((item) => item.id === sha(bytes));
  assert(image.statuses.includes('stale-known-capture'));
  manifest.exports['browser.png'].screenshots = ['press/artwork/source/screenshots/ios/receive-qr.png'];
  await put('press/mockups/manifest.json', manifest);
  image = (await buildArtworkCatalog(root)).items.find((item) => item.id === sha(bytes));
  assert(image.statuses.includes('stale-known-capture'));
  await put('scripts/render.mjs', 'new renderer');
  image = (await buildArtworkCatalog(root)).items.find((item) => item.id === sha(bytes));
  assert(image.statuses.includes('stale-render'));
});

test('rejects arbitrary files, source wallpaper, native/private captures, traversal and symlink escapes', async (t) => {
  const { root, put } = await fixture(t);
  await put('secret.png', png);
  await put('press/artwork/source/wallpapers/private.png', png);
  await put('app/e2e/runs/run-diagnostic/pixels.png', png);
  await put('press/exports/private/secret.png', png);
  await put('press/exports/run-aborted/receive.png', png);
  await put('press/exports/captures/private.png', png);
  await put('press/exports/not-an-image.png', 'private text');
  await put('press/exports/arbitrary.txt', 'secret');
  await put('press/exports/arbitrary.svg', '<svg/>');
  await symlink(join(root, 'secret.png'), join(root, 'press/exports/escape.png'));
  await symlink(join(root, 'app/e2e/runs'), join(root, 'press/exports/linked-directory'));
  await symlink(join(root, 'press/artwork/generated/receive-unified/wide.png'), join(root, 'press/exports/internal-link.png'));
  await put('press/exports/manifest.json', { images: { '../../secret.png': sha(png), '/secret.png': sha(png) } });
  const catalog = await buildArtworkCatalog(root);
  assert.equal(catalog.fileCount, 4);
  assert.equal(catalog.uniqueCount, 3);
  assert(catalog.diagnostics.some((message) => message.includes('non-PNG')));
  assert(!catalog.items.flatMap((item) => item.aliases).some((alias) => /secret|linked|private|run-|wallpapers/.test(alias.path)));
  // Redirecting an allowlisted root itself is rejected too.
  await symlink(join(root, 'app/e2e/runs'), join(root, 'press/mockups'));
  const redirected = await buildArtworkCatalog(root);
  assert.equal(redirected.fileCount, 4);
  assert(redirected.diagnostics.some((message) => message.includes('press/mockups')));
});

test('malformed manifests keep images visible as untracked with diagnostics', async (t) => {
  const { root, put } = await fixture(t);
  await put('press/artwork/generated/manifest.json', '{broken');
  const catalog = await buildArtworkCatalog(root);
  assert.equal(catalog.fileCount, 4);
  assert(catalog.items.every((item) => item.statuses.includes('untracked')));
  assert(catalog.diagnostics.some((message) => message.includes('manifest.json')));
});

test('registry-key source hashes and recorded renderer aggregates are checked, incomplete records are untracked', async (t) => {
  const { root, put, output } = await fixture(t);
  output.sourceHashes = { 'ios/receive-qr': sha(png) };
  output.rendererHash = sha(`${JSON.stringify(output.renderer, null, 2)}\n`);
  await put('press/artwork/generated/manifest.json', { concepts: { 'receive-unified': { outputs: [output] } } });
  let alias = (await buildArtworkCatalog(root)).items.find((item) => item.id === sha(png)).aliases[0];
  assert(alias.statuses.includes('current-render'));
  assert(alias.statuses.includes('stale-known-capture'));
  output.rendererHash = '0'.repeat(64);
  await put('press/artwork/generated/manifest.json', { concepts: { 'receive-unified': { outputs: [output] } } });
  alias = (await buildArtworkCatalog(root)).items.find((item) => item.id === sha(png)).aliases[0];
  assert(alias.statuses.includes('stale-render'));
  assert(alias.diagnostics.includes('Recorded renderer aggregate hash differs'));
  delete output.renderer;
  await put('press/artwork/generated/manifest.json', { concepts: { 'receive-unified': { outputs: [output] } } });
  alias = (await buildArtworkCatalog(root)).items.find((item) => item.id === sha(png)).aliases[0];
  assert(alias.statuses.includes('untracked'));
  assert(!alias.statuses.includes('current-render'));
});

for (const hook of ['configureServer', 'configurePreviewServer']) test(`${hook}: exact HTTP contract, HEAD, no traversal, changed bytes and rescan`, async (t) => {
  const { root, put } = await fixture(t);
  const plugin = localArtwork({ repoRoot: root });
  assert.equal(plugin.apply, 'serve');
  let middleware;
  plugin[hook]({ middlewares: { use(handler) { middleware = handler; } } });
  const server = createServer((req, res) => middleware(req, res, () => { res.writeHead(418); res.end(); }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const get = (path, method = 'GET', headers = {}) => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: server.address().port, path, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject); req.end();
  });
  const response = await get('/__artwork/catalog', 'GET', { Cookie: 'private=not-forwarded' });
  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['access-control-allow-origin'], undefined);
  assert(!response.body.includes('private=not-forwarded'));
  assert.equal(JSON.parse(response.body).fileCount, 4);
  const image = await get(`/__artwork/image/${sha(png)}`);
  assert.equal(image.status, 200);
  assert.equal(image.headers['content-type'], 'image/png');
  assert.deepEqual(image.body, png);
  for (const path of ['/__artwork/catalog', `/__artwork/image/${sha(png)}`]) {
    assert.equal((await get(path, 'HEAD')).body.length, 0);
    const disallowed = await get(path, 'POST');
    assert.equal(disallowed.status, 405);
    assert.equal(disallowed.headers.allow, 'GET, HEAD');
    assert.equal((await get(path, 'GET', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  }
  for (const path of ['/__artwork/image/../../secret.png', '/__artwork/image/%2e%2e%2fsecret.png',
    '/__artwork/image/%2fetc%2fpasswd', '/__artwork/image/secret.png', `/__artwork/image/${'0'.repeat(64)}`,
    '/__artwork/catalog/extra']) assert.equal((await get(path)).status, 404, path);
  assert.equal((await get('/unrelated')).status, 418);
  await put('press/artwork/generated/receive-unified/wide.png', Buffer.concat([png, Buffer.from('replaced')]));
  assert.equal((await get(`/__artwork/image/${sha(png)}`)).status, 409);
  await put('press/exports/discovered.png', Buffer.concat([png, Buffer.from('discovered')]));
  assert.equal(JSON.parse((await get('/__artwork/catalog')).body).fileCount, 5);
  const discovery = `/__artwork/image/${sha(Buffer.concat([png, Buffer.from('discovered')]))}`;
  await rm(join(root, 'press/exports/discovered.png'));
  await symlink(join(root, 'press/artwork/source/screenshots/ios/receive-qr.png'), join(root, 'press/exports/discovered.png'));
  assert.equal((await get(discovery)).status, 503);
});

test('real catalog matches independently counted files and exact hashes; receive poster stays stale', async (t) => {
  const expected = [], hashes = new Set();
  const scan = async (directory) => {
    let list;
    try { list = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of list) {
      if (entry.isSymbolicLink() || /^(?:\..*|runs?|run-.*|private(?:-.*)?|captures?|native(?:-.*)?|e2e|node_modules)$/i.test(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await scan(path);
      else if (entry.isFile() && /\.png$/i.test(entry.name)) {
        const bytes = await readFile(path);
        if (!bytes.subarray(0, 8).equals(png.subarray(0, 8))) continue;
        expected.push(path); hashes.add(sha(bytes));
      }
    }
  };
  for (const path of ARTWORK_ROOTS) await scan(join(repo, path));
  const catalog = await buildArtworkCatalog(repo);
  assert.equal(catalog.fileCount, expected.length);
  assert.equal(catalog.uniqueCount, hashes.size);
  assert(catalog.uniqueCount > 0);
  assert.deepEqual(new Set(catalog.items.flatMap((item) => item.aliases.map((alias) => join(repo, alias.path)))), new Set(expected));
  const receive = catalog.items.find((item) => item.aliases.some((alias) => alias.path === 'press/artwork/generated/receive-unified/wide.png'));
  assert(receive, 'Existing receive poster must not disappear');
  assert.deepEqual(catalog.caveats, ['native-freshness-unverified']);
  for (const item of catalog.items) {
    assert.equal(item.current, item.aliases.some((alias) => isCurrentArtwork(alias.statuses)));
    for (const alias of item.aliases) {
      assert(!alias.statuses.includes('native-freshness-unverified'), alias.path);
      if (alias.path.startsWith('app/assets/brand/') || alias.path.includes('/feature-graphic/')) {
        assert(!alias.statuses.includes('untracked'), alias.path);
      }
    }
  }
  t.diagnostic(`Actual catalog: ${catalog.fileCount} PNG paths, ${catalog.uniqueCount} unique images, ${catalog.diagnostics.length} scan diagnostics.`);
});

test('posters built from captures older than the app source are outdated, not current', async (t) => {
  const { root, put, output } = await fixture(t);
  await put('app/features/receive/ReceiveScreen.tsx', 'pill row');
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  git('add', '-A');
  git('commit', '-qm', 'initial');
  const { appSourceFingerprint } = await import('../../scripts/lib/app-source.mjs');
  await put('press/artwork/source/screenshots.json', {
    'ios/wallet': {
      file: 'source/screenshots/ios/wallet.png', run: 'run-1', sha256: sha(png),
      appSource: { fingerprint: appSourceFingerprint(root) },
    },
  });
  await put('press/artwork/source/concepts/receive-unified.json', { platform: 'ios', screenshots: ['wallet'] });
  output.draft = false;
  output.sourceHashes = { 'source/screenshots/ios/wallet.png': sha(png) };
  await put('press/artwork/generated/manifest.json', { concepts: { 'receive-unified': { outputs: [output] } } });
  const poster = async () => (await buildArtworkCatalog(root)).items.find((item) => item.id === sha(png));
  let item = await poster();
  assert(!item.statuses.includes('outdated-capture'));
  assert.equal(item.aliases[0].current, true);
  // The receive screen changes after capture: the poster must stop counting as current.
  await put('app/features/receive/ReceiveScreen.tsx', 'no pill row');
  item = await poster();
  assert(item.statuses.includes('outdated-capture'));
  assert.equal(item.aliases[0].current, false);
  assert(item.aliases[0].diagnostics.some((message) => message.includes('app source changed since capture')));
});

test('page compiles without building; grid is default, lazy, accessible and metadata never becomes HTML', async () => {
  const source = await readFile(new URL('../src/pages/dev.astro', import.meta.url), 'utf8');
  const { transform } = await import('../node_modules/@astrojs/compiler/dist/node/index.js');
  const result = await transform(source, { filename: 'dev.astro' });
  assert(!result.diagnostics.some((diagnostic) => diagnostic.severity === 1));
  assert.match(source, /image.loading = 'lazy'/);
  assert.match(source, /node.textContent = text/);
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|set:html/);
  assert.match(source, /credentials: 'omit'/);
  assert.match(source, /grid.replaceChildren\(\.\.\.cards.map/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /id="artwork-view"/);
  assert.match(source, /typeof item\.current !== 'boolean'/);
  assert.match(source, /item\.current\b/);
  assert.match(source, /gallery-chip/);
  assert.doesNotMatch(source, /contact sheet/i);
  assert.doesNotMatch(source, /statuses\.join\(' \/ '\), 'gallery-status'/);
  assert.doesNotMatch(source, /native-freshness-unverified/);
  for (const config of ['astro.config.mjs', 'preview.config.mjs']) {
    assert.match(await readFile(new URL(`../${config}`, import.meta.url), 'utf8'), /localArtwork\(\)/);
  }
});
