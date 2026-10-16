import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { migrateResults } from './migrate';

test('migration preserves original evidence and private cache bytes and is repeatable', () => {
  const root = mkdtempSync(join(tmpdir(), 'migrate-results-'));
  try {
    const fixtures = {
      'stories/story/report.json': '{"original":"bytes"}',
      'stories/state-base/report.json': 'setup',
      'onboarding-resume/validation.json': '{"branch":"old-branch"}',
      'stories-tls/ca.key': 'private-key',
      'screenshot-refresh-2026.json': 'history',
      'run-existing/manifest.json': 'legacy',
    };
    for (const [name, data] of Object.entries(fixtures)) {
      mkdirSync(dirname(join(root, name)), { recursive: true });
      writeFileSync(join(root, name), data);
    }
    migrateResults(root);
    expect(
      readFileSync(
        join(root, 'run-imported-stories/workers/imported/stories/story/report.json'),
        'utf8'
      )
    ).toBe(fixtures['stories/story/report.json']);
    expect(
      readFileSync(
        join(root, 'run-imported-stories/workers/imported/setup/state-base/report.json'),
        'utf8'
      )
    ).toBe('setup');
    expect(
      readFileSync(join(root, 'run-manual-onboarding-resume/evidence/validation.json'), 'utf8')
    ).toBe(fixtures['onboarding-resume/validation.json']);
    expect(readFileSync(join(root, 'cache/stories-tls/ca.key'), 'utf8')).toBe('private-key');
    expect(readFileSync(join(root, 'run-existing/manifest.json'), 'utf8')).toBe('legacy');
    expect(migrateResults(root)).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a live owner or target collision prevents all moves', () => {
  const root = mkdtempSync(join(tmpdir(), 'migrate-results-'));
  try {
    mkdirSync(join(root, 'stories'));
    writeFileSync(join(root, 'stories/.running'), String(process.pid));
    mkdirSync(join(root, 'onboarding-resume'));
    expect(() => migrateResults(root)).toThrow('in use');
    expect(existsSync(join(root, 'onboarding-resume'))).toBe(true);
    rmSync(join(root, 'stories/.running'));
    mkdirSync(join(root, 'run-manual-onboarding-resume/evidence'), { recursive: true });
    expect(() => migrateResults(root)).toThrow('overwrite');
    expect(existsSync(join(root, 'stories'))).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an existing imported run manifest is never overwritten', () => {
  const root = mkdtempSync(join(tmpdir(), 'migrate-existing-'));
  try {
    mkdirSync(join(root, 'stories/one'), { recursive: true });
    mkdirSync(join(root, 'run-imported-stories'));
    writeFileSync(join(root, 'run-imported-stories/manifest.json'), 'original manifest');
    expect(() => migrateResults(root)).toThrow('overwrite');
    expect(readFileSync(join(root, 'run-imported-stories/manifest.json'), 'utf8')).toBe(
      'original manifest'
    );
    expect(existsSync(join(root, 'stories/one'))).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
