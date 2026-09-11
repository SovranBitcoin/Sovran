import { config, check, compareVersion, Ledger, output, required, fingerprint, artifactHosts, command } from './core.mjs';

export async function prepare(gh) {
  check(process.env.GITHUB_REPOSITORY === config.repository && process.env.GITHUB_REF === 'refs/heads/main', 'Releases require the owned main branch');
  const head = await gh.api('git/ref/heads/main');
  const sourceSha = head.object.sha;
  const app = JSON.parse((await gh.file('app/app.json', sourceSha)).bytes).expo;
  const ledger = new Ledger(gh); let state = await ledger.load();
  const mode = process.env.RELEASE_MODE ?? 'plan';
  output('controller_sha', command('git', ['rev-parse', 'HEAD']).trim());
  check(['plan', 'release'].includes(mode), 'Invalid release mode');
  console.log(`Release plan: ${app.version}; active: ${state?.version ?? 'none'}`);
  if (mode === 'plan') { output('active', 'false'); return; }
  check(process.env.RELEASE_ENABLED === 'true', 'Set RELEASE_ENABLED only after operator validation');
  if (state && !state.complete) {
    // A newer main commit must not silently replace an in-flight release.
    output('sha', state.sourceSha); output('active', 'true'); return;
  }
  if (compareVersion(app.version, state?.version ?? config.baselineVersion) <= 0) { output('active', 'false'); return; }
  fingerprint(required('ANDROID_CERT_SHA256'));
  artifactHosts();
  required('FREEDOM_FORK'); required('ZAPSTORE_NPUB');
  check(app.ios.bundleIdentifier === config.bundleId && app.android.package === config.bundleId, 'App identity changed');
  const release = await gh.optional(`releases/tags/v${app.version}`);
  check(!release, 'Version already has a GitHub release; reconcile it before starting');
  // State branch never contains credentials or executable code.
  if (!(await gh.optional(`git/ref/heads/${config.stateBranch}`))) {
    const tree = await gh.api('git/trees', { method: 'POST', body: { tree: [{ path: 'README.md', mode: '100644', type: 'blob', content: 'Release checkpoints. Managed by the production release workflow.\n' }] } });
    const commit = await gh.api('git/commits', { method: 'POST', body: { message: 'chore: initialize release state', tree: tree.sha, parents: [] } });
    await gh.api('git/refs', { method: 'POST', body: { ref: `refs/heads/${config.stateBranch}`, sha: commit.sha } });
  }
  if (state) {
    const file = `history/${state.version}.json`, bytes = Buffer.from(JSON.stringify(state, null, 2));
    const old = await gh.file(file, config.stateBranch);
    if (old) check(old.bytes.equals(bytes), 'Archived release differs from completed state');
    else await gh.put(file, bytes, config.stateBranch, undefined, `chore: archive release ${state.version}`);
  }
  ledger.state = { schema: 1, version: app.version, sourceSha, createdAt: new Date().toISOString(), intents: {}, builds: {}, channels: state?.channels ?? {}, steps: {} };
  await ledger.save();
  output('sha', sourceSha); output('active', 'true');
}
