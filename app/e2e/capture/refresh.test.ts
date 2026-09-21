import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createCapturePlan, ROOT } from './plan';
import { parseRefreshArgs, resumable, withDeadline } from './refresh';
import { loadE2E } from '../core/loader';
import { expandScenario } from '../core/plan';
import { DRIVER_CAPS } from '../schema';

test('refresh arguments keep capture and rendering side effects separate', () => {
  expect(parseRefreshArgs(['both', '--resume', '--attempts', '1']).resume).toBe(true);
  expect(parseRefreshArgs(['--render-only']).renderOnly).toBe(true);
  for (const args of [
    ['--attempts', '0'],
    ['--rebuild', 'adopt'],
    ['--render-only', '--resume'],
    ['--scenario'],
    ['fake'],
    ['--skip'],
    ['--skip', 'web/wallet'],
    ['--skip', '../etc'],
    ['--render-only', '--skip', 'store.screenshots'],
  ])
    expect(() => parseRefreshArgs(args)).toThrow();
  // A skipped leg names a platform/scenario pair or a whole scenario; the
  // campaign records it as skipped rather than quietly leaving a hole.
  expect(
    parseRefreshArgs(['both', '--skip', 'android/store.screenshots', '--skip', 'mint.add.cancel'])
      .skip
  ).toEqual(['android/store.screenshots', 'mint.add.cancel']);
});

test('a stuck capture step fails its attempt instead of wedging the campaign', async () => {
  // Reproduces the observed hang: the runner printed an attempt header and then
  // produced nothing, with no child process alive, for the rest of the run.
  const stuck = new Promise<string>(() => {});
  await expect(withDeadline('Native capture run', 30, stuck)).rejects.toThrow(/exceeded 0s/);
  expect(await withDeadline('Native artifact hash', 1000, Promise.resolve('ok'))).toBe('ok');
});

test('Android planning rejects unsupported permission cleanup before running', () => {
  const loaded = loadE2E(join(ROOT, 'app/e2e'));
  const scenario = loaded.scenarios.get('wallet.scan.camera-permission')!;
  const plan = expandScenario(scenario, loaded.fixtures, {
    capabilities: new Set(DRIVER_CAPS.android),
  });
  expect(plan.availability).toBe('deferred');
  expect(plan.requires).toContain('device.permission-reset');
});

test('resume requires matching recipe, source, binary fingerprint and retained bytes', () => {
  const invocation = createCapturePlan(['ios']).invocations[0];
  const directory = mkdtempSync(join(tmpdir(), 'capture-resume-'));
  try {
    mkdirSync(join(directory, 'ios'));
    writeFileSync(join(directory, 'ios/wallet.png'), 'test bytes');
    const session = {
      platform: invocation.platform,
      scenario: invocation.scenario,
      status: 'captured' as const,
      recipeSha256: invocation.recipeSha256,
      appFingerprint: 'app',
      nativeFingerprint: 'native',
      attempts: 1,
      runs: ['run-test'],
      captures: [
        { file: 'ios/wallet.png', sha256: createHash('sha256').update('test bytes').digest('hex') },
      ],
    };
    expect(
      resumable(session, invocation, {
        appFingerprint: 'app',
        nativeFingerprint: 'native',
        library: directory,
      })
    ).toBe(true);
    expect(
      resumable(session, invocation, {
        appFingerprint: 'changed',
        nativeFingerprint: 'native',
        library: directory,
      })
    ).toBe(false);
    expect(
      resumable(session, invocation, {
        appFingerprint: 'app',
        nativeFingerprint: 'changed',
        library: directory,
      })
    ).toBe(false);
    expect(
      resumable({ ...session, recipeSha256: 'changed' }, invocation, {
        appFingerprint: 'app',
        nativeFingerprint: 'native',
        library: directory,
      })
    ).toBe(false);
    expect(
      resumable({ ...session, status: 'failed' }, invocation, {
        appFingerprint: 'app',
        nativeFingerprint: 'native',
        library: directory,
      })
    ).toBe(false);
    writeFileSync(join(directory, 'ios/wallet.png'), 'altered bytes');
    expect(
      resumable(session, invocation, {
        appFingerprint: 'app',
        nativeFingerprint: 'native',
        library: directory,
      })
    ).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
