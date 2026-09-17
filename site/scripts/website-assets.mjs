import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSourceCatalog, readSourceFile, sha256 } from './source-catalog.mjs';
import { renderComposition, rasterize } from './composition.mjs';
import { resolveCapture } from './composition-recipe.mjs';
import { websiteRecipes } from './website-config.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const rendererFiles = ['site/scripts/website-assets.mjs', 'site/scripts/website-config.mjs',
  'site/scripts/composition.mjs', 'site/scripts/composition-recipe.mjs', 'site/scripts/source-catalog.mjs',
  'scripts/lib/phone-frame.mjs', 'scripts/lib/app-source.mjs',
  'app/assets/fonts/MonaSans/MonaSans-ExtraBold.ttf', 'app/assets/fonts/MonaSans/MonaSans-Medium.ttf'];
const optionalJson = async file => {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
};

export async function websiteAssetStatus(repoRoot = root) {
  const config = JSON.parse((await readSourceFile(repoRoot, 'press/website.json')).toString());
  const selected = websiteRecipes(config);
  const catalog = await buildSourceCatalog(repoRoot);
  const renderer = Object.fromEntries(await Promise.all(rendererFiles.map(async file => [file, sha256(await readSourceFile(repoRoot, file))])));
  const manifest = await optionalJson(join(repoRoot, 'site/public/social/manifest.json'));
  const outputs = [];
  for (const { output, scene, recipe } of selected) {
    const captures = recipe.phones.map(phone => resolveCapture(catalog, phone.captureId));
    const blockers = recipe.phones.flatMap((phone, i) => captures[i]?.available && captures[i].freshness === 'current' ? [] :
      [`${phone.captureId}: ${captures[i]?.freshness ?? 'missing'}${captures[i]?.reason ? ` (${captures[i].reason})` : ''}`]);
    const recipeSha256 = sha256(JSON.stringify(recipe));
    const sources = captures.map(capture => capture ? { id: capture.id, file: capture.file, sha256: capture.sha256, run: capture.run,
      capturedAt: capture.capturedAt, appSource: capture.appSource, nativeBuild: capture.nativeBuild, recordSha256: capture.recordSha256,
      source: capture.source, evidenceClass: capture.evidenceClass, captureEvidence: capture.captureEvidence,
      publicationEligibility: capture.publicationEligibility, publicationReview: capture.publicationReview } : null);
    const sourceSha256 = sha256(JSON.stringify({ renderer, sources }));
    const previous = manifest?.outputs?.[output];
    let matches = false;
    try { matches = sha256(await readSourceFile(repoRoot, `site/public/${output}`)) === previous?.sha256; }
    catch (error) { if (error.code !== 'ENOENT') blockers.push(`Output cannot be verified: ${error.message}`); }
    const renderCurrent = captures.every(capture => capture?.available) && previous?.recipeSha256 === recipeSha256 && previous?.sourceSha256 === sourceSha256 && previous?.provenance?.draft === false && matches;
    const current = !blockers.length && renderCurrent;
    const sourceFiles = [...new Set(captures.flatMap(capture => capture?.file ? [capture.file,
      capture.source === 'library' ? 'press/screenshots/manifest.json' : 'press/artwork/source/screenshots.json'] : []))];
    outputs.push({ output, scene, recipe, recipeSha256, sourceSha256, sourceFiles, blockers, renderCurrent, current });
  }
  return { outputs, manifest, renderer, fingerprint: catalog.fingerprint };
}

export async function generateWebsiteAssets({ repoRoot = root, check = false } = {}) {
  const status = await websiteAssetStatus(repoRoot);
  const blocked = status.outputs.flatMap(output => output.blockers.map(reason => `${output.output}: ${reason}`));
  if (blocked.length) throw new Error(`Website assets blocked; previous outputs preserved.\n${blocked.join('\n')}`);
  const stale = status.outputs.filter(output => !output.current);
  if (check) {
    if (stale.length) throw new Error(`Website assets need regeneration: ${stale.map(output => output.output).join(', ')}`);
    return { generated: [], current: status.outputs.map(output => output.output) };
  }
  if (!stale.length) return { generated: [], current: status.outputs.map(output => output.output) };
  const publicRoot = join(repoRoot, 'site/public'), destination = join(publicRoot, 'social');
  // Never follow an output-directory symlink or remove files we do not own.
  for (const path of [join(repoRoot, 'site'), publicRoot, destination]) {
    try { assert((await lstat(path)).isDirectory(), `Not a real output directory: ${path}`); }
    catch (error) { if (error.code !== 'ENOENT' || path !== destination) throw error; }
  }
  let existing = [];
  try { existing = await readdir(destination); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const name of existing) {
    assert(['og.png', 'manifest.json'].includes(name), `Unowned file in website output directory: ${name}`);
    const bytes = await readSourceFile(repoRoot, `site/public/social/${name}`);
    if (name !== 'manifest.json') assert.equal(sha256(bytes), status.manifest?.images?.[name], `Refusing to replace edited or unowned output: ${name}`);
  }
  const before = Object.fromEntries(await Promise.all(existing.map(async name => [name, sha256(await readSourceFile(repoRoot, `site/public/social/${name}`))])));
  const stage = await mkdtemp(join(publicRoot, '.website-stage-'));
  const staged = join(stage, 'social'), backup = join(stage, 'previous');
  await mkdir(staged);
  let moved = false;
  try {
    const outputs = {}, images = {};
    for (const selected of status.outputs) {
      const result = await renderComposition(selected.recipe, { repoRoot });
      assert.equal(result.provenance.draft, false, 'Public outputs must never contain draft artwork.');
      assert.equal(result.provenance.imageLabel, null, 'Public outputs must not carry provenance text in their pixels.');
      assert(result.provenance.captures.every(capture => capture.freshness === 'current'), 'Renderer returned non-current captures.');
      const png = await rasterize(result.svg);
      assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      assert.equal(png.readUInt32BE(16), selected.recipe.width);
      assert.equal(png.readUInt32BE(20), selected.recipe.height);
      const hash = sha256(png);
      outputs[selected.output] = { recipeSha256: selected.recipeSha256, sourceSha256: selected.sourceSha256, sha256: hash, provenance: result.provenance };
      images['og.png'] = hash;
      await writeFile(join(staged, 'og.png'), png);
    }
    const manifest = { version: 1, renderer: 'composition-v1', appSourceFingerprint: status.fingerprint, outputs, images };
    await writeFile(join(staged, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    assert.equal(sha256(await readFile(join(staged, 'og.png'))), images['og.png']);
    assert.equal(JSON.stringify(JSON.parse(await readFile(join(staged, 'manifest.json'), 'utf8'))), JSON.stringify(manifest));
    const after = await websiteAssetStatus(repoRoot);
    assert.deepEqual(after.outputs.map(({ recipeSha256, sourceSha256, blockers }) => ({ recipeSha256, sourceSha256, blockers })),
      status.outputs.map(({ recipeSha256, sourceSha256, blockers }) => ({ recipeSha256, sourceSha256, blockers })), 'Website sources changed while rendering; prior outputs preserved.');
    let names = [];
    try { names = await readdir(destination); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    assert.deepEqual(names.sort(), existing.sort(), 'Website destination changed during render.');
    for (const [name, hash] of Object.entries(before)) assert.equal(sha256(await readSourceFile(repoRoot, `site/public/social/${name}`)), hash, 'Website destination changed during render.');
    try { await rename(destination, backup); moved = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { await rename(staged, destination); }
    catch (error) { if (moved) { await rename(backup, destination); moved = false; } throw error; }
    return { generated: stale.map(output => output.output), current: [] };
  } finally {
    // If rollback itself failed, retain the backup for manual recovery.
    if (!moved || await lstat(destination).then(() => true, () => false)) await rm(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert(process.argv.slice(2).every(arg => arg === '--check') && process.argv.length <= 3, 'Usage: node site/scripts/website-assets.mjs [--check]');
    console.log(JSON.stringify(await generateWebsiteAssets({ check: process.argv.includes('--check') }), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
