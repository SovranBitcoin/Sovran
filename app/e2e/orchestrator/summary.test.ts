import { describe, expect, test } from 'bun:test';

import type { ChunkPlan } from './matrix';
import { DEFAULT_RETRIES, createState, type OrchestratorState } from './state';
import {
  buildSummaryJson,
  derivePairSummaries,
  renderSummaryMarkdown,
  reproCommand,
} from './summary';

const plan: ChunkPlan = {
  suite: 'full',
  scenarioCount: 3,
  expectedPairKeys: ['a|ios', 'a|android', 'b|ios', 'c|ios'],
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
      chunkId: 'ios:b',
      platform: 'ios',
      driver: 'sim',
      targetScenarioId: 'b',
      memberIds: ['b'],
      supportedMemberIds: ['b'],
      expectedPairKeys: ['b|ios'],
      funded: true,
    },
    {
      chunkId: 'android:a',
      platform: 'android',
      driver: 'android',
      targetScenarioId: 'a',
      memberIds: ['a'],
      supportedMemberIds: ['a'],
      expectedPairKeys: ['a|android'],
      funded: false,
    },
  ],
};

function makeState(): OrchestratorState {
  const state = createState({
    campaignId: 'orchestrate-2026-07-21T00-00-00-000Z',
    nowIso: '2026-07-21T00:00:00.000Z',
    sourceFingerprint: 'abcdef0123456789',
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
  // ios:a — flaky pass on attempt 2.
  state.chunks[0]!.status = 'flaky-pass';
  state.chunks[0]!.attempts = [
    {
      attempt: 1,
      startedAt: '2026-07-21T00:01:00.000Z',
      endedAt: '2026-07-21T00:03:00.000Z',
      runId: 'run-1',
      exitCode: 1,
      outcome: 'infra-aborted',
      artifacts: {
        runDir: 'e2e/artifacts/run-1',
        events: 'e2e/artifacts/run-1/events.jsonl',
        metroLogs: [],
      },
    },
    {
      attempt: 2,
      startedAt: '2026-07-21T00:04:00.000Z',
      endedAt: '2026-07-21T00:06:00.000Z',
      runId: 'run-2',
      exitCode: 0,
      outcome: 'passed',
      artifacts: {
        runDir: 'e2e/artifacts/run-2',
        events: 'e2e/artifacts/run-2/events.jsonl',
        metroLogs: [],
      },
    },
  ];
  // ios:b — consistent scenario failure.
  state.chunks[1]!.status = 'consistent-fail';
  state.chunks[1]!.attempts = [1, 2].map((attempt) => ({
    attempt,
    startedAt: '2026-07-21T00:10:00.000Z',
    endedAt: '2026-07-21T00:12:00.000Z',
    runId: `run-b${attempt}`,
    exitCode: 1,
    outcome: 'scenario-failed' as const,
    failure: {
      scenarioId: 'b',
      stepId: 'T03',
      error: 'selector never appeared',
      screenshot: `e2e/artifacts/run-b${attempt}/b/012-T03-tap.png`,
      axFile: `e2e/artifacts/run-b${attempt}/b/012-T03-tap.ax.json`,
    },
    artifacts: {
      runDir: `e2e/artifacts/run-b${attempt}`,
      events: `e2e/artifacts/run-b${attempt}/events.jsonl`,
      metroLogs: [`e2e/artifacts/run-b${attempt}/session-1/metro.log`],
    },
  }));
  return state;
}

describe('summary', () => {
  test('derivePairSummaries maps chunk statuses onto pairs', () => {
    const pairs = derivePairSummaries(makeState());
    const byKey = new Map(pairs.map((pair) => [`${pair.scenarioId}|${pair.platform}`, pair]));
    expect(byKey.get('a|ios')?.status).toBe('flaky-pass');
    expect(byKey.get('a|ios')?.runId).toBe('run-2');
    expect(byKey.get('b|ios')?.status).toBe('consistent-fail');
    expect(byKey.get('a|android')?.status).toBe('pending');
    // Pair with no chunk (platform/lane out of scope) is explicit, not missing.
    expect(byKey.get('c|ios')?.status).toBe('out-of-scope');
  });

  test('markdown leads with failures and includes evidence + repro', () => {
    const markdown = renderSummaryMarkdown(makeState());
    expect(markdown).toContain('progress: **1/3 pairs**');
    expect(markdown.indexOf('Consistent failures')).toBeLessThan(markdown.indexOf('Full matrix'));
    expect(markdown).toContain('failing scenario: `b` at step `T03`');
    expect(markdown).toContain('error: selector never appeared');
    expect(markdown).toContain('e2e/artifacts/run-b2/b/012-T03-tap.png');
    expect(markdown).toContain(
      'bun e2e/cli.ts run --driver sim --suite full --scenario b --i-approve-destructive-reset --i-accept-test-fund-loss'
    );
    expect(markdown).toContain('--resume orchestrate-2026-07-21T00-00-00-000Z');
    // Matrix row for scenario a: flaky glyph + green run id on iOS, pending on android.
    expect(markdown).toMatch(/\| a \| ~ run-2 \| … \|/);
  });

  test('summary.json carries per-pair statuses and chunk detail', () => {
    const json = buildSummaryJson(makeState()) as {
      byStatus: Record<string, number>;
      pairs: unknown[];
    };
    expect(json.byStatus['flaky-pass']).toBe(1);
    expect(json.byStatus['consistent-fail']).toBe(1);
    expect(json.pairs.length).toBe(4);
  });

  test('reproCommand only includes fund-loss consent for funded chunks', () => {
    const state = makeState();
    expect(reproCommand(state.chunks[0]!, true)).not.toContain('--i-accept-test-fund-loss');
    expect(reproCommand(state.chunks[1]!, true)).toContain('--i-accept-test-fund-loss');
    expect(reproCommand(state.chunks[1]!, false)).not.toContain('--i-accept-test-fund-loss');
  });
});
