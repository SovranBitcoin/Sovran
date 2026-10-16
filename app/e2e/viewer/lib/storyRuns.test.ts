import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import {
  attemptDirectory,
  createStoryRun,
  finishAttempt,
  finishStoryRun,
  registerAttempt,
} from '../../results/runs';
import { recordedRun } from './storyRuns';
const read = async (dir: string) =>
  recordedRun(dir, basename(dir), await Bun.file(join(dir, 'manifest.json')).json());

test('story history includes timing and warnings, excludes setup from totals and blocks unsafe media', async () => {
  const root = mkdtempSync(join(tmpdir(), 'story-view-'));
  try {
    const dir = createStoryRun(root, 'full', ['one', 'crashed', 'never-started']);
    const out = registerAttempt(dir, 'worker', 'one');
    writeFileSync(join(out, 'shot.jpg'), 'image');
    writeFileSync(join(out, 'story.mp4'), 'video');
    writeFileSync(
      join(out, 'report.json'),
      JSON.stringify({
        id: 'one',
        purpose: 'A person opens a sheet',
        startsFrom: 'wallet',
        ok: true,
        video: 'story.mp4',
        steps: [
          {
            name: 'Open',
            ok: true,
            wallMs: 34,
            picture: 'shot.jpg',
            screenKeptMoving: true,
            entries: [
              { level: 'warn', event: '<warning>' },
              { level: 'info', event: 'normal' },
            ],
          },
        ],
      })
    );
    finishAttempt(out, 'one', 0);
    const setup = attemptDirectory(dir, 'worker', 'base', 'setup');
    mkdirSync(setup, { recursive: true });
    writeFileSync(
      join(setup, 'report.json'),
      JSON.stringify({
        id: 'base',
        purpose: 'Setup',
        startsFrom: 'fresh',
        ok: true,
        video: '../../../../../outside.mp4',
        steps: [],
      })
    );
    const crash = registerAttempt(dir, 'worker', 'crashed');
    finishAttempt(crash, 'crashed', 1, 'child died');
    finishStoryRun(dir);
    const run = await read(dir);
    expect(run?.result).toMatchObject({ passed: 1, failed: 2 });
    expect(run?.commitRun).toBe(false);
    expect(
      run?.scenarios.find((item) => item.scenarioId === 'setup:worker:base')?.videoFile
    ).toBeUndefined();
    const one = run?.scenarios.find((item) => item.scenarioId === 'story:one');
    expect(one?.description).toBe('A person opens a sheet');
    expect(one?.frames[0]?.file).toEndWith('shot.jpg');
    expect(one?.frames[0]?.observations?.warnings).toEqual([{ level: 'warn', event: '<warning>' }]);
    expect(one?.videoEndT).toBeUndefined(); // Old evidence has no recording boundary.
    const sampled = JSON.parse(await Bun.file(join(out, 'report.json')).text());
    sampled.screenObservation = 'simctl-samples';
    sampled.steps[0].screenCapture = { startedAtWallMs: 1000, endedAtWallMs: 1100 };
    writeFileSync(join(out, 'report.json'), JSON.stringify(sampled));
    const observation = (await read(dir))?.scenarios.find((item) => item.scenarioId === 'story:one')
      ?.frames[0].observations;
    expect(observation).toMatchObject({
      screenObservation: 'simctl-samples',
      screenCapture: { startedAtWallMs: 1000, endedAtWallMs: 1100 },
    });
    expect(run?.fundsSafeToDelete).toBe(false);
    expect(run?.scenarios.find((item) => item.scenarioId === 'story:crashed')?.failure).toBe(
      'child died'
    );
    symlinkSync(join(out, 'shot.jpg'), join(out, 'link.jpg'));
    const report = await Bun.file(join(out, 'report.json')).json();
    report.steps[0].picture = 'link.jpg';
    writeFileSync(join(out, 'report.json'), JSON.stringify(report));
    expect(
      (await read(dir))?.scenarios.find((item) => item.scenarioId === 'story:one')?.frames[0]?.file
    ).toBe('');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('manual review never claims an automated pass or invented date/git provenance', () => {
  const root = mkdtempSync(join(tmpdir(), 'manual-view-'));
  try {
    mkdirSync(join(root, 'evidence'));
    writeFileSync(join(root, 'evidence', 'screen.png'), 'image');
    const run = recordedRun(root, 'run-manual', {
      version: 1,
      kind: 'manual-review',
      suite: 'review',
      selection: [],
      state: { status: 'imported' },
    });
    expect(run?.proof).toBe('manual-review');
    expect(run?.result).toBeUndefined();
    expect(run?.scenarios[0]?.ok).toBeUndefined();
    expect(run?.startedAt).toBe('');
    expect(run?.git).toBeUndefined();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a watcher failure remains visible even when every step passed', () => {
  const root = mkdtempSync(join(tmpdir(), 'watcher-view-'));
  try {
    const out = join(root, 'workers/worker/stories/story');
    mkdirSync(out, { recursive: true });
    writeFileSync(
      join(out, 'report.json'),
      JSON.stringify({
        id: 'story',
        purpose: 'Open wallet',
        startsFrom: 'fresh',
        ok: false,
        failure: 'screen watcher died',
        steps: [{ name: 'Open', ok: true, wallMs: 1, entries: [] }],
      })
    );
    const run = recordedRun(root, 'run-watcher', {
      version: 1,
      kind: 'stories',
      suite: 'library',
      git: { sha: 'abc', shortSha: 'abc', branch: 'test', dirty: false },
      selection: ['story'],
      state: { status: 'complete', endedAt: '2026-10-16T00:00:00Z' },
    });
    expect(run?.scenarios[0]?.failure).toBe('screen watcher died');
    expect(run?.commitRun).toBe(false);
    expect(run?.result?.failed).toBe(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
