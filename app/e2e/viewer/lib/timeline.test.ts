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
        t: 1_752_500_000_000,
      },
      { type: 'scenario.end', id: 'mint.add.url', ok: true, durationMs: 10 },
    ]);
    const { scenarios } = parseEvents(text, RUN_DIR);
    expect(scenarios).toHaveLength(1);
    expect(scenarios[0].videoFile).toBe('mint.add.url/video.mp4');
    expect(scenarios[0].videoEndT).toBe(1_752_500_000_000);
    // the video never masquerades as a screenshot frame
    expect(scenarios[0].frames).toHaveLength(0);
  });

  test('a video artifact without a bus timestamp leaves videoEndT unset', () => {
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
    const [timeline] = parseEvents(text, RUN_DIR).scenarios;
    expect(timeline.videoFile).toBe('mint.add.url/video.mp4');
    expect(timeline.videoEndT).toBeUndefined();
  });

  test('scenarios without a video artifact stay videoFile-less', () => {
    const text = lines([
      { type: 'scenario.begin', id: 't.x', name: 'x', lane: 'simulator' },
      { type: 'scenario.end', id: 't.x', ok: true, durationMs: 10 },
    ]);
    expect(parseEvents(text, RUN_DIR).scenarios[0].videoFile).toBeUndefined();
  });

  test('named captures carry the bus timestamp for video-timeline mapping', () => {
    const text = lines([
      { type: 'scenario.begin', id: 't.x', name: 'x', lane: 'simulator' },
      { type: 'step.begin', index: 1, stepId: 'T01', kind: 'tap', label: 'tap send' },
      {
        type: 'artifact',
        artifactSeq: 7,
        stepId: 'T01',
        kind: 'screenshot',
        path: `/abs/artifacts/${RUN_DIR}/t.x/named/wallet-007.png`,
        t: 1_752_500_001_234,
      },
      { type: 'step.end', index: 1, stepId: 'T01', kind: 'tap', ok: true, durationMs: 5 },
      { type: 'scenario.end', id: 't.x', ok: true, durationMs: 10 },
    ]);
    const [timeline] = parseEvents(text, RUN_DIR).scenarios;
    expect(timeline.named).toHaveLength(1);
    expect(timeline.named[0].t).toBe(1_752_500_001_234);
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

describe('parseEvents store/db sidecar artifacts', () => {
  const shot = (seq: number, stepId: string, rel: string, t?: number) => ({
    type: 'artifact',
    artifactSeq: seq,
    stepId,
    kind: 'screenshot',
    path: `/abs/artifacts/${RUN_DIR}/${rel}`,
    ...(t ? { t } : {}),
  });
  const sidecar = (seq: number, stepId: string, kind: 'store' | 'db', rel: string) => ({
    type: 'artifact',
    artifactSeq: seq,
    stepId,
    kind,
    path: `/abs/artifacts/${RUN_DIR}/${rel}`,
  });

  test('store and db sidecars pair onto their step frame by (stepId, artifactSeq)', () => {
    const text = lines([
      { type: 'scenario.begin', id: 't.x', name: 'x', lane: 'simulator' },
      { type: 'step.begin', index: 0, stepId: 'T01', kind: 'tap', label: 'tap' },
      shot(1, 'T01', 't.x/001-T01-tap.png'),
      sidecar(1, 'T01', 'store', 't.x/001-T01-tap.store.json'),
      sidecar(1, 'T01', 'db', 't.x/001-T01-tap.db.json'),
      { type: 'step.end', index: 0, stepId: 'T01', kind: 'tap', label: 'tap', ok: true },
      { type: 'scenario.end', id: 't.x', ok: true, durationMs: 10 },
    ]);
    const [timeline] = parseEvents(text, RUN_DIR).scenarios;
    expect(timeline.frames[0].storeFile).toBe('t.x/001-T01-tap.store.json');
    expect(timeline.frames[0].dbFile).toBe('t.x/001-T01-tap.db.json');
  });

  test('a dedup event pointing at an earlier path still pairs onto ITS OWN frame', () => {
    const text = lines([
      { type: 'scenario.begin', id: 't.x', name: 'x', lane: 'simulator' },
      { type: 'step.begin', index: 0, stepId: 'T01', kind: 'tap', label: 'a' },
      shot(1, 'T01', 't.x/001-T01-tap.png'),
      sidecar(1, 'T01', 'store', 't.x/001-T01-tap.store.json'),
      { type: 'step.end', index: 0, stepId: 'T01', kind: 'tap', label: 'a', ok: true },
      { type: 'step.begin', index: 1, stepId: 'T02', kind: 'tap', label: 'b' },
      shot(2, 'T02', 't.x/002-T02-tap.png'),
      // unchanged state: the runner re-emits the FIRST frame's sidecar path
      sidecar(2, 'T02', 'store', 't.x/001-T01-tap.store.json'),
      { type: 'step.end', index: 1, stepId: 'T02', kind: 'tap', label: 'b', ok: true },
      { type: 'scenario.end', id: 't.x', ok: true, durationMs: 10 },
    ]);
    const [timeline] = parseEvents(text, RUN_DIR).scenarios;
    expect(timeline.frames[1].stepId).toBe('T02');
    expect(timeline.frames[1].storeFile).toBe('t.x/001-T01-tap.store.json');
  });

  test('named frames and the FINAL frame get their sidecars too', () => {
    const text = lines([
      { type: 'scenario.begin', id: 't.x', name: 'x', lane: 'simulator' },
      { type: 'step.begin', index: 0, stepId: 'T01', kind: 'screenshot', label: 'shot' },
      shot(1, 'T01', 't.x/named/wallet-001.png', 1000),
      sidecar(1, 'T01', 'store', 't.x/named/wallet-001.store.json'),
      sidecar(1, 'T01', 'db', 't.x/named/wallet-001.db.json'),
      { type: 'step.end', index: 0, stepId: 'T01', kind: 'screenshot', label: 'shot', ok: true },
      shot(2, 'FINAL', 't.x/002-FINAL-final-state.png'),
      sidecar(2, 'FINAL', 'store', 't.x/002-FINAL-final-state.store.json'),
      { type: 'scenario.end', id: 't.x', ok: true, durationMs: 10 },
    ]);
    const [timeline] = parseEvents(text, RUN_DIR).scenarios;
    expect(timeline.named[0].storeFile).toBe('t.x/named/wallet-001.store.json');
    expect(timeline.named[0].dbFile).toBe('t.x/named/wallet-001.db.json');
    const final = timeline.frames.find((f) => f.stepId === 'FINAL');
    expect(final?.storeFile).toBe('t.x/002-FINAL-final-state.store.json');
  });

  test('runs without store/db events parse exactly as before', () => {
    const text = lines([
      { type: 'scenario.begin', id: 't.x', name: 'x', lane: 'simulator' },
      { type: 'step.begin', index: 0, stepId: 'T01', kind: 'tap', label: 'tap' },
      shot(1, 'T01', 't.x/001-T01-tap.png'),
      { type: 'step.end', index: 0, stepId: 'T01', kind: 'tap', label: 'tap', ok: true },
      { type: 'scenario.end', id: 't.x', ok: true, durationMs: 10 },
    ]);
    const [timeline] = parseEvents(text, RUN_DIR).scenarios;
    expect(timeline.frames[0].storeFile).toBeUndefined();
    expect(timeline.frames[0].dbFile).toBeUndefined();
  });
});
