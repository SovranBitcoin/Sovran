import { randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname } from 'node:path';

function writeAll(fd: number, content: string): void {
  const bytes = Buffer.from(content, 'utf8');
  let offset = 0;
  while (offset < bytes.length) {
    const written = writeSync(fd, bytes, offset, bytes.length - offset);
    if (written === 0) throw new Error('durable file write made no progress');
    offset += written;
  }
}

export function ensurePrivateDirectory(path: string): void {
  const existed = existsSync(path);
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`private path is not a directory: ${path}`);
  }
  const fd = openSync(path, constants.O_RDONLY);
  try {
    fchmodSync(fd, 0o700);
  } finally {
    closeSync(fd);
  }
  syncDirectory(path);
  if (!existed) syncDirectory(dirname(path));
}

export function syncDirectory(path: string): void {
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY);
    fsyncSync(fd);
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    // Some filesystems do not support fsync on a directory. File fsync and an
    // atomic same-directory rename remain the strongest portable fallback.
    if (!['EINVAL', 'ENOTSUP', 'EBADF'].includes(String(code))) throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Durably remove one file and fsync its parent directory where supported. */
export function durableUnlinkFile(path: string): void {
  unlinkSync(path);
  syncDirectory(dirname(path));
}

/**
 * Durably replace one small file without exposing a partially-written target.
 * The temp file is fsynced before a same-directory rename, then the directory
 * entry is fsynced where the host filesystem supports it.
 */
export function durableReplaceFile(path: string, content: string, mode = 0o600): void {
  const tempPath = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  let fd: number | undefined;
  try {
    fd = openSync(tempPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, mode);
    writeAll(fd, content);
    fchmodSync(fd, mode);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(tempPath, path);
    syncDirectory(dirname(path));
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(tempPath)) unlinkSync(tempPath);
    throw error;
  }
}

/**
 * Durably append one JSONL record. A crash may leave a partial final record;
 * ledger parsing intentionally treats that as corruption instead of skipping
 * it or guessing whether the corresponding value movement happened.
 */
export function durableAppendFile(path: string, content: string, mode = 0o600): void {
  const fd = openSync(path, constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY, mode);
  try {
    fchmodSync(fd, mode);
    writeAll(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  syncDirectory(dirname(path));
}

export interface DurableLease {
  readonly path: string;
  release(): void;
}

/**
 * Acquire a fail-closed cross-instance lease. A process crash deliberately
 * leaves the file behind: an uncertain value effect must be inspected instead
 * of being retried automatically by a new coordinator.
 */
export function acquireDurableLease(path: string, content: string): DurableLease {
  const leaseContent = `${content.trim()} ${randomBytes(16).toString('hex')}\n`;
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    writeAll(fd, leaseContent);
    fchmodSync(fd, 0o600);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    syncDirectory(dirname(path));
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    const code = error instanceof Error && 'code' in error ? String(error.code) : undefined;
    if (code !== 'EEXIST' && existsSync(path)) {
      unlinkSync(path);
      syncDirectory(dirname(path));
    }
    if (code === 'EEXIST') throw new Error('durable value-effect lease is already held');
    throw error;
  }

  let active = true;
  return {
    path,
    release: () => {
      if (!active) return;
      if (!existsSync(path) || readFileSync(path, 'utf8') !== leaseContent) {
        throw new Error('durable value-effect lease ownership changed');
      }
      unlinkSync(path);
      syncDirectory(dirname(path));
      active = false;
    },
  };
}
