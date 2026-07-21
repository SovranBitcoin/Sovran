import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ChunkPlan } from './matrix';
import {
  DEFAULT_RETRIES,
  chunksNeedingReconciliation,
  createState,
  isTerminalChunkStatus,
  loadState,
  saveState,
  type OrchestratorState,
} from './state';

const plan: ChunkPlan = {
  suite: 'full',
  scenarioCount: 2,
  expectedPairKeys: ['a|ios', 'a|android', 'b|ios'],
  chunks: [
    {
      chunkId: 'ios:a',
      platform: 'ios',
      driver: 'sim',
      targetScenarioId: 'a',
      memberIds: ['a'],
      supportedMemberIds: ['a'],
      expectedPairKeys: ['a|ios'],
      funded: false,
    },
    {
      chunkId: 'android:a',
      platform: 'android',
      driver: 'android',
      targetScenarioId: 'a',
      memberIds: ['a'],
      supportedMemberIds: ['a'],
      expectedPairKeys: ['a|android'],
      funded: true,
    },
  ],
};

const makeState = (): OrchestratorState =>
  createState({
    campaignId: 'orchestrate-test',
    nowIso: '2026-07-21T00:00:00.000Z',
    sourceFingerprint: 'fp',
    plan,
    config: {
      platforms: ['ios', 'android'],
      noRecord: false,
      acceptTestFundLoss: true,
      retries: {
        scenarioFail: DEFAULT_RETRIES.scenarioFail,
        infraAbort: { ...DEFAULT_RETRIES.infraAbort },
      },
    },
  });

describe('state', () => {
  test('save/load roundtrip preserves the schema', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orchestrate-state-'));
    const state = makeState();
    state.chunks[0]!.status = 'running';
    state.chunks[0]!.attempts.push({
      attempt: 1,
      startedAt: '2026-07-21T00:01:00.000Z',
      outcome: 'infra-aborted',
    });
    saveState(dir, state, '2026-07-21T00:02:00.000Z');
    const loaded = loadState(dir);
    expect(loaded.isOk()).toBe(true);
    const value = loaded._unsafeUnwrap();
    expect(value.updatedAt).toBe('2026-07-21T00:02:00.000Z');
    expect(value.chunks[0]!.attempts.length).toBe(1);
    expect(chunksNeedingReconciliation(value).map((chunk) => chunk.chunkId)).toEqual(['ios:a']);
  });

  test('loadState fails closed on missing, invalid, and schema-breaking files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orchestrate-state-'));
    expect(loadState(dir).isErr()).toBe(true);
    writeFileSync(join(dir, 'state.json'), 'not json');
    expect(loadState(dir).isErr()).toBe(true);
    writeFileSync(join(dir, 'state.json'), JSON.stringify({ version: 2 }));
    expect(loadState(dir).isErr()).toBe(true);
  });

  test('terminal statuses exclude only pending and running', () => {
    expect(isTerminalChunkStatus('pending')).toBe(false);
    expect(isTerminalChunkStatus('running')).toBe(false);
    for (const status of [
      'passed',
      'flaky-pass',
      'consistent-fail',
      'infra-exhausted',
      'funded-blocked',
      'skipped',
    ] as const) {
      expect(isTerminalChunkStatus(status)).toBe(true);
    }
  });
});
