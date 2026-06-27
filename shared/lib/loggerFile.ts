/**
 * On-device log file transport.
 *
 * Mirrors every structured log entry into a persistent NDJSON file on the
 * device so logs survive even when the Metro/dev-server connection drops (going
 * offline kills the console transport's destination, not this one). The file is
 * one compact JSON object per line — exactly the format `log-doctor`'s
 * `parseLogInput` consumes — so an exported file drops straight into the
 * existing `bun run log-doctor` workflow.
 *
 * Design:
 * - Dev-only. Gated on `SHOW_LOGS` (the logger master switch is `__DEV__`); the
 *   whole module is inert in production builds and on web.
 * - Opt-in. Writing is gated on a runtime flag driven by the persisted
 *   `fileLoggingEnabled` setting (see settingsStore). The transport is always
 *   registered but no-ops until enabled, so toggling needs no re-init.
 * - Batched. Entries queue in memory and flush on a short interval / size
 *   threshold via the synchronous `expo-file-system` append API, keeping disk
 *   I/O off the hot logging path.
 * - Bounded. The active file rotates to a single `.prev` generation past a size
 *   cap so the on-disk footprint stays bounded over long sessions.
 *
 * Secret safety: the transport receives the same compacted, redacted `LogEntry`
 * the console transport gets — long strings/secrets are already summarized
 * upstream in `emit`. It never sees or writes raw params, tokens, or nsecs.
 */
import { Platform } from 'react-native';

import { log, SHOW_LOGS, type LogEntry } from './loggerCore';

// Lazy handle to the new (sync) expo-file-system API. Typed loosely to avoid a
// hard import in production bundles where the module is never exercised.
type ExpoFileSystem = typeof import('expo-file-system');

const LOG_DIR = 'sovran-logs';
const LOG_FILE = 'log.txt';
const PREV_FILE = 'log.prev.txt';
/** Filename used for the concatenated, shareable export in the cache dir. */
const EXPORT_FILE = 'sovran-log-export.txt';

/** Rotate the active file once it grows past this many bytes (one .prev kept). */
const MAX_BYTES = 10 * 1024 * 1024; // ~10 MB active + ~10 MB prev
/** Flush queued lines on this cadence. */
const FLUSH_INTERVAL_MS = 2000;
/** Flush early once the queue reaches this many lines (burst protection). */
const FLUSH_THRESHOLD = 200;
/** Hard cap on the in-memory queue so a wedged FS can't grow memory unbounded. */
const MAX_QUEUE = 10_000;

let enabled = false;
let registered = false;
let pending: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let fsModule: ExpoFileSystem | null = null;
let fsUnavailable = false;

function getFs(): ExpoFileSystem | null {
  if (fsUnavailable) return null;
  if (fsModule) return fsModule;
  if (Platform.OS === 'web') {
    fsUnavailable = true;
    return null;
  }
  try {
    fsModule = require('expo-file-system') as ExpoFileSystem;
    return fsModule;
  } catch {
    fsUnavailable = true;
    return null;
  }
}

/** The log directory, created on demand. Null when the FS is unavailable. */
function getLogDir(fs: ExpoFileSystem) {
  const dir = new fs.Directory(fs.Paths.document, LOG_DIR);
  if (!dir.exists) dir.create({ idempotent: true, intermediates: true });
  return dir;
}

function getActiveFile(fs: ExpoFileSystem) {
  return new fs.File(getLogDir(fs), LOG_FILE);
}

function getPrevFile(fs: ExpoFileSystem) {
  return new fs.File(getLogDir(fs), PREV_FILE);
}

/** Move the active file to its single `.prev` generation once it's too big. */
function rotateIfNeeded(fs: ExpoFileSystem, incomingBytes: number): void {
  const active = getActiveFile(fs);
  if (!active.exists) return;
  if (active.size + incomingBytes <= MAX_BYTES) return;
  const prev = getPrevFile(fs);
  if (prev.exists) prev.delete();
  // SDK 56: File.move() is now async; rotateIfNeeded is a sync path, so use moveSync().
  active.moveSync(prev);
}

function clearFlushTimer(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushSync();
  }, FLUSH_INTERVAL_MS);
}

/**
 * Drain the queue to disk. Synchronous (the new expo-file-system write API is
 * sync and fast for small appends); only ever called off the render path from
 * the flush timer, the size-threshold trip, or an explicit export/clear.
 */
function flushSync(): void {
  if (pending.length === 0) return;
  const fs = getFs();
  if (!fs) {
    // No FS — drop the backlog rather than grow memory forever.
    pending = [];
    return;
  }
  const batch = pending;
  pending = [];
  try {
    const text = batch.join('\n') + '\n';
    rotateIfNeeded(fs, text.length);
    const active = getActiveFile(fs);
    if (!active.exists) active.create();
    active.write(text, { append: true });
  } catch {
    // Re-queue the batch (bounded) so a transient failure doesn't lose logs,
    // unless that would blow the cap — then drop oldest.
    pending = batch.concat(pending).slice(-MAX_QUEUE);
  }
}

const fileTransport = (entry: LogEntry): void => {
  if (!enabled) return;
  pending.push(JSON.stringify(entry));
  if (pending.length >= MAX_QUEUE) pending = pending.slice(-MAX_QUEUE);
  if (pending.length >= FLUSH_THRESHOLD) {
    clearFlushTimer();
    flushSync();
  } else {
    scheduleFlush();
  }
};

/**
 * Enable or disable on-device file logging. Idempotent. Wired from the
 * persisted `fileLoggingEnabled` setting (toggle + hydration). No-op in
 * production / on web. Registers the transport lazily on first enable.
 */
export function applyFileLogging(next: boolean): void {
  if (!SHOW_LOGS) return;
  if (next && !registered) {
    log.addTransport(fileTransport);
    registered = true;
  }
  if (enabled === next) return;
  enabled = next;
  log.info('logger.file.toggle', { enabled: next });
  if (!next) {
    // Flush whatever's buffered so the file reflects everything up to the
    // moment logging was turned off.
    clearFlushTimer();
    flushSync();
  }
}

/** Force any buffered entries to disk now (used before export). */
function flushLogFileNow(): void {
  clearFlushTimer();
  flushSync();
}

export interface LogFileInfo {
  enabled: boolean;
  /** Total bytes across the active + previous files. */
  bytes: number;
  /** True when an on-disk log file exists. */
  exists: boolean;
  /** Absolute file URI of the active log file (for display/debug). */
  uri: string | null;
}

/** Snapshot of the current on-device log file state for the settings UI. */
export function getLogFileInfo(): LogFileInfo {
  const fs = getFs();
  if (!fs) return { enabled, bytes: 0, exists: false, uri: null };
  try {
    const active = getActiveFile(fs);
    const prev = getPrevFile(fs);
    const bytes = (active.exists ? active.size : 0) + (prev.exists ? prev.size : 0);
    return { enabled, bytes, exists: active.exists || prev.exists, uri: active.uri };
  } catch {
    return { enabled, bytes: 0, exists: false, uri: null };
  }
}

/**
 * Build a single shareable NDJSON file (previous generation + active, in
 * chronological order) and open the system share sheet. Returns false when
 * there's nothing to export or sharing is unavailable.
 */
export async function exportLogFile(): Promise<boolean> {
  if (!SHOW_LOGS) return false;
  flushLogFileNow();
  const fs = getFs();
  if (!fs) return false;

  const active = getActiveFile(fs);
  const prev = getPrevFile(fs);
  if (!active.exists && !prev.exists) return false;

  const exportFile = new fs.File(fs.Paths.cache, EXPORT_FILE);
  if (exportFile.exists) exportFile.delete();
  exportFile.create();
  if (prev.exists) exportFile.write(prev.textSync(), { append: true });
  if (active.exists) exportFile.write(active.textSync(), { append: true });

  const Sharing = require('expo-sharing') as typeof import('expo-sharing');
  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(exportFile.uri, {
    mimeType: 'application/x-ndjson',
    dialogTitle: 'Export Sovran Logs',
    UTI: 'public.plain-text',
  });
  return true;
}

/** Delete the on-device log files and clear the in-memory queue. */
export function clearLogFile(): void {
  clearFlushTimer();
  pending = [];
  const fs = getFs();
  if (!fs) return;
  try {
    const active = getActiveFile(fs);
    const prev = getPrevFile(fs);
    if (active.exists) active.delete();
    if (prev.exists) prev.delete();
  } catch {
    // Best-effort cleanup.
  }
}
