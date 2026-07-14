import { describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { acquireFundedRunLock, clearStaleFundedRunLock, getFundedRunLockStatus } from './lock';

const root = () => mkdtempSync(join(tmpdir(), 'sovran-funded-lock-'));

describe('global funded-run serialization', () => {
  it('reports no lock without probing a process', () => {
    const isAlive = () => {
      throw new Error('must not probe');
    };
    expect(getFundedRunLockStatus(root(), isAlive)).toEqual({ status: 'none' });
  });

  it('reports active and stale ownership without changing the lock', () => {
    const artifacts = root();
    const lock = acquireFundedRunLock(artifacts, 'run-a', 1001);

    expect(getFundedRunLockStatus(artifacts, (pid) => pid === 1001)).toEqual({
      status: 'active',
      pid: 1001,
      runId: 'run-a',
    });
    expect(getFundedRunLockStatus(artifacts, () => false)).toEqual({
      status: 'stale',
      pid: 1001,
      runId: 'run-a',
    });
    expect(existsSync(lock.path)).toBe(true);
    lock.release();
  });

  it('fails closed when the lock is corrupt', () => {
    const artifacts = root();
    const path = join(artifacts, 'funded-run.lock');
    writeFileSync(path, '{not-json', { mode: 0o600 });

    expect(() => getFundedRunLockStatus(artifacts, () => false)).toThrow(/corrupt/);
    expect(existsSync(path)).toBe(true);
  });

  it('permits exactly one owner and validates ownership on release', () => {
    const artifacts = root();
    const lock = acquireFundedRunLock(artifacts, 'run-a', 1001);
    expect(() => acquireFundedRunLock(artifacts, 'run-b', 1002)).toThrow(/run-a.*active/);
    lock.release();
    expect(existsSync(lock.path)).toBe(false);
  });

  it('clears a dead lock only after stale liabilities were recovered', () => {
    const artifacts = root();
    const path = join(artifacts, 'funded-run.lock');
    writeFileSync(path, JSON.stringify({ version: 1, pid: 1001, runId: 'crashed' }), {
      mode: 0o600,
    });
    expect(() => clearStaleFundedRunLock(artifacts, false, () => false)).toThrow(/recovery/);
    clearStaleFundedRunLock(artifacts, true, () => false);
    expect(existsSync(path)).toBe(false);
  });

  it('never clears a live process lock', () => {
    const artifacts = root();
    const lock = acquireFundedRunLock(artifacts, 'live', 1001);
    expect(() => clearStaleFundedRunLock(artifacts, true, () => true)).toThrow(/already active/);
    lock.release();
  });
});
