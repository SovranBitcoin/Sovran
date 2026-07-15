import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseEvents, timelinesFromDirScan } from './timeline';

const RUN_DIR = 'run-2026-07-15T00-00-00-000Z-video123';
const lines = (events: Record<string, unknown>[]) =>
  events.map((event) => JSON.stringify(event)).join('\n');

describe('parseEvents video artifacts', () => {
  test('a video artifact lands as the scenario timeline videoFile, run-dir-relative', () => {
    const text = lines([
      { type: 'scenario.begin', id: 'mint.add.url', name: 'Add mint via URL', lane: 'simulator' },
      {
        type: 'artifact',
        artifactSeq: 41,
        stepId: 'VIDEO',
        kind: 'video',
        path: `/abs/artifacts/${RUN_DIR}/mint.add.url/video.mp4`,
      },
      { type: 'scenario.end', id: 'mint.add.url', ok: true, durationMs: 10 },
    ]);
    const { scenarios } = parseEvents(text, RUN_DIR);
    expect(scenarios).toHaveLength(1);
    expect(scenarios[0].videoFile).toBe('mint.add.url/video.mp4');
    // the video never masquerades as a screenshot frame
    expect(scenarios[0].frames).toHaveLength(0);
  });

  test('scenarios without a video artifact stay videoFile-less', () => {
    const text = lines([
      { type: 'scenario.begin', id: 't.x', name: 'x', lane: 'simulator' },
      { type: 'scenario.end', id: 't.x', ok: true, durationMs: 10 },
    ]);
    expect(parseEvents(text, RUN_DIR).scenarios[0].videoFile).toBeUndefined();
  });
});

describe('timelinesFromDirScan video fallback', () => {
  test('picks up video.mp4 when rebuilding a timeline without events', () => {
    const runDir = mkdtempSync(join(tmpdir(), 'e2e-timeline-'));
    const scenarioDir = join(runDir, 'mint.add.url');
    mkdirSync(scenarioDir, { recursive: true });
    writeFileSync(join(scenarioDir, '001-T01-tap.png'), 'png');
    writeFileSync(join(scenarioDir, 'video.mp4'), 'mp4');
    const [timeline] = timelinesFromDirScan(runDir, ['mint.add.url']);
    expect(timeline.videoFile).toBe('mint.add.url/video.mp4');
    expect(timeline.frames).toHaveLength(1);
  });
});
