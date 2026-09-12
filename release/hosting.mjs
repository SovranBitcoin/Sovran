import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, check, GitHub, request, required, sha256, command, temporary, download, artifactHosts, uuid } from './core.mjs';
import { Apple } from './apple.mjs';

const blobId = (bytes) => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
export async function commitFiles(gh, files, message) {
  const unique = new Map();
  for (const file of files) {
    const previous = unique.get(file.path);
    if (previous) check(previous.bytes.equals(file.bytes) && previous.immutable === file.immutable, 'Conflicting publication files share a path');
    else unique.set(file.path, file);
  }
  files = [...unique.values()];
  check(files.length > 0 && files.length <= 10000, 'Invalid publication file count');
  for (const file of files) check(/^(public\/(ios\/(releases|media)\/|releases\/)|src\/releaseMedia\.json$)/.test(file.path) && !file.path.includes('..') && !file.path.includes('\\'), 'Publication path outside allowlist');
  const head = (await gh.api('git/ref/heads/main')).object.sha;
  const commit = await gh.api(`git/commits/${head}`);
  const tree = await gh.api(`git/trees/${commit.tree.sha}?recursive=1`);
  check(!tree.truncated, 'Website tree truncated');
  const entries = [];
  for (const file of files) {
    const previous = tree.tree.find((entry) => entry.path === file.path);
    if (file.expectedSha) check(previous?.sha === file.expectedSha, 'Website metadata changed concurrently; retry against new state');
    const same = previous?.sha === blobId(file.bytes);
    if (same) continue;
    if (file.immutable) check(!previous, 'Refusing to overwrite immutable release asset');
    check(file.bytes.length < 99_000_000, 'Publication file exceeds GitHub limit');
    const blob = await gh.api('git/blobs', { method: 'POST', body: { content: file.bytes.toString('base64'), encoding: 'base64' } });
    entries.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  if (!entries.length) return head;
  const nextTree = await gh.api('git/trees', { method: 'POST', body: { base_tree: commit.tree.sha, tree: entries } });
  const next = await gh.api('git/commits', { method: 'POST', body: { message, tree: nextTree.sha, parents: [head] } });
  // No force. A concurrent website change rejects this push; the next reconcile
  // recomputes against current main and preserves the other author's work.
  await gh.api('git/refs/heads/main', { method: 'PATCH', body: { sha: next.sha, force: false } });
  return next.sha;
}

export function validateManifest(manifest, state) {
  check(manifest.bundleId === config.bundleId && String(manifest.appleItemId) === config.appleAppId && manifest.shortVersionString === state.version && String(manifest.bundleVersion) === state.builds.ios.number, 'ADP manifest identity mismatch');
  check(typeof manifest.minimumSystemVersions?.ios === 'string' && /^\d+(\.\d+){0,2}$/.test(manifest.minimumSystemVersions.ios), 'Missing ADP minimum iOS version');
}
export async function verifyHosted(inventory) {
  check(Array.isArray(inventory) && inventory.length > 0, 'Empty publication inventory');
  for (const file of inventory) {
    try {
      const bytes = await download(`${config.website}/${file.path}`, ['sovran.money'], file.size + 1);
      if (bytes.length !== file.size || sha256(bytes) !== file.sha256) return false;
    } catch (error) { if (error.status === 404) return false; throw error; }
  }
  return true;
}
async function mediaFiles(state, apple) {
  const locales = await apple.list(`appStoreVersions/${state.appleVersionId}/appStoreVersionLocalizations`);
  // App Store Connect localizations (en-GB) differ from the Play release-notes
  // language (en-US); each is configured explicitly.
  const wanted = config.appleLocale ?? config.locale;
  const locale = locales.find((l) => l.attributes.locale === wanted);
  check(locale, 'Configured ASC screenshot locale missing');
  const sets = await apple.list(`appStoreVersionLocalizations/${locale.id}/appScreenshotSets`);
  const preference = ['APP_IPHONE_69', 'APP_IPHONE_67', 'APP_IPHONE_65', 'APP_IPHONE_61', 'APP_IPHONE_58', 'APP_IPHONE_55'];
  const set = preference.map((type) => sets.find((s) => s.attributes.screenshotDisplayType === type)).find(Boolean);
  check(set, 'No iPhone screenshot set');
  const shots = await apple.list(`appScreenshotSets/${set.id}/appScreenshots`);
  check(shots.length > 0, 'Empty ASC screenshot set');
  const files = [];
  for (const shot of shots) {
    const asset = shot.attributes.imageAsset;
    check(shot.attributes.assetDeliveryState?.state === 'COMPLETE' && asset, 'Screenshot not processed');
    const url = asset.templateUrl.replace('{w}', asset.width).replace('{h}', asset.height).replace('{f}', 'png');
    const bytes = await download(url, ['is1-ssl.mzstatic.com', 'is2-ssl.mzstatic.com', 'is3-ssl.mzstatic.com', 'is4-ssl.mzstatic.com', 'is5-ssl.mzstatic.com'], 30_000_000);
    check(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'Screenshot is not a PNG');
    files.push({ path: `public/ios/media/${sha256(bytes)}.png`, bytes, immutable: true });
  }
  return files;
}
export async function hostApple(ledger) {
  const state = ledger.state;
  if (!state.adpId || !state.appleVersionId || state.steps.assetsHosted) return;
  if (state.inventory) {
    state.steps.assetsHosted = await verifyHosted(state.inventory); await ledger.save(); return;
  }
  const data = await request(`https://api.altstore.io/adps/${uuid(state.adpId)}`, { hosts: ['api.altstore.io'] }).catch((e) => { if (e.status === 404) return null; throw e; });
  if (!data) {
    if (await ledger.intent('altstore-process')) await request('https://api.altstore.io/adps', { hosts: ['api.altstore.io'], method: 'POST', body: { adpID: state.adpId } });
    check(Date.now() - Date.parse(state.intents['altstore-process']) < 86_400_000, 'AltStore package missing after one day; verify marketplace notification setup');
    return;
  }
  if (data.status !== 'success') { check(data.status !== 'failure', 'AltStore package processing failed'); return; }
  check(!data.downloadExpired && data.downloadURL, 'AltStore download expired; refresh package before retry');
  await temporary(async (dir) => {
    const archive = path.join(dir, 'adp.zip');
    writeFileSync(archive, await download(data.downloadURL, artifactHosts()), { mode: 0o600 });
    const destination = path.join(dir, 'package');
    const inventory = JSON.parse(command('python3', [fileURLToPath(new URL('./archive.py', import.meta.url)), archive, destination]));
    const manifest = JSON.parse(readFileSync(path.join(destination, 'manifest.json')));
    validateManifest(manifest, state);
    const files = inventory.map((file) => ({ path: `public/ios/releases/${state.adpId}/${file.path}`, bytes: readFileSync(path.join(destination, file.path)), immutable: true }));
    const media = await mediaFiles(state, new Apple()); files.push(...media);
    state.screenshots = media.map((file) => `${config.website}/${file.path.slice(7)}`);
    // Inventory is outside the signed Apple package. Never pretty-print manifest.json.
    state.inventory = files.map((file) => ({ path: file.path.slice(7), size: file.bytes.length, sha256: sha256(file.bytes) }));
    state.adp = { minOSVersion: manifest.minimumSystemVersions.ios, size: inventory.reduce((n, f) => n + f.size, 0), url: `${config.website}/ios/releases/${state.adpId}/` };
    files.push({ path: `public/releases/${state.version}-ios.json`, bytes: Buffer.from(JSON.stringify(state.inventory, null, 2) + '\n'), immutable: true });
    files.push({ path: 'src/releaseMedia.json', bytes: Buffer.from(JSON.stringify({ version: state.version, primary: state.screenshots.map((url) => new URL(url).pathname) }, null, 2) + '\n') });
    const site = new GitHub(required('WEBSITE_TOKEN'), config.websiteRepository);
    await commitFiles(site, files, `chore: publish Sovran ${state.version} iOS assets`);
    await ledger.save(); // On lost acknowledgement, immutable identical bytes are reused.
    state.steps.assetsHosted = await verifyHosted(state.inventory); await ledger.save();
  });
}
