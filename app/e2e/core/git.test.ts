import { afterEach, describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  captureSourceFingerprint,
  compareSourceFingerprints,
  dirtyFromPorcelain,
  fingerprintSourceFiles,
} from './git';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('dirtyFromPorcelain', () => {
  test('clean tree is not dirty', () => {
    expect(dirtyFromPorcelain('')).toBe(false);
    expect(dirtyFromPorcelain('\n\n')).toBe(false);
  });

  test('modified product file is dirty', () => {
    expect(dirtyFromPorcelain(' M app/features/wallet/screens/WalletScreen.tsx\n')).toBe(true);
  });

  test('artifacts-only changes are ignored', () => {
    expect(
      dirtyFromPorcelain(
        '?? app/e2e/artifacts/run-2026-07-13T04-29-34-798Z-0f50b991/\n M app/e2e/artifacts/metro.log\n'
      )
    ).toBe(false);
  });

  test('artifacts changes mixed with product changes are dirty', () => {
    expect(dirtyFromPorcelain('?? app/e2e/artifacts/run-x/\n M app/e2e/cli.ts\n')).toBe(true);
  });

  test('rename counts as dirty unless both sides are artifacts', () => {
    expect(dirtyFromPorcelain('R  app/e2e/cli.ts -> app/e2e/cli2.ts\n')).toBe(true);
    expect(dirtyFromPorcelain('R  app/e2e/artifacts/a.log -> app/e2e/artifacts/b.log\n')).toBe(
      false
    );
  });
});

describe('captureSourceFingerprint', () => {
  test('accepts only an available fingerprint unchanged across source loading', () => {
    const fingerprint = 'a'.repeat(64);
    expect(compareSourceFingerprints(fingerprint, fingerprint)).toEqual({
      status: 'stable',
      fingerprint,
    });
    expect(compareSourceFingerprints(fingerprint, 'b'.repeat(64))).toEqual({
      status: 'changed',
    });
    expect(compareSourceFingerprints(undefined, fingerprint)).toEqual({
      status: 'unavailable',
    });
    expect(compareSourceFingerprints(fingerprint, undefined)).toEqual({
      status: 'unavailable',
    });
  });

  test('binds tracked and untracked nonignored files while excluding artifacts', () => {
    const root = mkdtempSync(join(tmpdir(), 'sovran-e2e-source-fingerprint-'));
    temporaryRoots.push(root);
    mkdirSync(join(root, 'app', 'e2e', 'artifacts'), { recursive: true });
    writeFileSync(join(root, 'tracked.txt'), 'tracked-v1');
    writeFileSync(join(root, 'untracked.txt'), 'untracked-v1');
    writeFileSync(join(root, 'app', 'e2e', 'artifacts', 'run.json'), 'artifact-v1');
    const files = ['tracked.txt', 'untracked.txt', 'app/e2e/artifacts/run.json'];

    const original = fingerprintSourceFiles(root, files);
    expect(original).toMatch(/^[0-9a-f]{64}$/);

    chmodSync(join(root, 'tracked.txt'), 0o600);
    expect(fingerprintSourceFiles(root, files)).toBe(original);
    chmodSync(join(root, 'tracked.txt'), 0o700);
    expect(fingerprintSourceFiles(root, files)).not.toBe(original);
    chmodSync(join(root, 'tracked.txt'), 0o600);

    writeFileSync(join(root, 'tracked.txt'), 'tracked-v2');
    const trackedEdit = fingerprintSourceFiles(root, files);
    expect(trackedEdit).not.toBe(original);

    writeFileSync(join(root, 'tracked.txt'), 'tracked-v1');
    writeFileSync(join(root, 'untracked.txt'), 'untracked-v2');
    const untrackedEdit = fingerprintSourceFiles(root, files);
    expect(untrackedEdit).not.toBe(original);

    writeFileSync(join(root, 'untracked.txt'), 'untracked-v1');
    writeFileSync(join(root, 'app', 'e2e', 'artifacts', 'run.json'), 'artifact-v2');
    expect(fingerprintSourceFiles(root, files)).toBe(original);

    const missing = fingerprintSourceFiles(root, [...files, 'deleted.txt']);
    expect(missing).toMatch(/^[0-9a-f]{64}$/);
    writeFileSync(join(root, 'deleted.txt'), 'restored');
    expect(fingerprintSourceFiles(root, [...files, 'deleted.txt'])).not.toBe(missing);

    mkdirSync(join(root, 'ordinary-directory'));
    expect(fingerprintSourceFiles(root, ['ordinary-directory'])).toBeUndefined();
  });

  test('enumerates from the repo root and recursively binds checked-out gitlinks', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'sovran-e2e-source-repo-')));
    temporaryRoots.push(root);
    const nested = join(root, 'vendor');
    mkdirSync(join(root, 'app', 'e2e', 'artifacts'), { recursive: true });
    mkdirSync(nested);
    writeFileSync(join(root, 'tracked.txt'), 'tracked-v1');
    writeFileSync(join(root, 'untracked.txt'), 'untracked-v1');
    writeFileSync(join(root, 'app', 'e2e', 'artifacts', 'run.json'), 'artifact-v1');
    writeFileSync(join(nested, 'nested.txt'), 'nested-v1');
    const calls: { cwd: string; args: string[] }[] = [];
    const runGit = (cwd: string, args: string[]): string | undefined => {
      calls.push({ cwd, args });
      if (args[0] === 'rev-parse') return cwd === nested ? nested : root;
      if (args[0] === 'ls-files') {
        return cwd === nested
          ? 'nested.txt\0'
          : 'app/e2e/artifacts/run.json\0tracked.txt\0untracked.txt\0vendor\0';
      }
      return undefined;
    };
    const fingerprint = () => captureSourceFingerprint(join(root, 'app', 'e2e'), { runGit });

    const original = fingerprint();
    expect(original).toMatch(/^[0-9a-f]{64}$/);
    expect(calls.some(({ cwd, args }) => cwd === root && args[0] === 'ls-files')).toBe(true);

    writeFileSync(join(root, 'tracked.txt'), 'tracked-v2');
    expect(fingerprint()).not.toBe(original);
    writeFileSync(join(root, 'tracked.txt'), 'tracked-v1');
    writeFileSync(join(root, 'untracked.txt'), 'untracked-v2');
    expect(fingerprint()).not.toBe(original);
    writeFileSync(join(root, 'untracked.txt'), 'untracked-v1');
    writeFileSync(join(nested, 'nested.txt'), 'nested-v2');
    expect(fingerprint()).not.toBe(original);
    writeFileSync(join(nested, 'nested.txt'), 'nested-v1');
    writeFileSync(join(root, 'app', 'e2e', 'artifacts', 'run.json'), 'artifact-v2');
    expect(fingerprint()).toBe(original);
  });
});
