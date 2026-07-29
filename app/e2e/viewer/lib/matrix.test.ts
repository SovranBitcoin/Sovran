import { describe, expect, test } from 'bun:test';

import { loadE2E } from '../../core/loader';
import { effectiveRequirements, expandScenario } from '../../core/plan';
import { selectSuiteScenarios } from '../../core/selection';
import { CAPABILITIES, DRIVER_CAPS, scenarioPlatforms, type Platform } from '../../schema';
import { buildCatalog } from './catalog';
import { E2E_ROOT } from './paths';
import { buildRunPlan } from './run-plan';

const loaded = loadE2E(E2E_ROOT);
const selection = selectSuiteScenarios(loaded.suites, loaded.scenarios, { suite: 'full' });
const scenarios = selection.scenarios;

function pair(id: string, platform: Platform): string {
  return `${id}|${platform}`;
}

function effectivePlatforms(scenario: (typeof scenarios)[number]): Platform[] {
  return scenarioPlatforms(effectiveRequirements(scenario, loaded.fixtures));
}

const crossDriverCapabilities = CAPABILITIES.filter(
  (capability) =>
    capability.startsWith('cocod.') || capability === 'relay.controlled' || capability === 'blossom'
);

describe('real full-suite platform matrix', () => {
  test('exposes every CLI-supported scenario/platform pair exactly once', async () => {
    expect(loaded.issues).toEqual([]);
    expect(scenarios).toHaveLength(126);
    expect(new Set(scenarios.map(({ id }) => id)).size).toBe(126);

    const expectedById = new Map(
      scenarios.map((scenario) => [scenario.id, effectivePlatforms(scenario)])
    );
    for (const platforms of expectedById.values()) expect(platforms.length).toBeGreaterThan(0);

    const expectedPairs = scenarios.flatMap((scenario) =>
      effectivePlatforms(scenario).map((platform) => pair(scenario.id, platform))
    );
    expect(expectedPairs).toHaveLength(215);
    expect(new Set(expectedPairs).size).toBe(215);

    const catalog = (await buildCatalog()).filter((entry) => entry.suites.includes('full'));
    expect(catalog).toHaveLength(126);
    expect(new Set(catalog.map(({ id }) => id)).size).toBe(126);
    expect(catalog.map(({ id }) => id).sort()).toEqual(scenarios.map(({ id }) => id).sort());

    for (const entry of catalog) {
      const expected = expectedById.get(entry.id);
      if (!expected) throw new Error(`viewer exposed unknown scenario ${entry.id}`);
      expect(entry.platforms).toEqual(expected);
    }
    const viewerPairs = catalog.flatMap((entry) =>
      entry.platforms.map((platform) => pair(entry.id, platform))
    );
    expect(viewerPairs).toHaveLength(215);
    expect(new Set(viewerPairs).size).toBe(215);
    expect(viewerPairs.sort()).toEqual(expectedPairs.sort());

    const platformCases = [
      ['ios', DRIVER_CAPS.sim, 117],
      ['android', DRIVER_CAPS.android, 98],
    ] as const;
    for (const [platform, driverCapabilities, expectedCount] of platformCases) {
      const capabilities = new Set([...driverCapabilities, ...crossDriverCapabilities]);
      const cliReady = scenarios
        .filter(
          (scenario) =>
            expandScenario(scenario, loaded.fixtures, { capabilities }).availability === 'ready'
        )
        .map(({ id }) => id)
        .sort();
      const viewerSupported = catalog
        .filter((entry) => entry.platforms.includes(platform))
        .map(({ id }) => id)
        .sort();

      expect(cliReady).toHaveLength(expectedCount);
      expect(viewerSupported).toEqual(cliReady);
    }
  });

  test('plans every Both scenario once on iOS and once on Android automatically', async () => {
    const catalog = await buildCatalog();
    const fullCatalog = catalog.filter((entry) => entry.suites.includes('full'));
    const both = fullCatalog.filter(
      (entry) =>
        entry.platforms.length === 2 &&
        entry.platforms.includes('ios') &&
        entry.platforms.includes('android')
    );
    expect(both).toHaveLength(89);

    for (const entry of both) {
      const plan = buildRunPlan(
        { kind: 'scenario', scenarioId: entry.id, acceptFundLoss: true },
        catalog
      );
      if ('error' in plan) throw new Error(`${entry.id}: ${plan.error}`);

      expect(plan.platforms).toEqual(['ios', 'android']);
      expect(plan.argvs).toHaveLength(2);
      expect(plan.argvs.map((argv) => argv[argv.indexOf('--driver') + 1])).toEqual([
        'sim',
        'android',
      ]);
      expect(plan.argvs.map((argv) => argv[argv.indexOf('--scenario') + 1])).toEqual([
        entry.id,
        entry.id,
      ]);
    }

    const suitePlan = buildRunPlan({ kind: 'suite', suite: 'full', acceptFundLoss: true }, catalog);
    if ('error' in suitePlan) throw new Error(suitePlan.error);
    expect(suitePlan.platforms).toEqual(['ios', 'android']);
    expect(suitePlan.argvs.map((argv) => argv[argv.indexOf('--driver') + 1])).toEqual([
      'sim',
      'sim',
      'android',
      'android',
    ]);
    expect(suitePlan.argvs.map((argv) => argv[argv.indexOf('--lane') + 1])).toEqual([
      'simulator',
      'funded',
      'simulator',
      'funded',
    ]);
    expect(suitePlan.argvs.map((argv) => argv.includes('--i-accept-test-fund-loss'))).toEqual([
      false,
      true,
      false,
      true,
    ]);
  });
});
