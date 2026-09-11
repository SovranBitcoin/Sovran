import { config, check, GitHub, request, required, published, compareVersion } from './core.mjs';
import { verifyHosted } from './hosting.mjs';

export function updateSource(source, state) {
  const result = structuredClone(source);
  const matches = result.apps.filter((app) => app.bundleIdentifier === config.bundleId);
  check(matches.length === 1 && String(matches[0].marketplaceID) === config.appleAppId, 'Freedom app identity missing or duplicated');
  const app = matches[0];
  const existing = app.versions.find((v) => v.version === state.version && String(v.buildVersion) === state.builds.ios.number);
  if (existing) check(existing.downloadURL === state.adp.url, 'Same Freedom version/build points to another package');
  else {
    check(!app.versions.some((v) => v.downloadURL === state.adp.url), 'ADP reused for a different release');
    check(!app.versions.some((v) => compareVersion(v.version, state.version) > 0), 'Freedom already has a newer release');
    app.versions.unshift({ version: state.version, buildVersion: state.builds.ios.number, date: state.createdAt, downloadURL: state.adp.url, size: state.adp.size, minOSVersion: state.adp.minOSVersion, localizedDescription: `Sovran ${state.version}. Improvements and fixes.` });
  }
  app.screenshots = state.screenshots;
  return result;
}

export async function freedomRelease(ledger) {
  const state = ledger.state;
  if (!state.steps.assetsHosted || state.channels.freedomStore?.version === state.version) return;
  const forkName = required('FREEDOM_FORK');
  check(/^[A-Za-z\d-]+\/freedomstore$/.test(forkName) && forkName !== config.freedomRepository, 'FREEDOM_FORK must identify the dedicated bot fork');
  const upstream = new GitHub(required('FREEDOM_TOKEN'), config.freedomRepository);
  const fork = new GitHub(required('FREEDOM_TOKEN'), forkName);
  const live = await request(config.freedomSource, { hosts: ['source.freedomstore.io'] });
  const liveApp = live.apps?.find((a) => a.bundleIdentifier === config.bundleId && String(a.marketplaceID) === config.appleAppId);
  const liveVersion = liveApp?.versions?.find((v) => v.version === state.version && String(v.buildVersion) === state.builds.ios.number);
  if (liveVersion) {
    check(liveVersion.downloadURL === state.adp.url, 'Live Freedom release has a different ADP');
    if (await verifyHosted(state.inventory)) { state.channels.freedomStore = published(state, 'freedomStore', state.builds.ios.number, 'https://freedomstore.io'); await ledger.save(); }
    return;
  }
  const branch = `sovran-release-${state.version}-${state.builds.ios.number}`;
  const prs = await upstream.pages(`pulls?state=all&head=${encodeURIComponent(`${forkName.split('/')[0]}:${branch}`)}`);
  check(prs.length <= 1, 'Duplicate Freedom PRs require reconciliation');
  const pr = prs[0];
  if (pr?.merged_at) return; // The live catalog check above confirms deployment.
  check(!pr || pr.state === 'open', 'Freedom PR was closed without merge; will not reopen or create another');
  // Read all open PRs once. Never add a new Sovran PR beside one already pending,
  // including a manually submitted one or a release from the previous tooling.
  if (!pr) {
    const open = await upstream.pages('pulls?state=open');
    check(!open.some((p) => /sovran/i.test(p.title)), 'Another Sovran Freedom PR is open; reconcile it first');
    for (const candidate of open) {
      const files = await upstream.pages(`pulls/${candidate.number}/files`);
      if (!files.some((file) => file.filename === 'altstore-source.json')) continue;
      const baseFile = await upstream.file('altstore-source.json', candidate.base.sha);
      const headRepo = candidate.head.repo?.full_name;
      check(headRepo && /^[A-Za-z\d_.-]+\/[A-Za-z\d_.-]+$/.test(headRepo), 'Cannot inspect open Freedom PR');
      const headFile = await new GitHub(required('FREEDOM_TOKEN'), headRepo).file('altstore-source.json', candidate.head.sha);
      check(baseFile && headFile, 'Cannot inspect open Freedom PR source');
      const sovran = (file) => JSON.parse(file.bytes).apps.find((a) => a.bundleIdentifier === config.bundleId);
      check(JSON.stringify(sovran(baseFile)) === JSON.stringify(sovran(headFile)), 'Another Freedom PR changes Sovran; no duplicate PR will be created');
    }
  }
  if (!(await verifyHosted(state.inventory))) return;
  const upstreamHead = (await upstream.api('git/ref/heads/main')).object.sha;
  const base = await upstream.file('altstore-source.json', upstreamHead);
  const upstreamApp = JSON.parse(base.bytes).apps.find((a) => a.bundleIdentifier === config.bundleId);
  if (upstreamApp?.versions.some((v) => v.version === state.version && String(v.buildVersion) === state.builds.ios.number)) {
    // A manual PR already merged; wait for the public source deployment.
    check(upstreamApp.versions.find((v) => v.version === state.version && String(v.buildVersion) === state.builds.ios.number).downloadURL === state.adp.url, 'Merged Freedom release has a different ADP');
    return;
  }
  const bytes = Buffer.from(JSON.stringify(updateSource(JSON.parse(base.bytes), state), null, 2) + '\n');
  let ref = await fork.optional(`git/ref/heads/${branch}`);
  if (!ref) {
    await fork.api('git/refs', { method: 'POST', body: { ref: `refs/heads/${branch}`, sha: upstreamHead } });
    ref = { object: { sha: upstreamHead } };
  }
  const current = await fork.file('altstore-source.json', branch);
  if (!current.bytes.equals(bytes)) {
    const parent = await upstream.api(`git/commits/${upstreamHead}`);
    const tree = await fork.api('git/trees', { method: 'POST', body: { base_tree: parent.tree.sha, tree: [{ path: 'altstore-source.json', mode: '100644', type: 'blob', content: bytes.toString() }] } });
    const parents = [...new Set([ref.object.sha, upstreamHead])];
    const commit = await fork.api('git/commits', { method: 'POST', body: { message: `chore: release Sovran ${state.version}`, tree: tree.sha, parents } });
    await fork.api(`git/refs/heads/${branch}`, { method: 'PATCH', body: { sha: commit.sha, force: false } });
  }
  if (pr) { state.freedomPr = pr.number; await ledger.save(); return; }
  // After ambiguous POST failure, the next invocation looks up the same head.
  // Never emit duplicate comments, close/reopen PRs, or merge upstream ourselves.
  const created = await upstream.api('pulls', { method: 'POST', body: { title: `Sovran release ${state.version} (${state.builds.ios.number})`, head: `${forkName.split('/')[0]}:${branch}`, base: 'main', maintainer_can_modify: true, body: `Publish Sovran ${state.version}, build ${state.builds.ios.number}.\n\nPackage identity and every hosted file were checked against the downloaded Apple package. Original package bytes and previous releases are preserved.\n\nADP: ${state.adpId}\nSource: https://github.com/${config.repository}/commit/${state.sourceSha}\n\n<!-- sovran-release:${state.version}:${state.builds.ios.number} -->` } });
  state.freedomPr = created.number; await ledger.save();
}
