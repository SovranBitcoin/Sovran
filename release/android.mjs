import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { config, check, request, required, fingerprint, sha256, command, temporary, published, download, artifactHosts } from './core.mjs';
import { expoBuild, validateBuild } from './build.mjs';

const play = (route, options = {}) => request(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${config.bundleId}/${route}`, { hosts: ['androidpublisher.googleapis.com'], token: required('GOOGLE_ACCESS_TOKEN'), ...options });
export function selectUniversal(response, expected) {
  const groups = response.generatedApks ?? [];
  const matches = groups.filter((g) => fingerprint(g.certificateSha256Hash) === fingerprint(expected));
  check(matches.length === 1 && matches[0].generatedUniversalApk?.downloadId, 'No universal APK signed with expected Play certificate');
  return matches[0].generatedUniversalApk.downloadId;
}
export function verifyApk(bytes, state) {
  return temporary(async (dir) => {
    const file = path.join(dir, 'sovran.apk'); writeFileSync(file, bytes, { mode: 0o600 });
    const tools = path.join(required('ANDROID_HOME'), 'build-tools', config.androidBuildTools);
    const certs = command(path.join(tools, 'apksigner'), ['verify', '--verbose', '--print-certs', file]);
    const hashes = [...certs.matchAll(/^Signer #\d+ certificate SHA-256 digest: ([a-f\d]+)$/gmi)].map((m) => fingerprint(m[1]));
    check(hashes.length === 1 && hashes[0] === fingerprint(required('ANDROID_CERT_SHA256')), 'APK signing certificate mismatch');
    const badging = command(path.join(tools, 'aapt'), ['dump', 'badging', file]);
    const app = badging.match(/^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'/m);
    check(app && app[1] === config.bundleId && app[2] === state.builds.android.number && app[3] === state.version, 'APK package/version mismatch');
    check(!/^application-debuggable/m.test(badging), 'Debuggable APK rejected');
    return { sha256: sha256(bytes), certificateSha256: hashes[0], size: bytes.length };
  });
}
export async function generatedApk(state) {
  const response = await play(`generatedApks/${state.builds.android.number}`);
  const id = selectUniversal(response, required('ANDROID_CERT_SHA256'));
  const bytes = await play(`generatedApks/${state.builds.android.number}/downloads/${encodeURIComponent(id)}:download?alt=media`, { type: 'application/octet-stream', limit: 1_000_000_000 });
  const evidence = await verifyApk(bytes, state);
  if (state.apk) check(state.apk.sha256 === evidence.sha256 && state.apk.certificateSha256 === evidence.certificateSha256, 'Generated APK changed for an existing release');
  return { bytes, evidence };
}

export async function androidRelease(ledger) {
  const state = ledger.state;
  if (!state.builds.android?.ready) return;
  if (state.apk && state.channels.googlePlay?.version === state.version) return;
  const number = state.builds.android.number;
  // An empty 2xx body decodes to null; treat it as a track with no releases.
  let summaries = (await play('tracks/production/releases'))?.releases ?? [];
  let summary = summaries.find((r) => r.activeArtifacts?.some((a) => String(a.versionCode) === number));
  let aab;
  if (!state.aabSha256) {
    const build = await expoBuild(state.builds.android.id); validateBuild(build, state, 'android');
    aab = await download(build.artifacts.applicationArchiveUrl, artifactHosts());
    state.aabSha256 = sha256(aab); await ledger.save();
  }
  if (state.playEdit) {
    try { await play(`edits/${encodeURIComponent(state.playEdit)}`); }
    catch (error) {
      if (![404, 409].includes(error.status)) throw error;
      check(summary || !state.intents['play-commit'], 'Play commit acknowledgement ambiguous; inspect Play before clearing edit');
      delete state.playEdit; await ledger.save();
    }
  }
  if (!state.playEdit) { state.playEdit = (await play('edits', { method: 'POST', body: {} })).id; await ledger.save(); }
  const edit = encodeURIComponent(state.playEdit);
  const bundles = (await play(`edits/${edit}/bundles`)).bundles ?? [];
  const existing = bundles.find((b) => String(b.versionCode) === number);
  if (existing) check(existing.sha256 === state.aabSha256, 'Existing Play AAB differs from release build');
  if (summary || state.steps.playSubmitted) check(existing, 'Published Play version has no matching release AAB');
  if (!summary && !state.steps.playSubmitted) {
    // Persist edit ID immediately. Resume the same edit after interrupted uploads.
    if (!existing) {
      if (!aab) {
        const build = await expoBuild(state.builds.android.id); validateBuild(build, state, 'android');
        aab = await download(build.artifacts.applicationArchiveUrl, artifactHosts());
      }
      const bytes = aab;
      check(sha256(bytes) === state.aabSha256, 'EAS AAB changed since release checkpoint');
      const response = await request(`https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${config.bundleId}/edits/${edit}/bundles?uploadType=media`, { hosts: ['androidpublisher.googleapis.com'], token: required('GOOGLE_ACCESS_TOKEN'), method: 'POST', bytes, type: 'application/octet-stream', limit: 1_000_000 });
      const bundle = JSON.parse(response);
      check(String(bundle.versionCode) === number && bundle.sha256 === sha256(bytes), 'Play AAB identity/hash mismatch');
    }
    const track = await play(`edits/${edit}/tracks/production`);
    check(!(track.releases ?? []).some((r) => r.status === 'inProgress' || r.status === 'halted'), 'Existing staged rollout requires attention');
    check(!(track.releases ?? []).some((r) => (r.versionCodes ?? []).some((n) => BigInt(n) > BigInt(number))), 'Play track already contains a newer version');
    const own = track.releases?.find((r) => r.versionCodes?.includes(number));
    if (own) check(state.intents['play-track'] && track.releases.length === 1 && own.status === 'completed' && own.name === state.version && own.versionCodes.length === 1, 'Existing Play release differs from the prepared track');
    else {
      await ledger.intent('play-track');
      await play(`edits/${edit}/tracks/production`, { method: 'PUT', body: { track: 'production', releases: [{ name: state.version, versionCodes: [number], status: 'completed', releaseNotes: [{ language: config.locale, text: `Sovran ${state.version}. Improvements and fixes.` }] }] } });
    }
    await play(`edits/${edit}:validate`, { method: 'POST' });
    // On lost acknowledgement, production summary above recovers committed state.
    await ledger.intent('play-commit');
    await play(`edits/${edit}:commit?changesNotSentForReview=false`, { method: 'POST' });
    state.steps.playSubmitted = true; delete state.playEdit; await ledger.save();
    summaries = (await play('tracks/production/releases')).releases ?? [];
    summary = summaries.find((r) => r.activeArtifacts?.some((a) => String(a.versionCode) === number));
  }
  if (summary) {
    state.steps.playSubmitted = true;
    check(summary.releaseLifecycleState !== 'RELEASE_LIFECYCLE_STATE_NOT_APPROVED', 'Google Play review rejected');
    check(!['RELEASE_LIFECYCLE_STATE_APPROVED_NOT_PUBLISHED', 'RELEASE_LIFECYCLE_STATE_NOT_SENT_FOR_REVIEW'].includes(summary.releaseLifecycleState), 'Google Play needs console action; disable managed publishing for automatic releases');
    if (summary.releaseLifecycleState === 'RELEASE_LIFECYCLE_STATE_PUBLISHED') {
      const inspection = state.playEdit ?? (await play('edits', { method: 'POST', body: {} })).id;
      const track = await play(`edits/${encodeURIComponent(inspection)}/tracks/production`);
      await play(`edits/${encodeURIComponent(inspection)}`, { method: 'DELETE' });
      delete state.playEdit;
      check(track.releases?.some((r) => r.status === 'completed' && r.versionCodes?.includes(number)), 'Play release is not fully rolled out');
      state.channels.googlePlay = published(state, 'googlePlay', number, `https://play.google.com/store/apps/details?id=${config.bundleId}`);
    }
    await ledger.save();
  }
  // Play may still be generating the universal APK after the edit was committed.
  try { const apk = await generatedApk(state); state.apk = apk.evidence; await ledger.save(); }
  catch (error) { if (error.status !== 404) throw error; }
}
