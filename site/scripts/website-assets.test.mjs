import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm, symlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { appSourceFingerprint } from '../../scripts/lib/app-source.mjs';
import { sha256 } from './source-catalog.mjs';
import { websiteRecipes, websiteScenes } from './website-config.mjs';
import { generateWebsiteAssets, websiteAssetStatus } from './website-assets.mjs';
import { websiteCaptures } from './website-captures.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sharp = createRequire(import.meta.url)('sharp');
const config = JSON.parse(await readFile(join(root, 'press/website.json'), 'utf8'));

test('website selection is only OG, and named scene edits feed both consumers', () => {
  assert.deepEqual(websiteRecipes(config).map(entry => entry.output), ['social/og.png']);
  const edited = structuredClone(config);
  edited.phones.feed.pose = { rotateZ: 8 };
  assert.deepEqual(websiteRecipes(edited)[0].recipe.phones, websiteScenes(edited).hero.phones);
  for (const update of [{ draft: true }, { output: '../secret.png' }, { scene: 'absent' }, { width: 1000 }]) {
    const invalid = structuredClone(config); Object.assign(invalid.recipes[0], update);
    assert.throws(() => websiteRecipes(invalid));
  }
  const duplicate = structuredClone(config); duplicate.recipes.push(duplicate.recipes[0]);
  assert.throws(() => websiteRecipes(duplicate), /duplicate/);
});

async function fixture(t) {
  const repoRoot = await mkdtemp(join(tmpdir(), 'website-assets-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet'], { cwd: repoRoot });
  const put = async (file, value) => {
    await mkdir(dirname(join(repoRoot, file)), { recursive: true });
    await writeFile(join(repoRoot, file), Buffer.isBuffer(value) || typeof value === 'string' ? value : JSON.stringify(value));
  };
  for (const file of ['site/scripts/website-assets.mjs', 'site/scripts/website-config.mjs', 'site/scripts/composition.mjs',
    'site/scripts/composition-recipe.mjs', 'site/scripts/source-catalog.mjs', 'scripts/lib/phone-frame.mjs', 'scripts/lib/app-source.mjs',
    'app/assets/fonts/MonaSans/MonaSans-ExtraBold.ttf', 'app/assets/fonts/MonaSans/MonaSans-Medium.ttf']) await put(file, await readFile(join(root, file)));
  // Published compositions carry the brand lockup, so the fixture needs the
  // real brand outputs the renderer reads.
  const brand = JSON.parse(await readFile(join(root, 'app/assets/brand/generated/manifest.json'), 'utf8'));
  await put('app/assets/brand/generated/manifest.json', brand);
  for (const variant of brand.variants)
    if (variant.svg)
      await put(`app/assets/brand/${variant.svg}`, await readFile(join(root, `app/assets/brand/${variant.svg}`)));
  await put('press/website.json', config);
  await put('app/source.ts', 'export const fixture = 1;');
  await mkdir(join(repoRoot, 'site/public'), { recursive: true });
  const registry = {};
  const bytes = await sharp({ create: { width: 402, height: 874, channels: 4, background: '#54885b' } }).png().toBuffer();
  for (const id of ['ios/wallet', 'ios/feed']) {
    registry[id] = { file: `source/screenshots/${id}.png`, context: id.slice(4), run: 'run-fixture', sha256: sha256(bytes),
      appSource: { fingerprint: appSourceFingerprint(repoRoot) } };
    await put(`press/artwork/${registry[id].file}`, bytes);
  }
  await put('press/artwork/source/screenshots.json', registry);
  await put('press/artwork/source/screenshot-context.json', { contexts: {}, collections: [] });
  return { repoRoot, put, registry };
}

test('current sources produce one raster, matching provenance and hashes; check and repeated generation do not write', async t => {
  const { repoRoot, put } = await fixture(t);
  assert.deepEqual((await generateWebsiteAssets({ repoRoot })).generated, ['social/og.png']);
  assert.deepEqual(await readdir(join(repoRoot, 'site/public')), ['social']);
  assert.deepEqual((await readdir(join(repoRoot, 'site/public/social'))).sort(), ['manifest.json', 'og.png']);
  const before = await readFile(join(repoRoot, 'site/public/social/manifest.json'));
  const status = await websiteAssetStatus(repoRoot);
  assert.equal(status.outputs[0].current, true);
  assert.equal(status.manifest.outputs['social/og.png'].provenance.draft, false);
  assert.deepEqual((await generateWebsiteAssets({ repoRoot, check: true })).generated, []);
  assert.deepEqual((await generateWebsiteAssets({ repoRoot })).generated, []);
  assert.deepEqual(await readFile(join(repoRoot, 'site/public/social/manifest.json')), before);
  const edited = structuredClone(config); edited.recipes[0].background = 'forest';
  await put('press/website.json', edited);
  await assert.rejects(generateWebsiteAssets({ repoRoot, check: true }), /need regeneration/);
  await generateWebsiteAssets({ repoRoot });
  assert.notDeepEqual(await readFile(join(repoRoot, 'site/public/social/manifest.json')), before);
  assert.equal((await websiteAssetStatus(repoRoot)).outputs[0].current, true);
});

test('public image imports follow only the declared recipe, including screenshot replacements', async t => {
  const { repoRoot, put, registry } = await fixture(t);
  const selected = structuredClone(config);
  selected.scenes = { hero: selected.scenes.hero };
  await put('press/website.json', selected);
  registry['ios/backup-words'] = { ...registry['ios/wallet'], file: 'source/screenshots/ios/backup-words.png', context: 'backup-words' };
  await put('press/artwork/source/screenshots/ios/backup-words.png', await readFile(join(repoRoot, 'press/artwork/source/screenshots/ios/wallet.png')));
  await put('press/artwork/source/screenshots.json', registry);
  const plugin = websiteCaptures({ repoRoot });
  const load = () => plugin.load.call({ addWatchFile() {} }, plugin.resolveId('virtual:sovran-website-captures'));
  const original = await load();
  assert.equal(original.match(/^import image/gm).length, 2);
  assert(!original.includes('backup-words'));
  selected.phones.feed.captureId = 'ios/backup-words';
  await put('press/website.json', selected);
  const changed = await load();
  assert(changed.includes('screenshots/ios/backup-words.png'));
  assert(!changed.includes('screenshots/ios/feed.png'));
  registry['ios/backup-words'].availability = 'unavailable';
  await put('press/artwork/source/screenshots.json', registry);
  await assert.rejects(load(), /missing or unapproved/);
});

test('unrelated capture updates do not invalidate or rewrite the selected output', async t => {
  const { repoRoot, put, registry } = await fixture(t);
  await generateWebsiteAssets({ repoRoot });
  const before = await readFile(join(repoRoot, 'site/public/social/manifest.json'));
  registry['android/settings'] = { file: 'source/screenshots/android/settings.png', run: null, sha256: null };
  await put('press/artwork/source/screenshots.json', registry);
  assert.equal((await websiteAssetStatus(repoRoot)).outputs[0].current, true);
  assert.deepEqual((await generateWebsiteAssets({ repoRoot })).generated, []);
  assert.deepEqual(await readFile(join(repoRoot, 'site/public/social/manifest.json')), before);
});

test('outdated app source and invalid rendering preserve previous bytes and leave no staging files', async t => {
  const { repoRoot, put } = await fixture(t);
  await generateWebsiteAssets({ repoRoot });
  const png = await readFile(join(repoRoot, 'site/public/social/og.png'));
  const manifest = await readFile(join(repoRoot, 'site/public/social/manifest.json'));
  await put('app/source.ts', 'export const fixture = 2;');
  for (const check of [true, false]) await assert.rejects(generateWebsiteAssets({ repoRoot, check }), /outdated/);
  await put('app/source.ts', 'export const fixture = 1;');
  const changed = structuredClone(config); changed.recipes[0].headline = 'x'.repeat(180);
  await put('press/website.json', changed);
  await assert.rejects(generateWebsiteAssets({ repoRoot }), /too wide/);
  assert.deepEqual(await readFile(join(repoRoot, 'site/public/social/og.png')), png);
  assert.deepEqual(await readFile(join(repoRoot, 'site/public/social/manifest.json')), manifest);
  assert.deepEqual(await readdir(join(repoRoot, 'site/public')), ['social']);
});

test('drafts, symlink destinations, edited outputs and unowned files cannot be published or removed', async t => {
  const { repoRoot, put } = await fixture(t);
  const changed = structuredClone(config); changed.recipes[0].draft = true;
  await put('press/website.json', changed);
  await assert.rejects(generateWebsiteAssets({ repoRoot }), /draft/);
  await put('press/website.json', config);
  await symlink(join(repoRoot, 'press'), join(repoRoot, 'site/public/social'));
  await assert.rejects(generateWebsiteAssets({ repoRoot }), /Symlink|real output/);
  await rm(join(repoRoot, 'site/public/social'));
  await generateWebsiteAssets({ repoRoot });
  changed.recipes[0].draft = false; changed.recipes[0].background = 'forest';
  await put('press/website.json', changed);
  await put('site/public/social/user.png', 'user data');
  await assert.rejects(generateWebsiteAssets({ repoRoot }), /Unowned file/);
  assert.equal(await readFile(join(repoRoot, 'site/public/social/user.png'), 'utf8'), 'user data');
  await rm(join(repoRoot, 'site/public/social/user.png'));
  await put('site/public/social/og.png', 'edited');
  await assert.rejects(generateWebsiteAssets({ repoRoot }), /edited or unowned/);
});
