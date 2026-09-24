import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
import { config, check, required, sha256, command, temporary, download, GitHub, ReleaseError, compareVersion } from './core.mjs';
import { verifyApk } from './android.mjs';

// Read-only cross-channel audit of the published Android artifact. It needs no
// credential: the release state branch, the GitHub asset, the Zapstore relay and
// its CDN are all public. It answers one question — can an install from any
// Android channel update from any other? — which holds only while every channel
// serves the same bytes under the same signing certificate, because Android
// refuses an update whose signer differs from the installed one.

const RELAY = 'wss://relay.zapstore.dev';
const APK_HOSTS = ['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'];
const BLOB_HOSTS = ['cdn.zapstore.dev', 'blossom.zapstore.dev', 'zsapk.b-cdn.net', ...APK_HOSTS];
// Play's own APK generation signs with the app signing key and stamps the result.
// An APK built anywhere else — an EAS artifact signed with the upload key — has
// no stamp, so its absence means a channel stopped serving Play's artifact.
const PLAY_SOURCE_STAMP = '3257d599a49d2c961a471ca9843f59d341a405884583fc087df4237b733bbd6d';
// Blocks in the APK Signing Block. v3.2 carries Play's hybrid post-quantum
// signature; whichever block a device verifies, every channel hands it the same
// file, so the choice cannot strand an install.
const SIGNING_BLOCKS = { 0x7109871a: 'v2', 0xf05368c0: 'v3', 0x1b93ad61: 'v3.1', 0x70e1c89f: 'v3.2 hybrid', 0x6dff800d: 'source stamp', 0x42726577: 'padding' };

export function crossChannel(state) {
  const { googlePlay: play, githubApk: apk, zapstore: zap } = state.channels ?? {};
  check(play && apk && zap, 'An Android channel has not confirmed this version');
  const versionCode = state.builds.android.number;
  check([play, apk, zap].every((c) => c.version === state.version && c.build === versionCode && c.sourceSha === state.sourceSha), 'Android channels disagree on version, build or source');
  check(apk.sha256 === zap.sha256 && apk.certificateSha256 === zap.certificateSha256 && apk.size === zap.size, 'GitHub and Zapstore serve different APKs');
  return { version: state.version, versionCode, sha256: apk.sha256, certificateSha256: apk.certificateSha256, size: apk.size, url: apk.url };
}

// One certificate for the life of the package. A second signing identity in any
// release strands every install made from the other one: Android offers no path
// between signers, so those users would have to uninstall to move channel.
export function certificateContinuity(releases) {
  const published = releases.filter((release) => release.certificateSha256).sort((a, b) => compareVersion(a.version, b.version));
  check(published.length > 0, 'No published Android release to verify');
  const certificate = published[0].certificateSha256;
  for (const [index, release] of published.entries()) {
    check(release.certificateSha256 === certificate, `Release ${release.version} introduces a second signing certificate`);
    if (index) check(BigInt(release.versionCode) > BigInt(published[index - 1].versionCode), `Release ${release.version} does not raise the version code`);
  }
  return { certificate, releases: published.map((release) => `${release.version} (${release.versionCode})`) };
}

// The relay's own record must name the same bytes, certificate and version code.
// Zapstore installs what these events describe, not what the ledger remembers.
export function zapstoreEvidence({ app, release, asset }, expected) {
  const tag = (event, name) => { const values = event.tags.filter((t) => t[0] === name); check(values.length <= 1, 'Duplicate Zapstore scalar tag'); return values[0]?.[1]; };
  check(app && release && asset, 'Zapstore is missing an application, release or asset event');
  check(tag(app, 'd') === config.bundleId && tag(release, 'i') === config.bundleId && tag(asset, 'i') === config.bundleId, 'Zapstore events name another package');
  check(tag(release, 'd') === `${config.bundleId}@${expected.version}` && tag(release, 'version') === expected.version && tag(release, 'c') === 'main', 'Zapstore release identity mismatch');
  check(tag(release, 'e') === asset.id, 'Zapstore release does not reference this asset');
  check(tag(asset, 'x') === expected.sha256 && tag(asset, 'size') === String(expected.size), 'Zapstore asset does not describe the published APK');
  check(tag(asset, 'apk_certificate_hash') === expected.certificateSha256 && tag(asset, 'version_code') === expected.versionCode, 'Zapstore asset certificate or version code mismatch');
  return { url: tag(asset, 'url'), commit: tag(asset, 'commit'), minPlatform: tag(asset, 'min_platform_version') };
}

// Every ID-value pair in the APK Signing Block, so a new signing scheme shows up
// here instead of passing unnoticed as an unknown apksigner attribute.
export function signingBlocks(bytes) {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && eocd < 0; i--) if (bytes.readUInt32LE(i) === 0x06054b50) eocd = i;
  check(eocd > 0, 'APK has no end of central directory');
  const directory = bytes.readUInt32LE(eocd + 16);
  check(bytes.subarray(directory - 16, directory).toString('latin1') === 'APK Sig Block 42', 'APK has no signing block');
  const size = Number(bytes.readBigUInt64LE(directory - 24));
  const found = [];
  for (let offset = directory - size; offset + 12 <= directory - 24; ) {
    const length = Number(bytes.readBigUInt64LE(offset));
    check(length > 4 && offset + 8 + length <= directory, 'Malformed signing block entry');
    const id = bytes.readUInt32LE(offset + 8);
    found.push(SIGNING_BLOCKS[id] ?? `unknown 0x${id.toString(16).padStart(8, '0')}`);
    offset += 8 + length;
  }
  return found;
}

async function signerReport(bytes) {
  return temporary(async (dir) => {
    const file = path.join(dir, 'sovran.apk'); writeFileSync(file, bytes, { mode: 0o600 });
    const tools = path.join(required('ANDROID_HOME'), 'build-tools', config.androidBuildTools);
    const output = command(path.join(tools, 'apksigner'), ['verify', '--verbose', '--print-certs', file]);
    const schemes = [...output.matchAll(/^Verified using (v[\d.]+) scheme[^:]*: (true|false)$/gm)].filter(([, , verified]) => verified === 'true').map(([, scheme]) => scheme);
    const stamp = output.match(/^Source Stamp Signer certificate SHA-256 digest: ([a-f\d]+)$/im)?.[1];
    check(stamp === PLAY_SOURCE_STAMP, 'Published APK carries no Google Play source stamp');
    return { schemes, signers: Number(output.match(/^Number of signers: (\d+)$/m)?.[1]), blocks: signingBlocks(bytes) };
  });
}

async function relayEvents(pubkey, version) {
  const { SimplePool, verifyEvent } = createRequire(new URL('../app/package.json', import.meta.url))('nostr-tools');
  const pool = new SimplePool();
  try {
    const relay = await pool.ensureRelay(RELAY, { connectionTimeout: 15_000 });
    // A read-only reader: the publisher's own query in publish.mjs gates a write
    // and stays separate from it on purpose.
    // One subscription at a time, and the relay's own close after end of stored
    // events is not a failure: only silence is.
    const query = (filter) => new Promise((resolve, reject) => {
      const events = []; let subscription, settled = false;
      const done = (result) => { if (settled) return; settled = true; clearTimeout(timer); subscription?.close(); result instanceof Error ? reject(result) : resolve(events); };
      const timer = setTimeout(() => done(new ReleaseError('Zapstore query did not reach end of stored events')), 30_000);
      subscription = relay.subscribe([{ authors: [pubkey], limit: 20, ...filter }], {
        eoseTimeout: 30_000,
        onevent: (event) => events.push(event),
        oneose: () => done(events),
        onclose: () => done(settled ? events : new ReleaseError('Zapstore query closed before completion')),
      });
    });
    const newest = (kind, filter) => query({ kinds: [kind], ...filter }).then((events) => events.sort((a, b) => b.created_at - a.created_at)[0]);
    const events = {
      app: await newest(32267, { '#d': [config.bundleId] }),
      release: await newest(30063, { '#d': [`${config.bundleId}@${version}`] }),
      asset: await newest(3063, { '#i': [config.bundleId], '#version': [version] }),
    };
    check(Object.values(events).every((event) => !event || (event.pubkey === pubkey && verifyEvent(event))), 'Zapstore relay returned an event this identity did not sign');
    return events;
  } finally { pool.destroy(); }
}

async function verifyDistribution({ npub = process.env.ZAPSTORE_NPUB, log = console.log } = {}) {
  const { nip19 } = createRequire(new URL('../app/package.json', import.meta.url))('nostr-tools');
  const gh = new GitHub(process.env.GH_TOKEN); // Public reads; a token only raises the rate limit.
  if (process.env.ANDROID_SDK_ROOT && !process.env.ANDROID_HOME) process.env.ANDROID_HOME = process.env.ANDROID_SDK_ROOT;
  const state = JSON.parse((await gh.file('active.json', config.stateBranch)).bytes);
  const expected = crossChannel(state);
  // The published fingerprint is the subject of the audit, not an input to it:
  // verifyApk then re-runs the release's own gate over the bytes the public serves.
  if (process.env.ANDROID_CERT_SHA256) check(process.env.ANDROID_CERT_SHA256.replaceAll(':', '').toLowerCase() === expected.certificateSha256, 'Configured certificate differs from the published release');
  else process.env.ANDROID_CERT_SHA256 = expected.certificateSha256;

  const files = await gh.api(`contents/history?ref=${config.stateBranch}`);
  const past = await Promise.all(files.filter((file) => file.name.endsWith('.json')).map(async (file) => JSON.parse((await gh.file(`history/${file.name}`, config.stateBranch)).bytes)));
  const continuity = certificateContinuity([...past, state].map((s) => ({ version: s.version, versionCode: s.builds?.android?.number, certificateSha256: s.channels?.githubApk?.certificateSha256 })));

  const bytes = await download(expected.url, APK_HOSTS);
  check(sha256(bytes) === expected.sha256, 'The published GitHub APK is not the release artifact');
  const evidence = await verifyApk(bytes, state);
  check(evidence.certificateSha256 === expected.certificateSha256 && evidence.size === expected.size, 'Published APK identity differs from the release ledger');
  const signing = await signerReport(bytes);

  check(/^npub1[\da-z]{58}$/.test(npub ?? ''), 'Set ZAPSTORE_NPUB to the release publishing identity');
  const decoded = nip19.decode(npub);
  check(decoded.type === 'npub', 'Set ZAPSTORE_NPUB to the release publishing identity');
  const zapstore = zapstoreEvidence(await relayEvents(decoded.data, state.version), expected);
  check(zapstore.commit === state.sourceSha, 'Zapstore asset names another source commit');
  check(sha256(await download(zapstore.url, BLOB_HOSTS)) === expected.sha256, 'The Zapstore blob is not the published APK');

  log(`Sovran ${expected.version}, version code ${expected.versionCode}, package ${config.bundleId}`);
  log(`  Signing certificate  ${expected.certificateSha256}`);
  log(`  APK SHA-256          ${expected.sha256} (${expected.size} bytes)`);
  log(`  Google Play          production; universal APK generated and signed by Play, source stamp present`);
  log(`  GitHub release       identical bytes at ${expected.url}`);
  log(`  Zapstore             identical bytes at ${zapstore.url}`);
  log(`  Verified schemes     ${signing.schemes.join(', ')}; ${signing.signers} classical signer`);
  log(`  Signing block        ${signing.blocks.join(', ')}`);
  log(`  Certificate history  ${continuity.releases.join(', ')} under ${continuity.certificate.slice(0, 16)}…`);
  log('One artifact, one certificate, one version code: an install from any Android channel updates from any other.');
  return { expected, continuity, zapstore, signing };
}

// Runs anywhere, including a maintainer's machine: nothing here can publish.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { await verifyDistribution(); }
  catch (error) { console.error(error instanceof ReleaseError ? error.message : `Verification could not complete: ${error?.message ?? 'unknown error'}`); process.exitCode = 1; }
}
