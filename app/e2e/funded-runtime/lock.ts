import {
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fsyncSync,
  openSync,
  readFileSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';

import { durableUnlinkFile, ensurePrivateDirectory, syncDirectory } from '../ledger/durable';

interface LockRecord {
  version: 1;
  pid: number;
  runId: string;
}

export interface FundedRunLock {
  readonly path: string;
  release(): void;
}

export type FundedRunLockStatus =
  | { readonly status: 'none' }
  | {
      readonly status: 'active' | 'stale';
      readonly pid: number;
      readonly runId: string;
    };

const lockPath = (artifacts: string) => join(artifacts, 'funded-run.lock');

function parseLock(path: string): LockRecord {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('funded-run lock is corrupt');
  }
  const record = value as Partial<LockRecord>;
  if (
    record.version !== 1 ||
    !Number.isSafeInteger(record.pid) ||
    (record.pid ?? 0) <= 0 ||
    typeof record.runId !== 'string' ||
    !record.runId
  ) {
    throw new Error('funded-run lock is corrupt');
  }
  return record as LockRecord;
}

export function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Inspect the global funded-run lock without mutating it. Corrupt locks throw
 * so callers cannot mistake an unreadable ownership record for a free slot. */
export function getFundedRunLockStatus(
  artifacts: string,
  isAlive: (pid: number) => boolean = processIsAlive
): FundedRunLockStatus {
  const path = lockPath(artifacts);
  if (!existsSync(path)) return { status: 'none' };
  const record = parseLock(path);
  return {
    status: isAlive(record.pid) ? 'active' : 'stale',
    pid: record.pid,
    runId: record.runId,
  };
}

/** Clear a dead process's global funded lock only after the caller has swept
 * and re-audited every stale liability. */
export function clearStaleFundedRunLock(
  artifacts: string,
  liabilitiesAreClean: boolean,
  isAlive: (pid: number) => boolean = processIsAlive
): void {
  const path = lockPath(artifacts);
  if (!existsSync(path)) return;
  const record = parseLock(path);
  if (isAlive(record.pid)) throw new Error(`funded run ${record.runId} is already active`);
  if (!liabilitiesAreClean) {
    throw new Error('stale funded-run lock cannot be cleared before liability recovery');
  }
  durableUnlinkFile(path);
}

export function acquireFundedRunLock(
  artifacts: string,
  runId: string,
  pid = process.pid
): FundedRunLock {
  ensurePrivateDirectory(artifacts);
  const path = lockPath(artifacts);
  const content = JSON.stringify({ version: 1, pid, runId } satisfies LockRecord);
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    writeSync(fd, content);
    fchmodSync(fd, 0o600);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    syncDirectory(artifacts);
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      const existing = parseLock(path);
      throw new Error(`funded run ${existing.runId} is already active`);
    }
    throw error;
  }

  let active = true;
  return {
    path,
    release: () => {
      if (!active) return;
      if (!existsSync(path) || readFileSync(path, 'utf8') !== content) {
        throw new Error('funded-run lock ownership changed');
      }
      durableUnlinkFile(path);
      active = false;
    },
  };
}
