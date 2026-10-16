import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  attemptDirectory,
  createStoryRun,
  finishStoryRun,
  registerAttempt,
  reusableEvidence,
} from './runs';

test('independent runs preserve evidence and separate workers and setup from stories', () => {
  const root = mkdtempSync(join(tmpdir(), 'results-'));
  try {
    const first = createStoryRun(root, 'library', ['same']);
    const a = registerAttempt(first, 'worker-a', 'same');
    writeFileSync(join(a, 'proof.jpg'), 'original');
    const setup = attemptDirectory(first, 'worker-a', 'same', 'setup');
    const other = attemptDirectory(first, 'worker-b', 'same', 'setup');
    expect(setup).not.toBe(a);
    expect(other).not.toBe(setup);
    finishStoryRun(first);
    const second = createStoryRun(root, 'full', ['same']);
    registerAttempt(second, 'worker-a', 'same');
    expect(second).not.toBe(first);
    expect(readFileSync(join(a, 'proof.jpg'), 'utf8')).toBe('original');
    expect(() => registerAttempt(first, '../escape', 'same')).toThrow();
    expect(() => registerAttempt(first, 'worker-a', 'same')).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a saved story without evidence cannot rewind and replay a wallet', () => {
  expect(() => reusableEvidence(true, undefined)).toThrow('already played');
  expect(reusableEvidence(true, '/previous/report')).toBe('/previous/report');
  expect(reusableEvidence(false, '/stale/report')).toBeUndefined();
});
