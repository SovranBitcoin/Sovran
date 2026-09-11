import { describe, expect, test } from 'bun:test';

import {
  REINSTALL_KEYCHAIN_RETENTION_CAPABILITY,
  scenarioPlatforms,
  type Platform,
} from '../../schema/capabilities';
import type { ScenarioCatalogEntry } from './types';
import { buildRunPlan } from './run-plan';

function scenario(
  id: string,
  platforms: Platform[],
  options: { lane?: string; suites?: string[] } = {}
): ScenarioCatalogEntry {
  return {
    id,
    name: id,
    description: id,
    lane: options.lane ?? 'simulator',
    tags: [],
    platforms,
    facets: { checks: [], extras: [] },
    suites: options.suites ?? ['full'],
    runs: [],
  };
}

const CATALOG = [
  scenario('both', ['ios', 'android'], { suites: ['default', 'full'] }),
  scenario('ios-only', ['ios']),
  scenario('android-funded', ['android'], { lane: 'funded' }),
];

describe('buildRunPlan', () => {
  test('expands a cross-platform scenario into sequential iOS and Android commands', () => {
    expect(buildRunPlan({ kind: 'scenario', scenarioId: 'both' }, CATALOG)).toEqual({
      argvs: [
        [
          'bun',
          'e2e/cli.ts',
          'run',
          '--driver',
          'sim',
          '--i-approve-destructive-reset',
          '--suite',
          'full',
          '--scenario',
          'both',
        ],
        [
          'bun',
          'e2e/cli.ts',
          'run',
          '--driver',
          'android',
          '--i-approve-destructive-reset',
          '--suite',
          'full',
          '--scenario',
          'both',
        ],
      ],
      funded: false,
      platforms: ['ios', 'android'],
    });
  });

  test('runs a single-platform scenario only on its supported driver', () => {
    const plan = buildRunPlan({ kind: 'scenario', scenarioId: 'ios-only' }, CATALOG);
    expect('argvs' in plan && plan.argvs).toHaveLength(1);
    expect('argvs' in plan && plan.argvs[0]).toContain('sim');
  });

  test('never emits an Android command for iOS Keychain reinstall recovery', () => {
    const recovery = scenario(
      'recovery.reinstall',
      scenarioPlatforms(['fresh-install', REINSTALL_KEYCHAIN_RETENTION_CAPABILITY])
    );
    const plan = buildRunPlan({ kind: 'scenario', scenarioId: 'recovery.reinstall' }, [recovery]);

    expect(plan).toMatchObject({ platforms: ['ios'] });
    if (!('argvs' in plan)) throw new Error(plan.error);
    expect(plan.argvs).toHaveLength(1);
    expect(plan.argvs[0]).toContain('sim');
    expect(plan.argvs[0]).not.toContain('android');
  });

  test('expands suites by platform and scopes fund acceptance to funded platforms', () => {
    const plan = buildRunPlan({ kind: 'suite', suite: 'full', acceptFundLoss: true }, CATALOG);
    expect('argvs' in plan && plan.argvs).toHaveLength(3);
    if (!('argvs' in plan)) return;
    expect(plan.funded).toBe(true);
    expect(plan.argvs[0]).not.toContain('--i-accept-test-fund-loss');
    expect(plan.argvs[1]).not.toContain('--i-accept-test-fund-loss');
    expect(plan.argvs[2]).toContain('--i-accept-test-fund-loss');
    expect(
      plan.argvs.map((argv) => argv.slice(argv.indexOf('--lane'), argv.indexOf('--lane') + 2))
    ).toEqual([
      ['--lane', 'simulator'],
      ['--lane', 'simulator'],
      ['--lane', 'funded'],
    ]);
  });

  test('adds the clean-git gate to every commit-run command', () => {
    const plan = buildRunPlan({ kind: 'commit-run', suite: 'full' }, CATALOG);
    expect('argvs' in plan && plan.argvs).toHaveLength(3);
    if (!('argvs' in plan)) return;
    expect(plan.argvs.every((argv) => argv.includes('--require-clean-git'))).toBe(true);
  });

  test('rejects unknown or unrunnable selections', () => {
    expect(buildRunPlan({ kind: 'scenario', scenarioId: 'missing' }, CATALOG)).toEqual({
      error: 'unknown scenario',
    });
    expect(buildRunPlan({ kind: 'scenario', scenarioId: 'none' }, [scenario('none', [])])).toEqual({
      error: 'selection has no supported platforms',
    });
  });
});

test('store capture selects one platform and disables per-action evidence and video', () => {
  const result = buildRunPlan({ kind: 'suite', suite: 'store-screenshots', platform: 'android' }, [
    scenario('store.screenshots', ['ios', 'android'], { suites: ['store-screenshots', 'full'] }),
  ]);
  expect(result).toMatchObject({ funded: false, platforms: ['android'] });
  if ('error' in result) throw new Error(result.error);
  expect(result.argvs).toHaveLength(1);
  expect(result.argvs[0]).toEqual([
    'bun',
    'e2e/cli.ts',
    'run',
    '--driver',
    'android',
    '--i-approve-destructive-reset',
    '--suite',
    'store-screenshots',
    '--lane',
    'simulator',
    '--evidence',
    'screenshots',
    '--no-record',
  ]);
});
