import { describe, expect, test } from 'bun:test';

import { activeJob, buildRunArgv, killActiveJob, startRunJob } from './jobs';

const KNOWN = new Set(['onboarding.fresh', 'send.lightning.sat']);
const FUNDED = new Set(['send.lightning.sat']);

describe('buildRunArgv', () => {
  test('scenario trigger hosts in the full suite', () => {
    const built = buildRunArgv({ kind: 'scenario', scenarioId: 'onboarding.fresh' }, FUNDED, KNOWN);
    expect(built).toEqual({
      argv: [
        'bun',
        'e2e/cli.ts',
        'run',
        '--driver',
        'sim',
        '--i-approve-destructive-reset',
        '--suite',
        'full',
        '--scenario',
        'onboarding.fresh',
      ],
    });
  });

  test('unknown scenario is rejected', () => {
    expect(buildRunArgv({ kind: 'scenario', scenarioId: 'nope' }, FUNDED, KNOWN)).toEqual({
      error: 'unknown scenario',
    });
  });

  test('fund-loss flag only with explicit acceptance on funded selections', () => {
    const unfunded = buildRunArgv(
      { kind: 'scenario', scenarioId: 'onboarding.fresh', acceptFundLoss: true },
      FUNDED,
      KNOWN
    );
    expect('argv' in unfunded && unfunded.argv).not.toContain('--i-accept-test-fund-loss');
    const funded = buildRunArgv(
      { kind: 'scenario', scenarioId: 'send.lightning.sat', acceptFundLoss: true },
      FUNDED,
      KNOWN
    );
    expect('argv' in funded && funded.argv).toContain('--i-accept-test-fund-loss');
    const fundedNoAck = buildRunArgv(
      { kind: 'scenario', scenarioId: 'send.lightning.sat' },
      FUNDED,
      KNOWN
    );
    expect('argv' in fundedNoAck && fundedNoAck.argv).not.toContain('--i-accept-test-fund-loss');
  });

  test('commit run adds --require-clean-git', () => {
    const built = buildRunArgv({ kind: 'commit-run', suite: 'full' }, FUNDED, KNOWN);
    expect('argv' in built && built.argv).toContain('--require-clean-git');
  });
});

describe('killActiveJob', () => {
  test('refuses with no active job, kills a running job so the lock releases', async () => {
    expect(killActiveJob()).toEqual({ error: 'no job is running' });

    const job = startRunJob(['bun', '-e', 'await new Promise(() => {})']);
    expect('id' in job).toBe(true);
    if (!('id' in job)) return;
    expect(killActiveJob()).toEqual({ ok: true, id: job.id });

    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && activeJob()) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(activeJob()).toBeUndefined();
  }, 15_000);
});

describe('startRunJob (fake driver, real spawn)', () => {
  test('runs a smoke, discovers the run dir, single-job lock holds', async () => {
    const argv = [
      'bun',
      'e2e/cli.ts',
      'run',
      '--driver',
      'fake',
      '--suite',
      'full',
      '--scenario',
      'onboarding.fresh',
    ];
    const job = startRunJob(argv);
    expect('id' in job).toBe(true);
    if (!('id' in job)) return;
    expect(activeJob()?.id).toBe(job.id);
    const second = startRunJob(argv);
    expect('error' in second).toBe(true);

    // wait for exit (fake driver finishes in a couple of seconds)
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && activeJob()) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(activeJob()).toBeUndefined();
  }, 30_000);
});
