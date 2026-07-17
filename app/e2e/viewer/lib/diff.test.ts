import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import {
  collectSources,
  computeDiff,
  DIFF_RESULT_VERSION,
  diffCacheDir,
  diffKey,
  loadCachedDiff,
} from './diff';
import type { Frame, RunDetail } from './types';

function frame(overrides: Partial<Frame> & Pick<Frame, 'artifactSeq' | 'stepId'>): Frame {
  return {
    phase: 'T',
    kind: 'screenshot',
    file: `${overrides.stepId}/${overrides.artifactSeq}.png`,
    ...overrides,
  };
}

function runDetail(
  runId: string,
  frames: Frame[],
  named: RunDetail['scenarios'][0]['named'] = []
): RunDetail {
  return {
    runId,
    suite: 'default',
    driver: 'sim',
    proof: 'product-run',
    startedAt: '2026-07-15T00:00:00.000Z',
    scenarioIds: ['scn'],
    commitRun: false,
    label: runId,
    status: 'complete',
    fundsSafeToDelete: true,
    scenarios: [{ scenarioId: 'scn', name: 'Scenario', lane: 'toast', frames, named }],
  };
}

describe('collectSources', () => {
  test('pairs carry order/kind/label from run A when present on both sides', () => {
    const a = runDetail('run-a', [
      frame({ artifactSeq: 7, stepId: 'step-2', label: 'tap Send', kind: 'screenshot' }),
    ]);
    const b = runDetail('run-b', [
      frame({ artifactSeq: 3, stepId: 'step-2', label: 'tap Send (renamed)', kind: 'screenshot' }),
    ]);
    const [source] = collectSources(a, b);
    expect(source.order).toBe(7);
    expect(source.kind).toBe('screenshot');
    expect(source.label).toBe('tap Send');
    expect(source.a).toBeDefined();
    expect(source.b).toBeDefined();
  });

  test('B-only pairs fall back to run B order/label; A-only keep A metadata', () => {
    const a = runDetail('run-a', [frame({ artifactSeq: 1, stepId: 'step-1', label: 'only in A' })]);
    const b = runDetail('run-b', [frame({ artifactSeq: 9, stepId: 'step-9', label: 'only in B' })]);
    const sources = collectSources(a, b);
    const onlyA = sources.find((source) => source.stepId === 'step-1')!;
    const onlyB = sources.find((source) => source.stepId === 'step-9')!;
    expect(onlyA.order).toBe(1);
    expect(onlyA.label).toBe('only in A');
    expect(onlyA.b).toBeUndefined();
    expect(onlyB.order).toBe(9);
    expect(onlyB.label).toBe('only in B');
    expect(onlyB.a).toBeUndefined();
  });

  test('named captures carry their artifactSeq as order', () => {
    const a = runDetail(
      'run-a',
      [],
      [{ name: 'wallet', occurrence: 1, file: 'named/wallet.png', artifactSeq: 12 }]
    );
    const b = runDetail(
      'run-b',
      [],
      [{ name: 'wallet', occurrence: 1, file: 'named/wallet.png', artifactSeq: 4 }]
    );
    const [source] = collectSources(a, b);
    expect(source.phase).toBe('named');
    expect(source.name).toBe('wallet');
    expect(source.order).toBe(12);
  });
});

describe('computeDiff cache version gate', () => {
  const KEY = diffKey('run-diff-test-stale-a', 'run-diff-test-stale-b');
  const DIR = diffCacheDir(KEY);
  afterAll(() => rmSync(DIR, { recursive: true, force: true }));

  test('current-version cache is returned verbatim', async () => {
    mkdirSync(DIR, { recursive: true });
    const cached = { version: DIFF_RESULT_VERSION, runA: 'x', runB: 'y', pairs: [], scenarios: [] };
    await Bun.write(join(DIR, 'result.json'), JSON.stringify(cached));
    const result = await computeDiff('run-diff-test-stale-a', 'run-diff-test-stale-b');
    expect(result).toEqual(cached as never);
  });

  test('stale-version cache is ignored (falls through to recompute)', async () => {
    mkdirSync(DIR, { recursive: true });
    const stale = { runA: 'x', runB: 'y', pairs: [], scenarios: [] }; // pre-version format
    await Bun.write(join(DIR, 'result.json'), JSON.stringify(stale));
    // loadCachedDiff is the server routes' gate too — stale must read as absent
    expect(await loadCachedDiff(KEY)).toBeUndefined();
    const result = await computeDiff('run-diff-test-stale-a', 'run-diff-test-stale-b');
    // the runs don't exist, so a recompute attempt reports unknown run —
    // proving the stale cache was NOT returned
    expect(result).toEqual({ error: 'unknown run' });
  });

  test('loadCachedDiff returns current-version caches and rejects corrupt ones', async () => {
    mkdirSync(DIR, { recursive: true });
    const cached = { version: DIFF_RESULT_VERSION, runA: 'x', runB: 'y', pairs: [], scenarios: [] };
    await Bun.write(join(DIR, 'result.json'), JSON.stringify(cached));
    expect(await loadCachedDiff(KEY)).toEqual(cached as never);
    await Bun.write(join(DIR, 'result.json'), '{not json');
    expect(await loadCachedDiff(KEY)).toBeUndefined();
    expect(await loadCachedDiff(diffKey('run-none-a', 'run-none-b'))).toBeUndefined();
  });
});
