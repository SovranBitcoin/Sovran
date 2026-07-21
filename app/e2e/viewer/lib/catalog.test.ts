import { describe, expect, test } from 'bun:test';

import { fixtureSchema, scenarioSchema } from '../../schema';
import type { RunDetail, ScenarioTimeline } from './types';
import { catalogRunRef, catalogScenarioPlatforms } from './catalog';

function timeline(scenarioId: string, over: Partial<ScenarioTimeline> = {}): ScenarioTimeline {
  return {
    scenarioId,
    name: scenarioId,
    lane: 'simulator',
    frames: [],
    named: [],
    ...over,
  };
}

const run: RunDetail = {
  runId: 'example',
  suite: 'full',
  driver: 'sim',
  proof: 'product-run',
  startedAt: '2026-07-20T00:00:00.000Z',
  scenarioIds: ['attempted', 'deferred', 'fail-fast-skipped'],
  commitRun: false,
  label: 'example',
  status: 'complete',
  fundsSafeToDelete: true,
  scenarios: [timeline('attempted', { ok: true }), timeline('deferred', { deferred: true })],
};

describe('catalogRunRef', () => {
  test('includes an actually attempted scenario timeline', () => {
    expect(catalogRunRef(run, 'attempted')).toMatchObject({
      runId: 'run-example',
      driver: 'sim',
      ok: true,
    });
  });

  test('excludes capability/authored deferrals and fail-fast skips from manifest selection', () => {
    expect(catalogRunRef(run, 'deferred')).toBeUndefined();
    expect(catalogRunRef(run, 'fail-fast-skipped')).toBeUndefined();
  });
});

describe('catalogScenarioPlatforms', () => {
  test('includes nested fixture requirements in viewer platform support', () => {
    const fixture = fixtureSchema.parse({
      version: 1,
      id: 'flow.android-only',
      requires: ['device.network'],
      steps: [{ action: 'waitFor', selector: { id: 'fixture-ready' } }],
    });
    const scenario = scenarioSchema.parse({
      version: 1,
      id: 'fixture.platform',
      name: 'Fixture platform',
      description: 'Fixture-derived platform support',
      lane: 'simulator',
      tags: ['flow:wallet'],
      requires: ['fresh-install'],
      setup: [{ use: fixture.id }],
      steps: [{ action: 'screenshot', name: 'wallet' }],
      verify: [{ action: 'assert', that: 'visible', selector: { id: 'wallet-send' } }],
      endState: 'wallet',
    });

    expect(catalogScenarioPlatforms(scenario, new Map([[fixture.id, fixture]]))).toEqual([
      'android',
    ]);
  });
});
