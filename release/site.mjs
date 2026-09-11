import { config, check, GitHub, required, compareVersion, download, sha256 } from './core.mjs';
import { commitFiles, verifyHosted } from './hosting.mjs';

export function mergeChannels(current, incoming) {
  check(current.schemaVersion === 1 && current.channels, 'Website release contract missing');
  const next = structuredClone(current);
  for (const name of ['appStore', 'freedomStore', 'googlePlay', 'githubApk', 'zapstore']) {
    const value = incoming[name]; if (!value) continue;
    const old = current.channels[name];
    if (old?.version && compareVersion(old.version, value.version) > 0) continue;
    if (old?.version === value.version) {
      check(old.build === value.build && (!old.sha256 || old.sha256 === value.sha256), 'Conflicting published channel record');
    }
    next.channels[name] = value;
  }
  return next;
}
export async function publishVersionArtwork(ledger, site) {
  const state = ledger.state;
  if (state.steps.artworkHosted) return true;
  if (!state.artworkInventory) {
    const source = await ledger.gh.file('app/assets/brand/generated/manifest.json', state.sourceSha);
    check(source, 'Release artwork manifest missing');
    const manifest = JSON.parse(source.bytes);
    check(manifest.schema === 1 && manifest.productVersion === state.version, 'Artwork version does not match the released source');
    const themes = ['black-on-light', 'white-on-dark', 'black-on-transparent', 'white-on-transparent'];
    const files = [];
    for (const theme of themes) {
      const matches = manifest.variants.filter((v) => v.layout === 'version-lockup' && v.theme === theme);
      check(matches.length === 1 && matches[0].version === state.version, 'Version artwork colorway missing or ambiguous');
      const variant = matches[0];
      const base = `generated/version-lockup/${theme}`;
      check(variant.svg === `${base}/artwork.svg` && variant.pngs.length === 8, 'Unexpected version artwork paths');
      const assets = [{ file: variant.svg }];
      for (const size of [16, 32, 64, 128, 256, 512, 1024, 2048]) {
        const png = variant.pngs.find((p) => p.width === size && p.height === size);
        check(png?.file === `${base}/${size}x${size}.png` && /^[a-f\d]{64}$/.test(png.sha256), 'Version artwork resolution missing');
        assets.push(png);
      }
      for (const asset of assets) {
        const file = await ledger.gh.file(`app/assets/brand/${asset.file}`, state.sourceSha);
        check(file && (!asset.sha256 || sha256(file.bytes) === asset.sha256), 'Release artwork hash mismatch');
        files.push({ path: `public/releases/${state.version}/artwork/${asset.file.slice('generated/version-lockup/'.length)}`, bytes: file.bytes, immutable: true });
      }
    }
    const inventory = files.map((file) => ({ path: file.path.slice(7), size: file.bytes.length, sha256: sha256(file.bytes) }));
    files.push({ path: `public/releases/${state.version}/artwork/manifest.json`, bytes: Buffer.from(JSON.stringify({ version: state.version, sourceSha: state.sourceSha, files: inventory }, null, 2) + '\n'), immutable: true });
    await commitFiles(site, files, `chore: publish Sovran ${state.version} artwork`);
    state.artworkInventory = files.map((file) => ({ path: file.path.slice(7), size: file.bytes.length, sha256: sha256(file.bytes) }));
    await ledger.save();
  }
  state.steps.artworkHosted = await verifyHosted(state.artworkInventory);
  await ledger.save();
  return state.steps.artworkHosted;
}

export async function websiteRelease(ledger) {
  const state = ledger.state;
  const site = new GitHub(required('WEBSITE_TOKEN'), config.websiteRepository);
  if (!Object.values(state.channels).some((channel) => channel?.version === state.version)) return;
  const artworkReady = await publishVersionArtwork(ledger, site);
  const previous = await site.file('public/releases/channels.json');
  check(previous, 'Deploy website release contract before enabling the app workflow');
  const next = mergeChannels(JSON.parse(previous.bytes), state.channels);
  const bytes = Buffer.from(JSON.stringify(next, null, 2) + '\n');
  await commitFiles(site, [{ path: 'public/releases/channels.json', bytes, expectedSha: previous.sha }], `chore: update confirmed Sovran store availability`);
  const publicBytes = await download(`${config.website}/releases/channels.json`, ['sovran.money'], 100_000);
  if (sha256(publicBytes) !== sha256(bytes)) return; // Website deploy still pending.
  const names = ['appStore', 'freedomStore', 'googlePlay', 'githubApk', 'zapstore'];
  state.complete = artworkReady && names.every((name) => state.channels[name]?.version === state.version);
  await ledger.save();
}
