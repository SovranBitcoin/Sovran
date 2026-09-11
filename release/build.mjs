import path from 'node:path';
import { verifyLegalPublication } from './legal.mjs';
import { config, check, command, request, required, uuid, ReleaseError } from './core.mjs';

export async function expoBuild(id) {
  const response = await request('https://api.expo.dev/graphql', {
    hosts: ['api.expo.dev'], token: required('EXPO_TOKEN'), method: 'POST',
    body: { query: 'query ReleaseBuild($buildId: ID!) { builds { byId(buildId: $buildId) { id status platform distribution buildProfile appIdentifier appVersion appBuildVersion gitCommitHash isGitWorkingTreeDirty message app { id } artifacts { applicationArchiveUrl } submissions { id status platform } } } }', variables: { buildId: uuid(id) } },
  });
  check(!response.errors && response.data?.builds?.byId, 'EAS build lookup failed');
  return response.data.builds.byId;
}
export function validateBuild(build, state, platform) {
  const project = config.expoProjectId;
  check(build.app.id === project && build.gitCommitHash === state.sourceSha && build.appIdentifier === config.bundleId && build.platform === platform.toUpperCase() && build.distribution === 'STORE' && build.buildProfile === config.buildProfile && build.appVersion === state.version, 'EAS build does not match release identity');
  check(/^\d+$/.test(String(build.appBuildVersion)), 'Invalid native build number');
  check(build.isGitWorkingTreeDirty === false && build.message === `release:${state.version}:${state.sourceSha}`, 'Build was not created from the clean release request');
}
export async function build(ledger) {
  const state = ledger.state;
  const source = required('SOURCE_DIR');
  const cwd = path.join(source, 'app');
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, CI: '1', EXPO_NO_DOTENV: '1', EXPO_TOKEN: required('EXPO_TOKEN') };
  check(command('git', ['rev-parse', 'HEAD'], { cwd: source }).trim() === state.sourceSha, 'Checkout differs from release SHA');
  check(!command('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: source }).trim(), 'Release source changed during installation');
  // Rebuild in memory and compare committed vector/PNG outputs, including the
  // version read from this exact source checkout. Never dirty the release SHA.
  command('node', ['scripts/brand-assets.mjs', '--check'], { cwd: source, env });
  await verifyLegalPublication(source);
  const failures = [];
  for (const platform of ['ios', 'android']) {
    try { await reconcilePlatform(ledger, platform, cwd, env); }
    catch (error) { failures.push(error); }
  }
  // Keep checkpoint writes sequential, but do not let one provider/platform
  // failure prevent the other build from being queued or reconciled.
  if (failures.length === 1) throw failures[0];
  if (failures.length) throw new ReleaseError('iOS and Android build reconciliation failed; inspect EAS before retrying');
}

async function reconcilePlatform(ledger, platform, cwd, env) {
  const state = ledger.state;
  if (!state.builds[platform]) {
    const candidates = JSON.parse(command('eas', ['build:list', '--platform', platform, '--build-profile', config.buildProfile, '--git-commit-hash', state.sourceSha, '--app-version', state.version, '--limit', '50', '--json', '--non-interactive'], { cwd, env })).filter((candidate) => candidate.message === `release:${state.version}:${state.sourceSha}`);
    check(candidates.length <= 1, 'Ambiguous EAS builds; reconcile before continuing');
    let found = candidates[0];
    if (!found) {
      if (!(await ledger.intent(`build-${platform}`))) throw new Error('Build request acknowledgement missing; inspect EAS before retrying intent');
      const result = JSON.parse(command('eas', ['build', '--platform', platform, '--profile', config.buildProfile, '--message', `release:${state.version}:${state.sourceSha}`, '--non-interactive', '--no-wait', '--json'], { cwd, env }));
      check(Array.isArray(result) && result.length === 1, 'Unexpected EAS build response'); found = result[0];
    }
    state.builds[platform] = { id: uuid(found.id) }; await ledger.save();
  }
  const current = await expoBuild(state.builds[platform].id);
  validateBuild(current, state, platform);
  check(!['ERRORED', 'CANCELED', 'PENDING_CANCEL'].includes(current.status), 'EAS build failed; do not create a replacement automatically');
  state.builds[platform].number = String(current.appBuildVersion);
  state.builds[platform].ready = current.status === 'FINISHED';
  await ledger.save();
  if (platform === 'ios' && current.status === 'FINISHED') {
    check(current.submissions.length <= 1, 'Multiple iOS submissions require reconciliation');
    const submission = current.submissions[0];
    if (submission) {
      check(!['ERRORED', 'CANCELED'].includes(submission.status), 'EAS iOS submission failed');
      state.steps.iosUpload = submission.status === 'FINISHED'; await ledger.save();
    } else {
      check(await ledger.intent('submit-ios'), 'iOS submission acknowledgement missing; inspect EAS before retrying intent');
      command('eas', ['submit', '--platform', 'ios', '--profile', 'production', '--id', current.id, '--non-interactive', '--no-wait', '--no-auto-testflight-setup'], { cwd, env });
    }
  }
}
