/**
 * LLM-Optimized Structured Logger — Sovran / Expo Edition
 *
 * Designed for React Native + Expo + TypeScript apps.
 * Produces logs that are maximally useful when pasted into an LLM for debugging.
 *
 * DESIGN PRINCIPLES (informed by the ReLog paper, arxiv 2603.29122):
 *
 * 1. TRACEABILITY — Every log has file/func/line + session/correlation IDs
 *    so an LLM can reconstruct the execution path.
 *
 * 2. STATE VISIBILITY — Smart value summarization ensures key variables are
 *    recorded without verbosity. Long strings (JWTs, pubkeys, base64) become
 *    { _kind, len, preview } summaries.
 *
 * 3. CAUSAL LINKAGE — Logs explain WHY something happened, not just WHAT.
 *    The useWhyDidUpdate hook shows exactly which prop changed and suggests
 *    the fix. The navigation logger shows the from→to breadcrumb trail.
 *
 * TIMING FEATURES:
 *   - Monotonic _t field on every entry (performance.now based, immune to clock skew)
 *   - timed() wraps async ops with auto-logged start/end/duration + slow-escalation
 *   - startSpan() for manual span-like timing across multi-step operations
 *   - duration_ms on span-end entries — pre-computed so LLMs don't do timestamp math
 *
 * EXPO-SPECIFIC FEATURES:
 *   - Auto-enriches logs with device info from expo-constants
 *   - Expo session ID for correlating logs across a single app launch
 *   - Ring buffer keeps last N logs in memory for crash context
 *   - Optional file persistence via expo-file-system
 *   - Optional Sentry breadcrumb transport
 *   - Async emission via requestIdleCallback (no frame drops)
 *   - Production-safe: debug/info suppressed, no console.log bridge overhead
 *   - <Screen> wrapper for automatic UI content logging
 *   - useLoggedQuery for drift-free data-layer instrumentation
 *   - Domain child loggers (cashuLog, nostrLog, walletLog, etc.)
 */

import { useEffect, useRef, useContext, createContext } from 'react';
import React, { Component, type ReactNode, type ErrorInfo } from 'react';
import { Platform } from 'react-native';

// ─── Types ───────────────────────────────────────────────────────────────────

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

interface LoggerOptions {
  /** Minimum level to emit. Default: 'debug' in __DEV__, 'warn' in production */
  level?: LogLevel;
  /** Static fields merged into every log entry */
  context?: Record<string, unknown>;
  /** Max string length before summarization. Default: 120 */
  maxStringLength?: number;
  /** Max array items before truncating. Default: 5 */
  maxArrayItems?: number;
  /** Max object nesting depth. Default: 4 */
  maxDepth?: number;
  /** Max object keys before truncating. Default: 15 */
  maxObjectKeys?: number;
  /** Custom output function(s). Can provide multiple transports. */
  transports?: ((entry: LogEntry) => void)[];
  /** Pretty-print JSON. Default: __DEV__ */
  pretty?: boolean;
  /** Defer emission via requestIdleCallback. Default: true */
  async?: boolean;
  /** Disable all logging. Default: false */
  enabled?: boolean;
  /**
   * Size of the in-memory ring buffer. Keeps last N log entries available
   * for crash reports or on-demand export. Default: 100
   */
  ringBufferSize?: number;
}

interface LogEntry {
  ts: string;
  /** Monotonic ms since app start via performance.now(). Subtract any two _t values
   *  to find the gap — immune to clock skew, sub-ms precision. */
  _t: number;
  level: LogLevel;
  /** Dot-separated event name: "auth.token.refresh", "render.excess", "nav.change" */
  event: string;
  src: { file: string; func: string; line: number };
  params?: Record<string, unknown>;
  ctx?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack: string[];
    properties?: Record<string, unknown>;
  };
  /** Expo session + device metadata (only on first log or when requested) */
  device?: Record<string, unknown>;
  /** Present on span-end logs: duration in ms, from monotonic clock */
  duration_ms?: number;
}

export interface Span {
  /** End the span. Logs `${event}.end` with duration_ms. Auto-escalates to warn if slow. */
  end(params?: Record<string, unknown>): void;
}

export interface Logger {
  debug(event: string, params?: Record<string, unknown>): void;
  info(event: string, params?: Record<string, unknown>): void;
  warn(event: string, params?: Record<string, unknown>): void;
  error(event: string, params?: Record<string, unknown>): void;
  fatal(event: string, params?: Record<string, unknown>): void;
  child(context: Record<string, unknown>): Logger;
  setLevel(level: LogLevel): void;
  /** Get the ring buffer contents (useful for crash reports or LLM context dumps) */
  getRecentLogs(): LogEntry[];
  /** Clear the ring buffer */
  clearRecentLogs(): void;
  /** Flush ring buffer to a string suitable for pasting into an LLM */
  dumpForLLM(): string;
  /**
   * Wrap an async operation. Logs `${event}.start` at debug, then on completion
   * logs `${event}.end` with duration_ms. Auto-escalates to warn if duration
   * exceeds warnThresholdMs (default 1000ms).
   *
   * Usage:
   *   const result = await log.timed('cashu.swap', () => doSwap(token));
   *   const data = await log.timed('api.fetchProfile', () => fetch(url), { warnThresholdMs: 3000 });
   */
  timed<T>(
    event: string,
    fn: () => Promise<T>,
    opts?: { params?: Record<string, unknown>; warnThresholdMs?: number }
  ): Promise<T>;
  /**
   * Start a manual span for operations that aren't a single async call.
   * Call span.end() when the operation finishes.
   *
   * Usage:
   *   const span = log.startSpan('mint.rebalance', { fromMint, toMint });
   *   // ... do work ...
   *   span.end({ proofCount: 5 });
   */
  startSpan(event: string, params?: Record<string, unknown>): Span;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const LEVEL_SEVERITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

const LEVEL_CONSOLE_METHOD: Record<LogLevel, 'debug' | 'info' | 'warn' | 'error'> = {
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error',
  fatal: 'error',
};

const IS_DEV = typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';

// ─── Monotonic Clock ────────────────────────────────────────────────────────
//
// performance.now() is monotonic (immune to system clock skew), sub-ms precision,
// and available in Hermes. Falls back to Date.now() in environments without it.
// Unlike Date.now(), the values always increase at a constant rate independent
// of the system clock — no negative durations from NTP adjustments.

const _perfNow: () => number =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? () => performance.now()
    : () => Date.now();

/** Monotonic ms since module load. Use for all duration math. */
const _t0 = _perfNow();
function now(): number {
  return Math.round((_perfNow() - _t0) * 100) / 100;
}

// ─── Expo Device Info (lazy-loaded) ──────────────────────────────────────────

let _cachedDeviceInfo: Record<string, unknown> | null = null;

function getExpoDeviceInfo(): Record<string, unknown> {
  if (_cachedDeviceInfo) return _cachedDeviceInfo;

  try {
    // These are optional imports — the logger works without them
    const Constants = require('expo-constants').default;
    const config = Constants.expoConfig;

    _cachedDeviceInfo = {
      platform: Platform.OS,
      osVersion: Platform.Version,
      appName: config?.name,
      appVersion: config?.version,
      expoSessionId: Constants.sessionId,
      isDevice: Constants.isDevice,
      // executionEnvironment tells you: 'bare', 'standalone', or 'storeClient' (Expo Go)
      execEnv: Constants.executionEnvironment,
    };
  } catch {
    // expo-constants not available (e.g. in tests or non-Expo RN)
    _cachedDeviceInfo = {
      platform: Platform.OS,
      osVersion: Platform.Version,
    };
  }

  return _cachedDeviceInfo;
}

// ─── Value Summarization ─────────────────────────────────────────────────────
//
// Instead of dumping a 2KB public key or a massive JSON blob, these functions
// detect known verbose patterns and replace them with a compact summary:
//   { _kind: "jwt", len: 512, preview: "eyJhbGciOi…" }
// An LLM sees that and knows exactly what it is without wading through noise.

const VERBOSE_STRING_PATTERNS: { name: string; test: (s: string) => boolean }[] = [
  { name: 'jwt', test: (s) => /^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(s) },
  { name: 'base64', test: (s) => /^[A-Za-z0-9+/]{60,}={0,2}$/.test(s) },
  { name: 'hex', test: (s) => /^(0x)?[0-9a-fA-F]{40,}$/.test(s) },
  { name: 'pem_key', test: (s) => s.includes('-----BEGIN') },
  { name: 'data_uri', test: (s) => /^data:[^;]+;base64,/.test(s) },
  {
    name: 'uuid',
    test: (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
  },
  { name: 'url', test: (s) => /^https?:\/\/.{80,}/.test(s) },
  { name: 'json_blob', test: (s) => s.length > 200 && (s[0] === '{' || s[0] === '[') },
  { name: 'xml_blob', test: (s) => s.length > 200 && s.trimStart().startsWith('<') },
  { name: 'connection_str', test: (s) => /^(postgres|mysql|mongodb|redis|wss?):\/\//.test(s) },
  {
    name: 'npub_or_nsec',
    test: (s) => /^(npub|nsec)1[023456789acdefghjklmnpqrstuvwxyz]{58}$/.test(s),
  },
  { name: 'cashu_token', test: (s) => s.startsWith('cashuA') || s.startsWith('cashuB') },
  { name: 'lightning_invoice', test: (s) => /^ln(bc|tb|tbs)[0-9a-z]{50,}/i.test(s) },
  { name: 'solana_pubkey', test: (s) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s) && s.length >= 32 },
];

function detectStringType(s: string): string | null {
  for (const pattern of VERBOSE_STRING_PATTERNS) {
    if (pattern.test(s)) return pattern.name;
  }
  return null;
}

function summarizeString(s: string, maxLen: number): unknown {
  if (s.length <= maxLen) return s;
  const detectedType = detectStringType(s);
  const preview = s.slice(0, 32);
  return { _kind: detectedType ?? 'long_string', len: s.length, preview: preview + '…' };
}

export function compactValue(
  value: unknown,
  opts: { maxStringLength: number; maxArrayItems: number; maxDepth: number; maxObjectKeys: number },
  depth: number = 0
): unknown {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  )
    return value;
  if (typeof value === 'string') return summarizeString(value, opts.maxStringLength);
  if (value instanceof Error) {
    return {
      _kind: 'error',
      name: value.name,
      message: value.message,
      stack: (value.stack ?? '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, 10),
    };
  }
  if (value instanceof Date) return { _kind: 'date', iso: value.toISOString() };
  if (value instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)))
    return { _kind: 'buffer', bytes: (value as Uint8Array).byteLength };
  if (value instanceof RegExp) return { _kind: 'regexp', source: value.toString() };
  if (value instanceof Map) {
    const obj: Record<string, unknown> = {};
    let count = 0;
    for (const [k, v] of value) {
      if (count >= opts.maxObjectKeys) {
        obj[`…${value.size - count}_more`] = true;
        break;
      }
      obj[String(k)] = compactValue(v, opts, depth + 1);
      count++;
    }
    return { _kind: 'map', size: value.size, entries: obj };
  }
  if (value instanceof Set) {
    return {
      _kind: 'set',
      size: value.size,
      sample: [...value].slice(0, opts.maxArrayItems).map((v) => compactValue(v, opts, depth + 1)),
    };
  }
  if (Array.isArray(value)) {
    if (depth >= opts.maxDepth) return { _kind: 'array', length: value.length };
    const items = value.slice(0, opts.maxArrayItems).map((v) => compactValue(v, opts, depth + 1));
    if (value.length > opts.maxArrayItems) items.push(`…${value.length - opts.maxArrayItems} more`);
    return items;
  }
  if (typeof value === 'function') return { _kind: 'function', name: value.name || 'anon' };
  if (typeof value === 'object') {
    if (depth >= opts.maxDepth) {
      const keys = Object.keys(value as object);
      return { _kind: 'object', keys: keys.length, sample: keys.slice(0, 8) };
    }
    return compactPlainObject(value as Record<string, unknown>, opts, depth);
  }
  return String(value);
}

function compactPlainObject(
  obj: Record<string, unknown>,
  opts: { maxStringLength: number; maxArrayItems: number; maxDepth: number; maxObjectKeys: number },
  depth: number
): Record<string, unknown> {
  const keys = Object.keys(obj);
  const result: Record<string, unknown> = {};
  const limit = Math.min(keys.length, opts.maxObjectKeys);
  for (let i = 0; i < limit; i++) result[keys[i]] = compactValue(obj[keys[i]], opts, depth + 1);
  if (keys.length > opts.maxObjectKeys) result[`…${keys.length - opts.maxObjectKeys}_more`] = true;
  return result;
}

// ─── Source Location ─────────────────────────────────────────────────────────

interface SourceLocation {
  file: string;
  func: string;
  line: number;
}

function getCallerLocation(stackOffset: number = 3): SourceLocation {
  const fallback: SourceLocation = { file: 'unknown', func: 'unknown', line: 0 };
  try {
    const stack = new Error().stack;
    if (!stack) return fallback;
    const lines = stack.split('\n');
    const target = lines[stackOffset];
    if (!target) return fallback;
    // Standard V8/Hermes format: "at functionName (file:line:col)"
    let match = target.match(/at\s+(.+?)\s+\((.+):(\d+):\d+\)/);
    if (match)
      return { func: match[1], file: simplifyPath(match[2]), line: parseInt(match[3], 10) };
    // Anonymous format: "at file:line:col"
    match = target.match(/at\s+(.+):(\d+):\d+/);
    if (match)
      return { func: '<anonymous>', file: simplifyPath(match[1]), line: parseInt(match[2], 10) };
    return fallback;
  } catch {
    return fallback;
  }
}

function simplifyPath(fullPath: string): string {
  const cleaned = fullPath.replace(/^file:\/\//, '').replace(/\?.*$/, '');
  const parts = cleaned.split(/[\\/]/);
  return parts.slice(-3).join('/');
}

// ─── Async Emission ──────────────────────────────────────────────────────────
//
// React Native bridge communication is expensive. Deferring log emission to
// idle time prevents frame drops. Fatal logs are always synchronous so they're
// captured before a crash.

type IdleCallback = (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void;
const scheduleIdle: (cb: IdleCallback) => void =
  typeof requestIdleCallback !== 'undefined'
    ? requestIdleCallback
    : (cb) => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 50 }), 1);

// ─── Ring Buffer ─────────────────────────────────────────────────────────────
//
// Keeps the last N log entries in memory. When an error/crash occurs, you can
// call dumpForLLM() to get the recent log history as a single string that
// provides an LLM with full context for debugging.

class RingBuffer<T> {
  private buffer: (T | undefined)[];
  private head = 0;
  private count = 0;

  constructor(private capacity: number) {
    this.buffer = new Array(capacity);
  }

  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  getAll(): T[] {
    if (this.count === 0) return [];
    const result: T[] = [];
    const start = this.count < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % this.capacity;
      result.push(this.buffer[idx] as T);
    }
    return result;
  }

  clear(): void {
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this.count = 0;
  }
}

// ─── Built-in Transports ─────────────────────────────────────────────────────

/** Console transport (default). Safe — never throws. */
export function consoleTransport(pretty: boolean) {
  return (entry: LogEntry): void => {
    const method = LEVEL_CONSOLE_METHOD[entry.level];
    try {
      const serialized = pretty ? JSON.stringify(entry, null, 2) : JSON.stringify(entry);
      if (serialized != null) console[method](serialized);
    } catch {
      // Circular reference or non-serializable value — fall back to safe output
      console[method](`[${entry.level}] ${entry.event}`, entry.params ?? '');
    }
  };
}

/**
 * Sentry breadcrumb transport.
 * Adds each log as a Sentry breadcrumb so errors have full context.
 * Usage: createLogger({ transports: [sentryTransport(Sentry)] })
 */
export function sentryTransport(Sentry: any) {
  return (entry: LogEntry): void => {
    const level =
      entry.level === 'fatal'
        ? 'fatal'
        : entry.level === 'error'
          ? 'error'
          : entry.level === 'warn'
            ? 'warning'
            : 'info';

    Sentry.addBreadcrumb({
      category: entry.event,
      message: entry.params ? JSON.stringify(entry.params) : undefined,
      level,
      data: {
        src: `${entry.src.file}:${entry.src.line}`,
        ...entry.ctx,
      },
    });

    // Also report errors/fatals as Sentry events
    if (entry.error && (entry.level === 'error' || entry.level === 'fatal')) {
      Sentry.captureException(new Error(`[${entry.event}] ${entry.error.message}`), {
        extra: { logEntry: entry },
      });
    }
  };
}

/**
 * File transport using expo-file-system.
 * Writes logs as newline-delimited JSON to a daily log file.
 * Usage: createLogger({ transports: [fileTransport()] })
 */
export function fileTransport(options?: { directory?: string; maxFileSizeMB?: number }) {
  const maxSize = (options?.maxFileSizeMB ?? 5) * 1024 * 1024;
  let writeQueue: string[] = [];
  let flushing = false;

  const getFilePath = () => {
    try {
      const FileSystem = require('expo-file-system');
      const dir = options?.directory ?? FileSystem.documentDirectory + 'logs/';
      const date = new Date().toISOString().split('T')[0];
      return { FileSystem, dir, path: dir + `sovran_${date}.log` };
    } catch {
      return null;
    }
  };

  const flush = async () => {
    if (flushing || writeQueue.length === 0) return;
    flushing = true;
    const batch = writeQueue.splice(0);
    try {
      const fs = getFilePath();
      if (!fs) return;
      const { FileSystem, dir, path } = fs;

      // Ensure directory exists
      const dirInfo = await FileSystem.getInfoAsync(dir);
      if (!dirInfo.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });

      // Check file size — rotate if too large
      const fileInfo = await FileSystem.getInfoAsync(path);
      if (fileInfo.exists && (fileInfo.size ?? 0) > maxSize) {
        await FileSystem.moveAsync({ from: path, to: path.replace('.log', '.prev.log') });
      }

      await FileSystem.writeAsStringAsync(path, batch.join('\n') + '\n', {
        encoding: 'utf8',
      });
    } catch {
      // Silently fail — logging should never crash the app
    } finally {
      flushing = false;
      if (writeQueue.length > 0) flush();
    }
  };

  return (entry: LogEntry): void => {
    writeQueue.push(JSON.stringify(entry));
    // Debounce writes: flush every 500ms or when buffer hits 20 entries
    if (writeQueue.length >= 20) {
      flush();
    } else {
      setTimeout(flush, 500);
    }
  };
}

// ─── Logger Factory ──────────────────────────────────────────────────────────

export function createLogger(options: LoggerOptions = {}): Logger {
  const {
    level = IS_DEV ? 'debug' : 'warn',
    context = {},
    maxStringLength = 120,
    maxArrayItems = 5,
    maxDepth = 4,
    maxObjectKeys = 15,
    transports = [consoleTransport(options.pretty ?? IS_DEV)],
    async = true,
    enabled = true,
    ringBufferSize = 100,
  } = options;

  let minSeverity = LEVEL_SEVERITY[level];
  const compactOpts = { maxStringLength, maxArrayItems, maxDepth, maxObjectKeys };
  const ringBuffer = new RingBuffer<LogEntry>(ringBufferSize);
  let hasLoggedDevice = false;

  function emit(logLevel: LogLevel, event: string, params?: Record<string, unknown>): void {
    if (!enabled) return;
    if (LEVEL_SEVERITY[logLevel] < minSeverity) return;

    const src = getCallerLocation(3);

    let errorInfo: LogEntry['error'] | undefined;
    let cleanParams: Record<string, unknown> | undefined;

    if (params) {
      cleanParams = {};
      for (const [key, val] of Object.entries(params)) {
        if (val instanceof Error) {
          errorInfo = {
            name: val.name,
            message: val.message,
            stack: (val.stack ?? '')
              .split('\n')
              .map((l) => l.trim())
              .filter(Boolean)
              .slice(0, 10),
          };
          const extraKeys = Object.keys(val).filter(
            (k) => !['name', 'message', 'stack'].includes(k)
          );
          if (extraKeys.length > 0) {
            const extras: Record<string, unknown> = {};
            for (const ek of extraKeys) extras[ek] = compactValue((val as any)[ek], compactOpts);
            errorInfo.properties = extras;
          }
        } else {
          cleanParams[key] = compactValue(val, compactOpts);
        }
      }
      if (Object.keys(cleanParams).length === 0) cleanParams = undefined;
    }

    const entry: LogEntry = {
      ts: new Date().toISOString(),
      _t: now(),
      level: logLevel,
      event,
      src,
      ...(Object.keys(context).length > 0 ? { ctx: context } : {}),
      ...(cleanParams ? { params: cleanParams } : {}),
      ...(errorInfo ? { error: errorInfo } : {}),
    };

    // Attach device info on first log entry (gives LLM the env context once)
    if (!hasLoggedDevice) {
      entry.device = getExpoDeviceInfo();
      hasLoggedDevice = true;
    }

    // Always push to ring buffer (even if async)
    ringBuffer.push(entry);

    const write = () => {
      for (const transport of transports) {
        try {
          transport(entry);
        } catch {
          /* transport errors should never crash the app */
        }
      }
    };

    if (async && logLevel !== 'fatal') {
      scheduleIdle(write);
    } else {
      write(); // Fatal is always synchronous — must be captured before crash
    }
  }

  const logger: Logger = {
    debug: (event, params) => emit('debug', event, params),
    info: (event, params) => emit('info', event, params),
    warn: (event, params) => emit('warn', event, params),
    error: (event, params) => emit('error', event, params),
    fatal: (event, params) => emit('fatal', event, params),
    child: (childContext) =>
      createLogger({
        level:
          (Object.keys(LEVEL_SEVERITY) as LogLevel[]).find(
            (k) => LEVEL_SEVERITY[k] === minSeverity
          ) ?? 'debug',
        context: { ...context, ...childContext },
        maxStringLength,
        maxArrayItems,
        maxDepth,
        maxObjectKeys,
        transports,
        async,
        enabled,
        ringBufferSize,
      }),
    setLevel: (newLevel) => {
      minSeverity = LEVEL_SEVERITY[newLevel];
    },
    getRecentLogs: () => ringBuffer.getAll(),
    clearRecentLogs: () => ringBuffer.clear(),
    dumpForLLM: () => {
      const logs = ringBuffer.getAll();
      if (logs.length === 0) return '(no recent logs)';
      const header = [
        '=== SOVRAN APP LOG DUMP ===',
        `Entries: ${logs.length}`,
        `Time range: ${logs[0].ts} → ${logs[logs.length - 1].ts}`,
        `Device: ${JSON.stringify(getExpoDeviceInfo())}`,
        '_t = monotonic ms from app start (subtract any two to find gap)',
        'duration_ms = explicit span duration (present on .end events)',
        '===========================',
        '',
      ].join('\n');
      return header + logs.map((e) => JSON.stringify(e)).join('\n');
    },

    timed: async <T>(
      event: string,
      fn: () => Promise<T>,
      opts?: { params?: Record<string, unknown>; warnThresholdMs?: number }
    ): Promise<T> => {
      const threshold = opts?.warnThresholdMs ?? 1000;
      emit('debug', `${event}.start`, opts?.params);
      const t0 = _perfNow();
      try {
        const result = await fn();
        const duration_ms = Math.round((_perfNow() - t0) * 100) / 100;
        const level: LogLevel = duration_ms > threshold ? 'warn' : 'debug';
        const endParams: Record<string, unknown> = { ...opts?.params, duration_ms };
        if (duration_ms > threshold) {
          endParams._slow = true;
          endParams._threshold_ms = threshold;
        }
        emit(level, `${event}.end`, endParams);
        return result;
      } catch (error) {
        const duration_ms = Math.round((_perfNow() - t0) * 100) / 100;
        emit('error', `${event}.error`, {
          ...opts?.params,
          duration_ms,
          error: error instanceof Error ? error : new Error(String(error)),
        });
        throw error;
      }
    },

    startSpan: (event: string, params?: Record<string, unknown>): Span => {
      emit('debug', `${event}.start`, params);
      const t0 = _perfNow();
      let ended = false;
      return {
        end: (endParams?: Record<string, unknown>) => {
          if (ended) return; // guard against double-end
          ended = true;
          const duration_ms = Math.round((_perfNow() - t0) * 100) / 100;
          const merged: Record<string, unknown> = { ...params, ...endParams, duration_ms };
          // Auto-escalate: >1s = warn, >5s = error
          const level: LogLevel =
            duration_ms > 5000 ? 'error' : duration_ms > 1000 ? 'warn' : 'debug';
          if (duration_ms > 1000) {
            merged._slow = true;
          }
          emit(level, `${event}.end`, merged);
        },
      };
    },
  };

  return logger;
}

// ─── Default instance ────────────────────────────────────────────────────────

export const log = createLogger({
  context: { app: 'sovran' },
  ringBufferSize: 200,
});

// ─── Init Timing Helper ──────────────────────────────────────────────────────
// Drop-in replacement for initLog() from initTiming.ts.
// Emits a structured info log with the monotonic ms offset from app start.

export function initLog(tag: string, msg: string): void {
  log.info('init.timing', { tag, msg, offsetMs: now() });
}

// ─── Domain Child Loggers ────────────────────────────────────────────────────
// Use these in the matching domain instead of the bare `log` export.

export const nfcLog = log.child({ module: 'nfc' });
export const cashuLog = log.child({ module: 'cashu' });
export const nostrLog = log.child({ module: 'nostr' });
export const walletLog = log.child({ module: 'wallet' });
export const paymentLog = log.child({ module: 'payment' });
export const feedLog = log.child({ module: 'feed' });
export const navLog = log.child({ module: 'nav' });
export const apiLog = log.child({ module: 'api' });
export const storeLog = log.child({ module: 'store' });

// ═══════════════════════════════════════════════════════════════════════════════
// REACT HOOKS — Render & Performance Debugging
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Track render count for a component. Escalates to 'warn' after threshold.
 *
 * Usage:
 *   function MyComponent() {
 *     useRenderLogger('MyComponent');
 *     // ...
 *   }
 */
export function useRenderLogger(
  componentName: string,
  warnAfter: number = 20,
  logger: Logger = log
): void {
  return; // KILL_SWITCH
  const renderCount = useRef(0);
  const mountTime = useRef(_perfNow());
  renderCount.current += 1;

  useEffect(() => {
    const count = renderCount.current;
    const aliveMs = Math.round((_perfNow() - mountTime.current) * 100) / 100;
    const level = count > warnAfter ? 'warn' : 'debug';
    logger[level]('render.count', {
      component: componentName,
      renders: count,
      aliveMs,
      rendersPerSec: aliveMs > 0 ? Math.round((count / aliveMs) * 1000 * 100) / 100 : 0,
    });
  });

  useEffect(() => {
    logger.debug('component.mount', { component: componentName });
    return () => {
      logger.debug('component.unmount', {
        component: componentName,
        totalRenders: renderCount.current,
        aliveMs: Math.round((_perfNow() - mountTime.current) * 100) / 100,
      });
    };
  }, []);
}

/**
 * Log exactly which props changed and WHY a re-render happened.
 * Includes actionable hints (useCallback, useMemo) for LLM debugging.
 *
 * Usage:
 *   function UserCard({ user, onPress }) {
 *     useWhyDidUpdate('UserCard', { user, onPress });
 *     // ...
 *   }
 */
export function useWhyDidUpdate(
  componentName: string,
  currentProps: Record<string, unknown>,
  logger: Logger = log
): void {
  return; // KILL_SWITCH
  const prevProps = useRef<Record<string, unknown> | undefined>(undefined);
  const compactOpts = { maxStringLength: 80, maxArrayItems: 3, maxDepth: 2, maxObjectKeys: 8 };

  useEffect(() => {
    if (prevProps.current !== undefined) {
      const changes: Record<string, unknown> = {};
      const allKeys = new Set([...Object.keys(prevProps.current), ...Object.keys(currentProps)]);

      for (const key of allKeys) {
        const prev = prevProps.current[key];
        const curr = currentProps[key];
        if (!Object.is(prev, curr)) {
          const change: Record<string, unknown> = {
            from: compactValue(prev, compactOpts),
            to: compactValue(curr, compactOpts),
          };
          if (typeof prev === typeof curr) {
            if (typeof prev === 'function')
              change.hint = 'function reference changed — wrap in useCallback()';
            else if (typeof prev === 'object' && prev !== null && curr !== null)
              change.hint = Array.isArray(prev)
                ? 'array reference changed — wrap in useMemo() or extract outside render'
                : 'object reference changed — wrap in useMemo() or extract outside component';
          } else if (prev === undefined) change.hint = 'new prop added';
          else if (curr === undefined) change.hint = 'prop removed';
          changes[key] = change;
        }
      }

      if (Object.keys(changes).length > 0) {
        logger.debug('render.why', {
          component: componentName,
          changedProps: Object.keys(changes),
          changes,
        });
      }
    }
    prevProps.current = { ...currentProps };
  });
}

/**
 * Drop-in useState wrapper that logs every state transition.
 *
 * Usage:
 *   const [count, setCount] = useStateLogger('Counter', 'count', 0);
 */
export function useStateLogger<T>(
  componentName: string,
  stateName: string,
  initialValue: T,
  logger: Logger = log
): [T, (value: T | ((prev: T) => T)) => void] {
  return React.useState<T>(initialValue); // KILL_SWITCH
  const [state, _setState] = React.useState<T>(initialValue);
  const compactOpts = { maxStringLength: 80, maxArrayItems: 3, maxDepth: 2, maxObjectKeys: 8 };

  const setState = React.useCallback(
    (value: T | ((prev: T) => T)) => {
      _setState((prev) => {
        const next = typeof value === 'function' ? (value as (prev: T) => T)(prev) : value;
        if (!Object.is(prev, next)) {
          logger.debug('state.change', {
            component: componentName,
            state: stateName,
            from: compactValue(prev, compactOpts),
            to: compactValue(next, compactOpts),
          });
        }
        return next;
      });
    },
    [componentName, stateName]
  );

  return [state, setState];
}

/** Logs mount and unmount events for a component. */
export function useLifecycleLogger(componentName: string, logger: Logger = log): void {
  return; // KILL_SWITCH
  useEffect(() => {
    logger.info('lifecycle.mount', { component: componentName });
    return () => logger.info('lifecycle.unmount', { component: componentName });
  }, []);
}

// ═══════════════════════════════════════════════════════════════════════════════
// DATA LAYER INSTRUMENTATION — useLoggedQuery
// ═══════════════════════════════════════════════════════════════════════════════
//
// Instead of manually mirroring UI state in log calls (which drifts from
// reality), instrument the DATA that drives the screen. The data IS the
// screen content — the component is just a template over it.
//
// This hook wraps the return value of any data hook and logs its shape +
// key values automatically. It cannot drift because it reads the actual
// return value of the hook.

/**
 * Wrap any data hook's return value to automatically log its shape and changes.
 *
 * Usage:
 *   const { profile, isLoading, error } = useLoggedQuery('ProfileScreen', useProfile(userId));
 *   // Logs: { event: "query.result", params: { source: "ProfileScreen", data: { ... } } }
 *   // On change: { event: "query.diff", params: { source: "ProfileScreen", changes: { ... } } }
 */
export function useLoggedQuery<T extends Record<string, unknown>>(
  source: string,
  queryResult: T,
  logger: Logger = log
): T {
  return queryResult; // KILL_SWITCH
  const compactOpts = { maxStringLength: 80, maxArrayItems: 3, maxDepth: 2, maxObjectKeys: 10 };
  const prevSnapshot = useRef<string | undefined>(undefined);

  useEffect(() => {
    const compacted = compactValue(queryResult, compactOpts) as Record<string, unknown>;
    const snapshot = JSON.stringify(compacted);

    if (prevSnapshot.current === undefined) {
      logger.debug('query.result', { source, data: compacted });
    } else if (snapshot !== prevSnapshot.current) {
      try {
        const prev = JSON.parse(prevSnapshot.current) as Record<string, unknown>;
        const changes: Record<string, unknown> = {};
        const allKeys = new Set([...Object.keys(prev), ...Object.keys(compacted)]);
        for (const key of allKeys) {
          if (JSON.stringify(prev[key]) !== JSON.stringify(compacted[key])) {
            changes[key] = { from: prev[key], to: compacted[key] };
          }
        }
        if (Object.keys(changes).length > 0) {
          logger.debug('query.diff', { source, changes });
        }
      } catch {
        logger.debug('query.result', { source, data: compacted });
      }
    }

    prevSnapshot.current = snapshot;
  });

  return queryResult;
}

// ═══════════════════════════════════════════════════════════════════════════════
// UI CONTENT LOGGING — <Screen> wrapper + UIPath context
// ═══════════════════════════════════════════════════════════════════════════════
//
// Gives an LLM "eyes" into what the user sees, without screenshots.
//
// The <Screen> component logs visible text (string children, accessibilityLabels,
// placeholder text) and component names on mount and diffs on re-render.
//
// Layout-invisible when no style prop is provided — safe inside ScrollViews,
// ModalLayoutWrappers, and any other container. Only wraps in a View when
// an explicit style is passed (for screens where Screen replaces the outermost View).

const UIPathContext = createContext<string>('');

function extractVisibleContent(node: ReactNode, depth: number = 0, maxDepth: number = 6): string[] {
  try {
    if (depth > maxDepth) return [];
    if (node == null || typeof node === 'boolean') return [];
    if (typeof node === 'string') return node.trim() ? [node.trim()] : [];
    if (typeof node === 'number') return [String(node)];
    if (Array.isArray(node))
      return node.flatMap((n) => extractVisibleContent(n, depth + 1, maxDepth));

    if (!React.isValidElement(node)) return [];

    const { type, props } = node as React.ReactElement<any>;
    if (!props) return [];
    const hints: string[] = [];

    if (typeof type === 'string') {
      const h = '[' + type + ':' + props.accessibilityLabel + ']';
      const i = '[' + type + ':' + props.placeholder + ']';
      if (props.accessibilityLabel) hints.push(h);
      if (props.placeholder) hints.push(i);
    } else {
      const resolved =
        typeof type === 'function' ? type : ((type as any)?.type ?? (type as any)?.render);
      const name =
        (type as any)?.displayName ??
        (resolved as any)?.displayName ??
        (resolved as any)?.name ??
        'Anon';
      const descProps: string[] = [];
      if (props.title) descProps.push(`title='${props.title}'`);
      if (props.label) descProps.push(`label='${props.label}'`);
      if (props.name) descProps.push(`name='${props.name}'`);
      hints.push(`<${name}${descProps.length ? ' ' + descProps.join(' ') : ''}>`);
    }

    if (props.children) {
      hints.push(...extractVisibleContent(props.children, depth + 1, maxDepth));
    }

    return hints;
  } catch {
    return [];
  }
}

interface ScreenProps {
  /** Screen name — used as the log path and correlation key */
  name: string;
  children: ReactNode;
  /** Logger instance. Defaults to the global `log` */
  logger?: Logger;
  /** Style for a wrapper View. Only renders a View when provided. */
  style?: any;
}

/**
 * Wrap your screen's return in <Screen name="..."> to automatically log
 * the visible content.
 *
 * - With style prop: renders a <View style={style}> wrapper (use when Screen
 *   replaces the outermost View).
 * - Without style: layout-invisible (just a context provider). Safe inside
 *   ScrollViews, ModalLayoutWrappers, etc.
 */
export function Screen({
  name,
  children,
  logger: _logger,
  style,
}: ScreenProps): React.ReactElement {
  // KILL_SWITCH — bypass all Screen logic, just render children with optional View
  if (style) {
    const { View } = require('react-native');
    return React.createElement(View, { style }, children);
  }
  return React.createElement(React.Fragment, null, children);
  // END KILL_SWITCH

  const parentPath = useContext(UIPathContext);
  const path = parentPath ? `${parentPath}/${name}` : name;
  const screenLogger = _logger ?? log;

  // Content extraction runs in useEffect (not useMemo) so it never crashes render
  const prevContentKey = useRef<string | undefined>(undefined);
  const prevContent = useRef<string[]>([]);

  useEffect(() => {
    try {
      const content = extractVisibleContent(children);
      const contentKey = content.join('|');
      if (prevContentKey.current === undefined) {
        screenLogger.debug('ui.screen', { screen: path, content });
      } else if (contentKey !== prevContentKey.current) {
        const prevSet = new Set(prevContent.current);
        const currSet = new Set(content);
        const removed = prevContent.current.filter((c) => !currSet.has(c));
        const added = content.filter((c) => !prevSet.has(c));
        if (removed.length > 0 || added.length > 0) {
          screenLogger.debug('ui.screen.diff', { screen: path, removed, added });
        }
      }
      prevContentKey.current = contentKey;
      prevContent.current = content;
    } catch {
      // extractVisibleContent failed — skip content logging, don't break the app
    }
  });

  if (style) {
    const { View } = require('react-native');
    return React.createElement(
      UIPathContext.Provider,
      { value: path },
      React.createElement(View, { style }, children)
    );
  }
  return React.createElement(UIPathContext.Provider, { value: path }, children);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ERROR BOUNDARY
// ═══════════════════════════════════════════════════════════════════════════════

interface ErrorBoundaryProps {
  children: ReactNode;
  name: string;
  fallback?: ReactNode;
  logger?: Logger;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

/**
 * Error boundary that logs the crash + ring buffer context.
 *
 * Usage:
 *   <ErrorBoundary name="Root" fallback={<CrashScreen />}>
 *     <App />
 *   </ErrorBoundary>
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const logger = this.props.logger ?? log;

    // Dump ring buffer into the fatal log — gives the LLM full context
    const recentLogs = logger.getRecentLogs();

    logger.fatal('error.boundary', {
      boundary: this.props.name,
      error,
      componentStack: errorInfo.componentStack ?? 'unavailable',
      recentLogCount: recentLogs.length,
    });

    this.props.onError?.(error, errorInfo);
  }

  render(): ReactNode {
    if (this.state.hasError) return this.props.fallback ?? null;
    return this.props.children;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// NAVIGATION LOGGER (React Navigation / Expo Router)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Creates an onStateChange handler for React Navigation / Expo Router.
 *
 * Usage:
 *   <NavigationContainer onStateChange={createNavigationLogger(log)}>
 */
export function createNavigationLogger(logger: Logger = navLog) {
  let currentRoute: string | undefined;
  return (state: any) => {
    if (!state) return;
    const getActiveRoute = (s: any): any => {
      if (!s.routes || s.index === undefined) return s;
      const route = s.routes[s.index];
      return route.state ? getActiveRoute(route.state) : route;
    };
    const route = getActiveRoute(state);
    const routeName = route.name;
    if (routeName !== currentRoute) {
      logger.info('nav.change', {
        from: currentRoute ?? 'init',
        to: routeName,
        params: route.params
          ? compactValue(route.params, {
              maxStringLength: 80,
              maxArrayItems: 3,
              maxDepth: 2,
              maxObjectKeys: 8,
            })
          : undefined,
      });
      currentRoute = routeName;
    }
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// NETWORK LOGGER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Wraps global fetch to log every request/response with timing.
 * Uses monotonic performance.now() for duration — immune to clock skew.
 * Auto-escalates slow responses (>3s) to warn level.
 *
 * Usage:
 *   global.fetch = createFetchLogger(log);
 */
export function createFetchLogger(
  logger: Logger = apiLog,
  originalFetch: typeof fetch = global.fetch
) {
  return async function loggedFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? 'GET';
    const t0 = _perfNow();
    logger.debug('net.request', { method, url });
    try {
      const response = await originalFetch(input, init);
      const duration_ms = Math.round((_perfNow() - t0) * 100) / 100;
      const level = !response.ok ? 'warn' : duration_ms > 3000 ? 'warn' : 'debug';
      logger[level]('net.response', {
        method,
        url,
        status: response.status,
        duration_ms,
        contentType: response.headers.get('content-type'),
        ...(duration_ms > 3000 ? { _slow: true } : {}),
      });
      return response;
    } catch (error) {
      const duration_ms = Math.round((_perfNow() - t0) * 100) / 100;
      logger.error('net.error', {
        method,
        url,
        duration_ms,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      throw error;
    }
  };
}
