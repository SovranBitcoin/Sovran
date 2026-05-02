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
 *    Logs explain WHY something happened, not just WHAT.
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
 *   - Domain child loggers (cashuLog, nostrLog, walletLog, etc.)
 */

import { useEffect, useRef, useContext, createContext } from 'react';
import React, { type ReactNode } from 'react';
import { Platform } from 'react-native';

// ─── Master switch ──────────────────────────────────────────────────────────
// When true, all log output (console + ring buffer) is active.
// Tied to __DEV__ by default so dev builds always have logging.
// Set to false manually to silence ALL output (useful when profiling overhead).
const SHOW_LOGS = true;

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
  /**
   * Dedup window in ms. When the same event name fires multiple times within
   * this window, subsequent entries are collapsed into the first one with a
   * `_dedup` count instead of emitting separate entries. Set to 0 to disable.
   * Default: 50
   */
  dedupWindowMs?: number;
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

interface Span {
  /** End the span. Logs `${event}.end` with duration_ms. Auto-escalates to warn if slow. */
  end(params?: Record<string, unknown>): void;
}

interface DumpOptions {
  /** Output format. 'json' emits NDJSON (default), 'yaml' uses inline YAML,
   *  'md' uses a pipe-delimited table — ~40% fewer tokens than JSON. */
  format?: 'json' | 'yaml' | 'md';
  /** Show errors/warnings before the chronological timeline.
   *  Counteracts the "lost in the middle" effect in LLMs. Default: false */
  errorsFirst?: boolean;
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
  /** Flush ring buffer to a string suitable for pasting into an LLM.
   *  Use format 'md' for ~40% fewer tokens, 'yaml' for best LLM comprehension.
   *  Set errorsFirst to surface critical entries at the top of the dump. */
  dumpForLLM(opts?: DumpOptions): string;
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

function compactValue(
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
  const cleaned = fullPath
    .replace(/^file:\/\//, '')
    .replace(/\?.*$/, '') // strip ?query strings
    .replace(/\/\/&.*$/, ''); // strip Hermes bundle params (//&platform=ios&…)
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
function consoleTransport(pretty: boolean) {
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

// ─── Logger Factory ──────────────────────────────────────────────────────────

function createLogger(options: LoggerOptions = {}): Logger {
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
    dedupWindowMs = 50,
  } = options;

  let minSeverity = LEVEL_SEVERITY[level];
  const compactOpts = { maxStringLength, maxArrayItems, maxDepth, maxObjectKeys };
  const ringBuffer = new RingBuffer<LogEntry>(ringBufferSize);
  let hasLoggedDevice = false;

  // ── Dedup state ──
  let lastEvent = '';
  let lastEventTime = 0;
  let lastEntry: LogEntry | null = null;
  let dedupCount = 0;

  function emit(logLevel: LogLevel, event: string, params?: Record<string, unknown>): void {
    if (!SHOW_LOGS || !enabled) return;
    if (LEVEL_SEVERITY[logLevel] < minSeverity) return;

    // Collapse rapid-fire identical event names into a single entry with _dedup count.
    // Warnings/errors are never deduped — you always want to see those.
    if (dedupWindowMs > 0 && logLevel !== 'warn' && logLevel !== 'error' && logLevel !== 'fatal') {
      const t = now();
      if (event === lastEvent && t - lastEventTime < dedupWindowMs && lastEntry) {
        dedupCount++;
        (lastEntry.params ??= {})._dedup = dedupCount;
        lastEventTime = t;
        return;
      }
      lastEvent = event;
      lastEventTime = t;
      dedupCount = 1;
    }

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
    lastEntry = entry;

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
    dumpForLLM: (dumpOpts?: DumpOptions) => {
      const logs = ringBuffer.getAll();
      if (logs.length === 0) return '(no recent logs)';

      const fmt = dumpOpts?.format ?? 'json';
      const errFirst = dumpOpts?.errorsFirst ?? false;

      // Compress src to "parent/file:func:line" — three anchor points so any
      // two survive a refactor (per ReLog: line-level precision matters most).
      const compSrc = (src: LogEntry['src']): string => {
        if (!src) return '';
        const f = src.file;
        const fn = src.func !== 'unknown' ? src.func : '';
        if (!f || f === 'unknown' || f.includes('index.bundle') || f.includes('bundle/'))
          return fn ? `${fn}:${src.line}` : String(src.line);
        const short = f.split('/').slice(-2).join('/');
        return fn ? `${short}:${fn}:${src.line}` : `${short}:${src.line}`;
      };

      // Key-value params as compact "k=v k2=v2" string
      const kvParams = (params?: Record<string, unknown>, max = 6): string => {
        if (!params) return '';
        const keys = Object.keys(params);
        return (
          keys
            .slice(0, max)
            .map((k) => {
              const v = params[k];
              if (v === null || v === undefined) return `${k}=null`;
              if (typeof v === 'object' && (v as any)._kind) return `${k}=[${(v as any)._kind}]`;
              if (typeof v === 'string' && v.length > 40) return `${k}="${v.slice(0, 37)}…"`;
              if (typeof v === 'object') return `${k}={…}`;
              return `${k}=${JSON.stringify(v)}`;
            })
            .join(' ') + (keys.length > max ? ` +${keys.length - max}` : '')
        );
      };

      // Compute deltas between consecutive entries
      type DumpEntry = LogEntry & { delta_ms: number };
      const withDeltas: DumpEntry[] = logs.map((e, i) => ({
        ...e,
        delta_ms: i > 0 ? Math.round((e._t - (logs[i - 1]._t ?? 0)) * 100) / 100 : 0,
      }));

      // Find the default ctx (most common) — emit once in header, strip from entries
      const ctxCounts = new Map<string, number>();
      for (const e of logs) {
        const key = e.ctx ? JSON.stringify(e.ctx) : '';
        ctxCounts.set(key, (ctxCounts.get(key) ?? 0) + 1);
      }
      let defaultCtxKey = '';
      let defaultCtxCount = 0;
      for (const [key, count] of ctxCounts) {
        if (count > defaultCtxCount) {
          defaultCtxKey = key;
          defaultCtxCount = count;
        }
      }

      // Header
      const span = ((logs[logs.length - 1]._t - logs[0]._t) / 1000).toFixed(1);
      const header: string[] = [
        '=== SOVRAN APP LOG DUMP ===',
        `Entries: ${logs.length} | Span: ${span}s`,
        `Time: ${logs[0].ts} → ${logs[logs.length - 1].ts}`,
        `Device: ${JSON.stringify(getExpoDeviceInfo())}`,
        ...(defaultCtxKey
          ? [
              `Context: ${defaultCtxKey} (on ${defaultCtxCount}/${logs.length} entries, omitted below)`,
            ]
          : []),
        '_t=monotonic ms | delta=ms since prev | duration_ms=span duration',
        '===========================',
      ];

      // Errors-first: surface critical entries at the top to avoid lost-in-middle
      if (errFirst) {
        const errors = withDeltas.filter(
          (e) => e.level === 'warn' || e.level === 'error' || e.level === 'fatal'
        );
        if (errors.length > 0) {
          header.push('');
          header.push(`=== ${errors.length} ERRORS/WARNINGS (shown first) ===`);
          for (const e of errors) {
            const err = e.error ? ` ${e.error.name}: ${e.error.message}` : '';
            header.push(
              `  [${Math.round(e._t)}ms] ${e.level.toUpperCase()} ${e.event} ${kvParams(e.params)}${err}`
            );
          }
          header.push('=== FULL TIMELINE FOLLOWS ===');
        }
      }
      header.push('');

      // ── Markdown pipe-delimited format (~40% fewer tokens than JSON) ──
      if (fmt === 'md') {
        const lines = [...header, '_t|Δ|lvl|event|src|params|err'];
        for (const e of withDeltas) {
          const lvl =
            e.level === 'debug'
              ? 'DBG'
              : e.level === 'info'
                ? 'INF'
                : e.level.slice(0, 3).toUpperCase();
          const delta = e.delta_ms > 0 ? `+${Math.round(e.delta_ms)}` : '';
          const err = e.error ? `${e.error.name}:${e.error.message}` : '';
          lines.push(
            `${Math.round(e._t)}|${delta}|${lvl}|${e.event}|${compSrc(e.src)}|${kvParams(e.params)}|${err}`
          );
        }
        return lines.join('\n');
      }

      // ── YAML inline format (best LLM comprehension per ImprovingAgents benchmark) ──
      if (fmt === 'yaml') {
        const lines = [...header];
        for (const e of withDeltas) {
          const parts: string[] = [`- {_t: ${Math.round(e._t)}`];
          if (e.delta_ms > 0) parts.push(`d: ${Math.round(e.delta_ms)}`);
          parts.push(`lvl: ${e.level}, ev: ${e.event}`);
          if (e.params) parts.push(`p: ${JSON.stringify(e.params)}`);
          if (e.error) parts.push(`err: "${e.error.name}: ${e.error.message}"`);
          // Only include ctx when it differs from the default
          const ctxKey = e.ctx ? JSON.stringify(e.ctx) : '';
          if (ctxKey && ctxKey !== defaultCtxKey) parts.push(`ctx: ${ctxKey}`);
          lines.push(parts.join(', ') + '}');
        }
        return lines.join('\n');
      }

      // ── Default: NDJSON with delta_ms added ──
      return (
        header.join('\n') +
        withDeltas
          .map((e) => {
            const compact: any = { ...e };
            compact.src = compSrc(e.src);
            // Strip default ctx — already declared in header
            const ctxKey = compact.ctx ? JSON.stringify(compact.ctx) : '';
            if (ctxKey === defaultCtxKey) delete compact.ctx;
            // Strip ts — redundant with _t (saves ~20 tokens/entry)
            delete compact.ts;
            return JSON.stringify(compact);
          })
          .join('\n')
      );
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

/**
 * Log mount + unmount of a component into the init timeline. Use on every
 * provider / gate so we can see the mount waterfall during cold boot.
 *   useInitMount('CocoProvider');
 */
export function useInitMount(tag: string): void {
  useEffect(() => {
    initLog(tag, 'mount');
    return () => initLog(tag, 'unmount');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * Log every render of a component into the init timeline (deduped by the
 * 50ms window in createLogger). Use on hot-path providers when investigating
 * unnecessary re-renders during boot.
 */
export function useInitRender(tag: string): void {
  initLog(tag, 'render');
}

/**
 * Time an async block. Logs `<label>.start` immediately and `<label>.end`
 * on completion with `durationMs`. Re-throws errors after logging
 * `<label>.error`.
 *
 * Returns the awaited value so it composes cleanly:
 *   const proofs = await initPhase('Coco.dbOpen', () => manager.initialize());
 */
export async function initPhase<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = now();
  initLog(label, 'start');
  try {
    const result = await fn();
    const durationMs = +(now() - start).toFixed(2);
    log.info('init.timing', {
      tag: label,
      msg: 'end',
      offsetMs: now(),
      durationMs,
    });
    return result;
  } catch (error) {
    const durationMs = +(now() - start).toFixed(2);
    log.warn('init.timing', {
      tag: label,
      msg: 'error',
      offsetMs: now(),
      durationMs,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/** Synchronous variant of `initPhase`. Times a sync block and logs duration. */
export function initPhaseSync<T>(label: string, fn: () => T): T {
  const start = now();
  initLog(label, 'start');
  try {
    const result = fn();
    const durationMs = +(now() - start).toFixed(2);
    log.info('init.timing', {
      tag: label,
      msg: 'end',
      offsetMs: now(),
      durationMs,
    });
    return result;
  } catch (error) {
    const durationMs = +(now() - start).toFixed(2);
    log.warn('init.timing', {
      tag: label,
      msg: 'error',
      offsetMs: now(),
      durationMs,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// ─── Domain Child Loggers ────────────────────────────────────────────────────
// Use these in the matching domain instead of the bare `log` export.

export const nfcLog = log.child({ module: 'nfc' });
export const cashuLog = log.child({ module: 'cashu' });
export const nostrLog = log.child({ module: 'nostr' });
export const walletLog = log.child({ module: 'wallet' });
export const paymentLog = log.child({ module: 'payment' });
export const feedLog = log.child({ module: 'feed' });
export const apiLog = log.child({ module: 'api' });
export const storeLog = log.child({ module: 'store' });
export const aiLog = log.child({ module: 'ai' });
export const chatLog = log.child({ module: 'chat' });
export const bitchatLog = log.child({ module: 'bitchat' });

/**
 * Narrow an unknown caught value to a stable `{ name, message }` shape suitable
 * for the ring buffer. `compactValue` already truncates `Error` instances, but
 * non-Error throws (third-party SDKs that throw plain objects with `cause`,
 * `config`, or response payloads attached) flow through as plain objects and
 * dump every enumerable field. Stores and key-bearing modules see those throws
 * and a careless `{ error }` spread can leak headers, secrets, or settings
 * snapshots into the LLM dump. Always route catch sites through this helper.
 */
export function redactError(e: unknown): { name: string; message: string } {
  if (e instanceof Error) return { name: e.name, message: e.message };
  if (typeof e === 'string') return { name: 'NonError', message: e };
  if (e && typeof e === 'object') {
    const o = e as { name?: unknown; message?: unknown };
    return {
      name: typeof o.name === 'string' ? o.name : 'NonError',
      message: typeof o.message === 'string' ? o.message : '[non-error object]',
    };
  }
  return { name: 'NonError', message: String(e) };
}

// ═══════════════════════════════════════════════════════════════════════════════
// JS Thread Blocking Detector
// ═══════════════════════════════════════════════════════════════════════════════
//
// Fires a setTimeout heartbeat every `intervalMs`. If the callback fires later
// than `thresholdMs` past its scheduled time, the JS thread was blocked for that
// duration. Logs a warning with the block length so you can correlate it with
// whatever operation was running (recovery, crypto derivation, etc.).
//
// Only active in __DEV__ and when SHOW_LOGS is on, to avoid overhead in prod.

let _heartbeatTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Start the JS thread heartbeat monitor.
 * Call once at app startup (e.g. in your root layout or entry point).
 *
 * @param intervalMs How often to check (default 200ms — low overhead)
 * @param thresholdMs Block duration that triggers a warning (default 100ms)
 * @returns A stop function to disable the monitor
 */
export function startJSThreadMonitor(intervalMs = 200, thresholdMs = 100): () => void {
  if (_heartbeatTimer !== null) return () => {}; // already running

  let lastTick = _perfNow();

  function tick() {
    const now = _perfNow();
    const elapsed = now - lastTick;
    const blocked = elapsed - intervalMs;

    if (blocked > thresholdMs) {
      // The JS thread was unresponsive for `blocked` ms
      log.warn('perf.js_thread_blocked', {
        blocked_ms: Math.round(blocked * 100) / 100,
        expected_ms: intervalMs,
        actual_ms: Math.round(elapsed * 100) / 100,
      });
    }

    lastTick = now;
    _heartbeatTimer = setTimeout(tick, intervalMs);
  }

  _heartbeatTimer = setTimeout(tick, intervalMs);

  return () => {
    if (_heartbeatTimer !== null) {
      clearTimeout(_heartbeatTimer);
      _heartbeatTimer = null;
    }
  };
}

// Auto-start in dev builds
if (SHOW_LOGS) {
  // Delay start slightly so it doesn't fire during module evaluation
  setTimeout(() => startJSThreadMonitor(), 1000);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Performance Helpers
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Schedule work via InteractionManager with JS-thread-block detection.
 *
 * In React Native, InteractionManager.runAfterInteractions() fires immediately
 * when no animations are registered, and setTimeout callbacks are delayed when
 * the JS thread is blocked. This helper logs the *intended* vs *actual* delay
 * so frozen-thread issues show up clearly in log-doctor's timeline.
 *
 * Usage:
 *   const cancel = deferWork('map.cluster_build', () => {
 *     // heavy synchronous work
 *   });
 *   return () => cancel();
 */
export function deferWork(label: string, work: () => void, delayMs = 0): { cancel: () => void } {
  const scheduled = performance.now();
  let cancelled = false;
  let interactionHandle: { cancel: () => void } | null = null;

  const timer = setTimeout(() => {
    if (cancelled) return;
    const { InteractionManager } = require('react-native');
    interactionHandle = InteractionManager.runAfterInteractions(() => {
      if (cancelled) return;
      const actual = performance.now();
      const drift = Math.round((actual - scheduled - delayMs) * 100) / 100;
      if (drift > 500) {
        log.warn('perf.defer.drift', { label, intended_ms: delayMs, drift_ms: drift });
      }
      const t0 = performance.now();
      work();
      const duration = Math.round((performance.now() - t0) * 100) / 100;
      if (duration > 100) {
        log.warn('perf.defer.slow_work', { label, duration_ms: duration });
      }
    });
  }, delayMs);

  return {
    cancel: () => {
      cancelled = true;
      clearTimeout(timer);
      interactionHandle?.cancel();
    },
  };
}

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

/** Logs mount and unmount events for a component. */
export function useLifecycleLogger(componentName: string, logger: Logger = log): void {
  useEffect(() => {
    logger.info('lifecycle.mount', { component: componentName });
    return () => logger.info('lifecycle.unmount', { component: componentName });
  }, []);
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

interface LogProps {
  /** Component name — used as the log path and correlation key */
  name: string;
  children: ReactNode;
  /** Logger instance. Defaults to the global `log` */
  logger?: Logger;
  /** Style for a wrapper View. Only renders a View when provided. */
  style?: any;
  /**
   * Optional testID for the screen container. When omitted and `name`
   * ends with `Screen`, a `screen-<kebab>` testID is auto-derived (e.g.
   * `MintQuoteScreen` → `screen-mint-quote`). The testID is rendered as
   * a hidden 1×1 transparent <Text> element in the AX tree so log-doctor
   * can target it via `wait for screen #screen-mint-quote` etc. without
   * any layout impact.
   */
  testID?: string;
}

/**
 * Convert a `<Log name="...">` value to a screen-* testID. Returns
 * undefined when the name doesn't look like a screen — we don't want
 * to pollute the AX tree with `screen-background-view` etc. for the
 * non-screen Log usages.
 *
 *   MintQuoteScreen   → screen-mint-quote
 *   SettingsRecovery  → screen-settings-recovery (Screen suffix optional)
 *   BackgroundView    → undefined (no Screen suffix, not a screen)
 *
 * Heuristic: name ends with `Screen`, or is a single capitalized word
 * followed by an uppercase letter (e.g. `WalletScreen`). The trailing
 * `Screen` token is dropped before kebab-casing.
 */
function deriveScreenTestID(name: string): string | undefined {
  if (!name.endsWith('Screen')) return undefined;
  const stem = name.slice(0, -'Screen'.length);
  if (stem.length === 0) return undefined;
  // PascalCase → kebab-case: insert dash between lower→upper transitions.
  const kebab = stem
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
  return `screen-${kebab}`;
}

/**
 * Wrap any visual component in <Log name="..."> to automatically log
 * the visible content tree on mount and diffs on re-render.
 *
 * Nests: a <Log> inside another <Log> produces paths like "ParentScreen/ChildCard".
 *
 * - With style prop: renders a <View style={style}> wrapper.
 * - Without style: layout-invisible (just a context provider). Safe inside
 *   ScrollViews, ModalLayoutWrappers, etc.
 */
export function Log({
  name,
  children,
  logger: _logger,
  style,
  testID,
}: LogProps): React.ReactElement {
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

  // Resolve the screen-container testID: explicit prop wins, otherwise
  // auto-derive from the name. Non-Screen Logs get nothing.
  const resolvedTestID = testID ?? deriveScreenTestID(name);

  // When a testID is set, wrap children in a View carrying the testID.
  // The View becomes the SCREEN CONTAINER in the AX tree — log-doctor's
  // snapshot machinery can root subtree captures there, which keeps
  // `assert screen eq` stable across navigation contexts (e.g. opening
  // the same MintQuoteScreen from the receive flow vs from the
  // transaction history puts it inside different parent modals; we want
  // the body comparison to ignore that surrounding chrome).
  //
  // Default style is `{ flex: 1 }` so the wrapper fills its parent and
  // doesn't shrink-wrap content. If the caller passes their own `style`
  // we use that instead so the wrapper participates in the existing
  // layout exactly the same as before.
  if (resolvedTestID) {
    const { View } = require('react-native');
    return React.createElement(
      UIPathContext.Provider,
      { value: path },
      React.createElement(
        View,
        {
          testID: resolvedTestID,
          accessible: false, // children handle their own AX
          style: style ?? { flex: 1 },
        },
        children
      )
    );
  }

  // Non-screen Logs (no testID, no style) stay as a pure context provider
  // — zero layout impact, preserves the original Log behaviour.
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

/** @deprecated Use `Log` instead — same component, better name. */
export const Screen = Log;
