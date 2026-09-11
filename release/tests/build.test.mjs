import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from '../build.mjs';
import { config } from '../core.mjs';

const ids = { ios: '11111111-1111-1111-1111-111111111111', android: '22222222-2222-2222-2222-222222222222' };
async function scenario(options, run) {
  const source = mkdtempSync(path.join(tmpdir(), 'sovran-build-test-'));
  const legal = { publicationReady: true, operator: {}, terms: {}, privacy: {} };
  const legalDirectory = path.join(source, 'app/shared/lib/legal');
  mkdirSync(legalDirectory, { recursive: true });
  writeFileSync(path.join(legalDirectory, 'documents.json'), JSON.stringify(legal));
  const previous = { SOURCE_DIR: process.env.SOURCE_DIR, EXPO_TOKEN: process.env.EXPO_TOKEN };
  Object.assign(process.env, { SOURCE_DIR: source, EXPO_TOKEN: 'test-only-token' });
  const state = { version: '0.1.2', sourceSha: 'a'.repeat(40), builds: { ios: { id: ids.ios }, ...(options.androidExists ? { android: { id: ids.android } } : {}) }, steps: {}, intents: {} };
  const requests = [], checkpoints = [];
  const ledger = {
    state,
    save: async () => { checkpoints.push(structuredClone(state)); },
    intent: async (name) => {
      if (state.intents[name]) return false;
      state.intents[name] = 'recorded'; await ledger.save(); return true;
    },
  };
  const commands = mock.method(childProcess, 'execFileSync', (binary, args) => {
    if (binary === 'git' && args[0] === 'rev-parse') return state.sourceSha;
    if (binary === 'git' && args[0] === 'status') return '';
    if (binary === 'node' && args.join(' ') === 'scripts/brand-assets.mjs --check') return '';
    assert.equal(binary, 'eas'); requests.push(args);
    if (args[0] === 'build:list') return '[]';
    if (args[0] === 'build') {
      const platform = args[args.indexOf('--platform') + 1];
      assert.equal(platform, 'android');
      assert.equal(checkpoints.at(-1).intents['build-android'], 'recorded');
      return JSON.stringify([{ id: ids.android }]);
    }
    if (args[0] === 'submit' && options.submitFails) throw new Error('sensitive provider output must stay suppressed');
    throw new Error('Unexpected subprocess');
  });
  syncBuiltinESMExports();
  const network = mock.method(globalThis, 'fetch', async (url, init) => {
    if (url === 'https://sovran.money/legal/documents.json') return new Response(JSON.stringify(legal));
    assert.equal(url, 'https://api.expo.dev/graphql');
    const id = JSON.parse(init.body).variables.buildId;
    const platform = id === ids.ios ? 'ios' : 'android';
    const current = { id, app: { id: config.expoProjectId }, gitCommitHash: state.sourceSha, appIdentifier: config.bundleId, platform: platform.toUpperCase(), distribution: 'STORE', buildProfile: config.buildProfile, appVersion: state.version, appBuildVersion: platform === 'ios' ? '170' : '30', isGitWorkingTreeDirty: false, message: `release:${state.version}:${state.sourceSha}`, status: options[`${platform}Status`] ?? 'FINISHED', submissions: [] };
    return new Response(JSON.stringify({ data: { builds: { byId: current } } }));
  });
  try { await run({ ledger, requests, checkpoints }); }
  finally {
    commands.mock.restore(); syncBuiltinESMExports(); network.mock.restore();
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    rmSync(source, { recursive: true, force: true });
  }
}

test('a failed iOS build does not prevent an existing Android build becoming ready', () => scenario({ iosStatus: 'ERRORED', androidExists: true }, async ({ ledger, requests }) => {
  await assert.rejects(build(ledger), /EAS build failed/);
  assert.deepEqual(ledger.state.builds.android, { id: ids.android, number: '30', ready: true });
  assert.equal(requests.length, 0, 'do not replace a failed build');
}));

test('an ambiguous iOS submission still queues Android once and preserves submission intent', () => scenario({ submitFails: true }, async ({ ledger, requests }) => {
  await assert.rejects(build(ledger), /Command failed: eas/);
  assert.equal(ledger.state.builds.android.ready, true);
  assert.equal(ledger.state.intents['submit-ios'], 'recorded');
  await assert.rejects(build(ledger), /iOS submission acknowledgement missing/);
  assert.equal(requests.filter((args) => args[0] === 'submit').length, 1);
  assert.equal(requests.filter((args) => args[0] === 'build').length, 1);
}));

test('failures in both platforms are reported together without provider output', () => scenario({ iosStatus: 'ERRORED', androidStatus: 'CANCELED', androidExists: true }, async ({ ledger }) => {
  await assert.rejects(build(ledger), /iOS and Android build reconciliation failed/);
}));
