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

  test('carries the per-scenario status on attempted refs', () => {
    const withStatus: RunDetail = {
      ...run,
      scenarioStatus: { attempted: 'passed', deferred: 'deferred', 'fail-fast-skipped': 'skipped' },
    };
    expect(catalogRunRef(withStatus, 'attempted')?.scenarioStatus).toBe('passed');
    // finished runs keep the attempted-only invariant even with statuses present
    expect(catalogRunRef(withStatus, 'fail-fast-skipped')).toBeUndefined();
  });

  test('a live run surfaces pending and running members without a timeline', () => {
    const live: RunDetail = {
      ...run,
      status: 'in-progress',
      scenarioIds: ['attempted', 'active', 'queued'],
      scenarios: [timeline('attempted', { ok: true })],
      scenarioStatus: { attempted: 'passed', active: 'running', queued: 'pending' },
      activeScenarioId: 'active',
    };
    expect(catalogRunRef(live, 'active')?.scenarioStatus).toBe('running');
    expect(catalogRunRef(live, 'queued')?.scenarioStatus).toBe('pending');
    // deferred members stay excluded even mid-run
    const liveDeferred: RunDetail = {
      ...live,
      scenarios: [...live.scenarios, timeline('held', { deferred: true })],
      scenarioStatus: { ...live.scenarioStatus, held: 'deferred' },
    };
    expect(catalogRunRef(liveDeferred, 'held')).toBeUndefined();
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
