import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { classifyRunDir } from './classify';

const RUN = 'run-2026-07-21T00-00-00-000Z-testtest';

function writeRun(events: Record<string, unknown>[], options: { metro?: boolean } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'orchestrate-classify-'));
  const runDir = join(root, RUN);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, 'events.jsonl'),
    events.map((event) => JSON.stringify(event)).join('\n')
  );
  if (options.metro) {
    mkdirSync(join(runDir, 'session-1'), { recursive: true });
    writeFileSync(join(runDir, 'session-1', 'metro.log'), 'metro\n');
  }
  return root;
}

const runEnd = (overrides: Record<string, unknown> = {}) => ({
  type: 'run.end',
  passed: 1,
  failed: 0,
  skipped: 0,
  deferred: 0,
  durationMs: 1000,
  funds: 'n/a',
  ...overrides,
});

describe('classifyRunDir', () => {
  test('green run.end → passed, with metro log paths', () => {
    const root = writeRun(
      [
        { type: 'scenario.begin', id: 's1', lane: 'simulator' },
        { type: 'scenario.end', id: 's1', ok: true },
        runEnd(),
      ],
      { metro: true }
    );
    const result = classifyRunDir(root, RUN);
    expect(result.outcome).toBe('passed');
    expect(result.artifacts?.metroLogs).toEqual([`e2e/artifacts/${RUN}/session-1/metro.log`]);
  });

  test('red scenario → scenario-failed with failing step evidence', () => {
    const root = writeRun([
      { type: 'scenario.begin', id: 's1', lane: 'simulator' },
      { type: 'step.begin', stepId: 'T03', kind: 'tapUntil' },
      {
        type: 'artifact',
        kind: 'screenshot',
        stepId: 'T03',
        artifactSeq: 12,
        path: `/x/${RUN}/s1/012-T03-tapUntil.png`,
      },
      {
        type: 'artifact',
        kind: 'ax',
        stepId: 'T03',
        artifactSeq: 12,
        path: `/x/${RUN}/s1/012-T03-tapUntil.ax.json`,
      },
      { type: 'step.end', stepId: 'T03', ok: false, error: 'target never appeared' },
      { type: 'scenario.end', id: 's1', ok: false },
      runEnd({ passed: 0, failed: 1 }),
    ]);
    const result = classifyRunDir(root, RUN);
    expect(result.outcome).toBe('scenario-failed');
    expect(result.failure?.scenarioId).toBe('s1');
    expect(result.failure?.stepId).toBe('T03');
    expect(result.failure?.error).toBe('target never appeared');
    expect(result.failure?.screenshot).toBe(`e2e/artifacts/${RUN}/s1/012-T03-tapUntil.png`);
    expect(result.failure?.axFile).toBe(`e2e/artifacts/${RUN}/s1/012-T03-tapUntil.ax.json`);
  });

  test('red scenario without run.end still charges the scenario budget', () => {
    const root = writeRun([
      { type: 'scenario.begin', id: 's1', lane: 'simulator' },
      { type: 'scenario.end', id: 's1', ok: false },
    ]);
    expect(classifyRunDir(root, RUN).outcome).toBe('scenario-failed');
  });

  test('no run.end and no red scenario → infra-aborted', () => {
    const root = writeRun([
      { type: 'scenario.begin', id: 's1', lane: 'simulator' },
      { type: 'step.begin', stepId: 'T01', kind: 'tap' },
    ]);
    expect(classifyRunDir(root, RUN).outcome).toBe('infra-aborted');
  });

  test('quarantined funds dominate', () => {
    const root = writeRun([
      { type: 'scenario.begin', id: 's1', lane: 'funded' },
      { type: 'scenario.end', id: 's1', ok: true },
      runEnd({ funds: 'quarantined' }),
    ]);
    expect(classifyRunDir(root, RUN).outcome).toBe('funded-quarantined');
  });

  test('missing run dir and interruption flags', () => {
    expect(classifyRunDir('/nonexistent', undefined).outcome).toBe('preflight-failed');
    expect(classifyRunDir('/nonexistent', undefined, { interrupted: true }).outcome).toBe(
      'interrupted'
    );
    const root = writeRun([{ type: 'scenario.begin', id: 's1' }]);
    expect(classifyRunDir(root, RUN, { interrupted: true }).outcome).toBe('interrupted');
  });

  test('tolerates a truncated events tail', () => {
    const root = writeRun([]);
    writeFileSync(
      join(root, RUN, 'events.jsonl'),
      `${JSON.stringify({ type: 'scenario.begin', id: 's1' })}\n{"type":"scena`
    );
    expect(classifyRunDir(root, RUN).outcome).toBe('infra-aborted');
  });
});
