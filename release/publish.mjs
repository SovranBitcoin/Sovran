import { writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { config, check, request, required, sha256, command, temporary, published, download } from './core.mjs';
import { generatedApk, verifyApk } from './android.mjs';

export async function githubRelease(ledger) {
  const state = ledger.state, gh = ledger.gh;
  if (!state.apk || state.channels.githubApk?.version === state.version) return;
  const tag = `v${state.version}`;
  const ref = await gh.optional(`git/ref/tags/${tag}`);
  if (ref) check(ref.object.type === 'commit' && ref.object.sha === state.sourceSha, 'Existing tag does not point to release SHA');
  let release = await gh.optional(`releases/tags/${tag}`);
  if (!release) release = await gh.api('releases', { method: 'POST', body: { tag_name: tag, target_commitish: state.sourceSha, name: `Sovran ${state.version}`, draft: true, prerelease: false, body: `Sovran ${state.version}\n\nSource: ${state.sourceSha}\n\nStore availability is tracked separately at https://sovran.money/download.\n\nAPK SHA-256: ${state.apk.sha256}\nAndroid signing certificate SHA-256: ${state.apk.certificateSha256}` } });
  check(release.target_commitish === state.sourceSha && !release.prerelease, 'Existing GitHub release identity differs');
  const name = `sovran-${state.version}.apk`;
  const sums = Buffer.from(`${state.apk.sha256}  ${name}\n`);
  let assets = await gh.pages(`releases/${release.id}/assets`);
  check(assets.every((a) => [name, 'SHA256SUMS'].includes(a.name)), 'Unexpected GitHub release assets; refusing to publish them');
  for (const item of [{ name, digest: state.apk.sha256 }, { name: 'SHA256SUMS', digest: sha256(sums) }]) {
    const matches = assets.filter((a) => a.name === item.name);
    check(matches.length <= 1, 'Duplicate GitHub release assets');
    if (matches.length) { check(matches[0].state === 'uploaded' && matches[0].digest === `sha256:${item.digest}`, 'Existing GitHub asset hash differs or upload is incomplete'); continue; }
    check(release.draft, 'Published GitHub release is missing required asset');
    const bytes = item.name === name ? (await generatedApk(state)).bytes : sums;
    await request(`https://uploads.github.com/repos/${config.repository}/releases/${release.id}/assets?name=${encodeURIComponent(item.name)}`, { hosts: ['uploads.github.com'], token: gh.token, method: 'POST', bytes, type: 'application/octet-stream' });
  }
  assets = await gh.pages(`releases/${release.id}/assets`);
  check(assets.length === 2 && assets.find((a) => a.name === name)?.digest === `sha256:${state.apk.sha256}` && assets.find((a) => a.name === 'SHA256SUMS')?.digest === `sha256:${sha256(sums)}`, 'GitHub asset verification failed');
  if (release.draft) release = await gh.api(`releases/${release.id}`, { method: 'PATCH', body: { draft: false, make_latest: 'true' } });
  const finalRef = await gh.api(`git/ref/tags/${tag}`);
  check(finalRef.object.type === 'commit' && finalRef.object.sha === state.sourceSha, 'Published tag identity mismatch');
  const url = `https://github.com/${config.repository}/releases/download/${tag}/${name}`;
  const bytes = await download(url, ['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
  check(sha256(bytes) === state.apk.sha256, 'Public APK differs from verified artifact');
  state.channels.githubApk = published(state, 'githubApk', state.builds.android.number, url, state.apk); await ledger.save();
}

export async function zapstoreRelease(ledger) {
  const state = ledger.state;
  if (state.channels.githubApk?.version !== state.version || state.channels.zapstore?.version === state.version) return;
  // Reuse the app's frozen nostr-tools dependency; never implement signature
  // verification or NIP-19 decoding in this release tool.
  const { nip19, verifyEvent, SimplePool } = createRequire(new URL('../app/package.json', import.meta.url))('nostr-tools');
  const npub = required('ZAPSTORE_NPUB'), decoded = nip19.decode(npub);
  check(decoded.type === 'npub', 'Invalid Zapstore public identity');
  const pubkey = decoded.data;
  const pool = new SimplePool();
  const relays = ['wss://relay.zapstore.dev'];
  const tag = (event, name) => { const values = event.tags.filter((t) => t[0] === name); check(values.length <= 1, 'Duplicate Zapstore scalar tag'); return values[0]?.[1]; };
  const query = async (filter) => {
    const relay = await pool.ensureRelay(relays[0], { connectionTimeout: 10_000 });
    const events = await new Promise((resolve, reject) => {
      const result = []; let subscription;
      const timer = setTimeout(() => { reject(new Error('Zapstore query did not reach end of stored events')); subscription?.close(); }, 20_000);
      subscription = relay.subscribe([{ authors: [pubkey], limit: 100, ...filter }], {
        eoseTimeout: 60_000,
        onevent: (event) => { result.push(event); if (result.length >= 100) { clearTimeout(timer); reject(new Error('Zapstore query overflow')); subscription.close(); } },
        oneose: () => { clearTimeout(timer); resolve(result); subscription.close(); },
        onclose: () => { clearTimeout(timer); reject(new Error('Zapstore query closed before completion')); },
      });
    });
    check(events.length < 100 && events.every((event) => event.pubkey === pubkey && verifyEvent(event)), 'Zapstore relay returned invalid or excessive events');
    return events;
  };
  const readback = async () => {
    const releases = await query({ kinds: [30063], '#d': [`${config.bundleId}@${state.version}`] });
    const assets = await query({ kinds: [3063], '#i': [config.bundleId], '#version': [state.version] });
    check(assets.every((asset) => tag(asset, 'x') === state.apk.sha256 && tag(asset, 'apk_certificate_hash') === state.apk.certificateSha256 && tag(asset, 'version_code') === state.builds.android.number && tag(asset, 'size') === String(state.apk.size) && tag(asset, 'commit') === state.sourceSha), 'Zapstore version already refers to a different APK');
    const release = releases.sort((a, b) => b.created_at - a.created_at)[0];
    const asset = assets.find((a) => release?.tags.some((t) => t[0] === 'e' && t[1] === a.id));
    if (!asset) return false;
    check(tag(release, 'i') === config.bundleId && tag(release, 'version') === state.version && tag(release, 'c') === 'main' && tag(release, 'e') === asset.id, 'Zapstore release is not the exact production asset');
    const applications = await query({ kinds: [32267], '#d': [config.bundleId] });
    if (!applications.length) return false;
    const blobUrl = asset.tags.find((t) => t[0] === 'url')?.[1]; check(blobUrl, 'Zapstore APK URL missing');
    try {
      const blob = await download(blobUrl, ['cdn.zapstore.dev', 'blossom.zapstore.dev', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
      check(sha256(blob) === state.apk.sha256, 'Zapstore served APK hash mismatch');
    } catch (e) { if (e.status === 404) return false; throw e; }
    state.zapstoreEventId = release.id; return true;
  };
  // The signer is a dedicated release identity. A bunker must authorize these
  // events unattended; browser signers cannot work inside GitHub Actions.
  check(required('SIGN_WITH').startsWith('bunker://') || required('SIGN_WITH').startsWith('nsec1'), 'Unsupported CI Zapstore signer');
  try { await temporary(async (dir) => {
    const executable = path.join(dir, 'zsp');
    const binary = await download(`https://github.com/zapstore/zsp/releases/download/v${config.zsp.version}/zsp-${config.zsp.version}-linux-amd64`, ['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'], 100_000_000);
    check(sha256(binary) === config.zsp.sha256, 'Zapstore CLI checksum mismatch'); writeFileSync(executable, binary, { mode: 0o700 }); chmodSync(executable, 0o700);
    const bytes = await download(state.channels.githubApk.url, ['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
    check(sha256(bytes) === state.apk.sha256, 'GitHub APK changed'); await verifyApk(bytes, state);
    const apkPath = path.join(dir, 'sovran.apk'); writeFileSync(apkPath, bytes, { mode: 0o600 });
    const currentApps = await query({ kinds: [32267], '#d': [config.bundleId] });
    const currentApp = currentApps.sort((a, b) => b.created_at - a.created_at)[0];
    const settings = { repository: `https://github.com/${config.repository}`, release_source: apkPath, pubkey: npub, name: 'Sovran', summary: 'Bitcoin and Nostr wallet', description: 'Sovran is a Bitcoin and Nostr wallet.', website: config.website, metadata_sources: [] };
    if (currentApp) {
      settings.description = currentApp.content;
      for (const key of ['name', 'summary', 'license', 'icon']) { const value = tag(currentApp, key); if (value) settings[key] = value; }
      settings.images = currentApp.tags.filter((t) => t[0] === 'image').map((t) => t[1]);
      settings.tags = currentApp.tags.filter((t) => t[0] === 't').map((t) => t[1]);
      for (const url of [...settings.images, ...(settings.icon ? [settings.icon] : [])]) {
        const image = new URL(url); check(image.protocol === 'https:' && ['cdn.zapstore.dev', 'blossom.zapstore.dev', 'sovran.money'].includes(image.hostname) && !image.username && !image.password && !image.port, 'Existing Zapstore image host needs explicit review');
      }
    }
    const configPath = path.join(dir, 'zapstore.yaml'); writeFileSync(configPath, JSON.stringify(settings), { mode: 0o600 }); // JSON is valid YAML.
    if (required('SIGN_WITH').startsWith('bunker://')) {
      const bunker = new URL(required('SIGN_WITH'));
      check(/^[a-f\d]{64}$/.test(bunker.hostname), 'Invalid bunker public key');
      const client = required('ZAPSTORE_BUNKER_CLIENT_KEY'); check(/^[a-f\d]{64}$/.test(client), 'Bunker client key must be provisioned once as secret hex');
      const keys = path.join(dir, '.config', 'zsp', 'bunker-keys'); mkdirSync(keys, { recursive: true, mode: 0o700 });
      writeFileSync(path.join(keys, `${bunker.hostname}.key`), client, { mode: 0o600 });
    }
    const args = ['publish', configPath, '--quiet', '--json', '--skip-certificate-linking', '--skip-metadata', '--commit', state.sourceSha];
    const options = { cwd: dir, env: { PATH: process.env.PATH, HOME: dir, SIGN_WITH: required('SIGN_WITH') } };
    if (!(await readback())) {
      // Offline signing sends nothing to publishing relays. Verify the actual
      // signer and signed asset before granting the online publishing step.
      const preview = command(executable, [...args, '--offline'], options).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)).filter(Boolean);
      check(preview.length === 3 && preview.every((e) => [32267, 30063, 3063].includes(e.kind) && e.pubkey === pubkey && verifyEvent(e)), 'Zapstore signer does not match release identity');
      const asset = preview.find((e) => e.kind === 3063), release = preview.find((e) => e.kind === 30063), app = preview.find((e) => e.kind === 32267);
      check(asset && release && app && tag(asset, 'x') === state.apk.sha256 && tag(asset, 'i') === config.bundleId && tag(asset, 'version') === state.version && tag(asset, 'version_code') === state.builds.android.number && tag(asset, 'size') === String(state.apk.size) && tag(asset, 'apk_certificate_hash') === state.apk.certificateSha256 && tag(asset, 'commit') === state.sourceSha && tag(release, 'd') === `${config.bundleId}@${state.version}` && tag(release, 'c') === 'main' && tag(release, 'e') === asset.id && tag(app, 'd') === config.bundleId, 'Zapstore signed preview does not match APK');
      // A matching but partially published release can require replay because
      // zsp otherwise exits before retrying missing blobs. readback rejects any
      // different APK for this version before this bounded repair is allowed.
      const existing = await query({ kinds: [3063], '#i': [config.bundleId], '#version': [state.version] });
      command(executable, existing.length ? [...args, '--overwrite-release'] : args, options);
      check(await readback(), 'Zapstore publication not yet verified; retry to reconcile');
    }
    state.channels.zapstore = published(state, 'zapstore', state.builds.android.number, `https://zapstore.dev/apps/${config.bundleId}`, state.apk); await ledger.save();
  }); } finally { pool.destroy(); }
}
