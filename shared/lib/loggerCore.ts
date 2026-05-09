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
 *
 * Core logger primitives only — no React, no JSX, no platform timers.
 * Hook helpers and the `<Log>` component live in sibling files; the public
 * `@/shared/lib/logger` barrel re-exports everything.
 */

import { useEffect } from 'react';
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
  /**
   * Dedup window in ms. When the same event name fires multiple times within
   * this window, subsequent debug/info entries are suppressed; once the window
   * closes (a different event fires or the same event fires past the window)
   * a synthetic `{ event, params: { _suppressed: N } }` summary entry is
   * emitted. Set to 0 to disable. Default: 50
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
  };
  /** Expo session + device metadata (only on first log or when requested) */
  device?: Record<string, unknown>;
  /** Present on span-end logs: duration in ms, from monotonic clock */
  duration_ms?: number;
}

/**
 * Per-span overrides for the slow-escalation thresholds applied at end().
 * Defaults are 1000ms (warn) / 5000ms (error). Long-running operations
 * such as AI completions should pass higher values so a normal completion
 * does not log as ERROR (audit 34 F-005).
 */
interface SpanOptions {
  warnAtMs?: number;
  errorAtMs?: number;
}

interface Span {
  /** End the span. Logs `${event}.end` with duration_ms. Auto-escalates by threshold. */
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
   */
  timed<T>(
    event: string,
    fn: () => Promise<T>,
    opts?: { params?: Record<string, unknown>; warnThresholdMs?: number }
  ): Promise<T>;
  /**
   * Start a manual span for operations that aren't a single async call.
   * Pass `{ warnAtMs, errorAtMs }` to override the default 1s/5s
   * slow-escalation thresholds — long-running operations (e.g. AI sends)
   * should raise the error threshold so a successful completion does not
   * log as ERROR.
   */
  startSpan(event: string, params?: Record<string, unknown>, opts?: SpanOptions): Span;
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

// Master switch: dev-only by default. Production builds skip the JS-thread
// heartbeat side-effect entirely and skip the per-emit stack walk for warn.
export const SHOW_LOGS = true;

// ─── Monotonic Clock ────────────────────────────────────────────────────────
//
// performance.now() is monotonic (immune to system clock skew), sub-ms precision,
// and available in Hermes. Falls back to Date.now() in environments without it.

export const monotonicNow: () => number =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? () => performance.now()
    : () => Date.now();

const _t0 = monotonicNow();
function now(): number {
  return Math.round((monotonicNow() - _t0) * 100) / 100;
}

// ─── Expo Device Info (lazy-loaded) ──────────────────────────────────────────

let _cachedDeviceInfo: Record<string, unknown> | null = null;

function getExpoDeviceInfo(): Record<string, unknown> {
  if (_cachedDeviceInfo) return _cachedDeviceInfo;

  try {
    const Constants = require('expo-constants').default;
    const config = Constants.expoConfig;

    _cachedDeviceInfo = {
      platform: Platform.OS,
      osVersion: Platform.Version,
      appName: config?.name,
      appVersion: config?.version,
      expoSessionId: Constants.sessionId,
      isDevice: Constants.isDevice,
      execEnv: Constants.executionEnvironment,
    };
  } catch {
    _cachedDeviceInfo = {
      platform: Platform.OS,
      osVersion: Platform.Version,
    };
  }

  return _cachedDeviceInfo;
}

// ─── Value Summarization ─────────────────────────────────────────────────────
//
// Detect known verbose patterns and replace with a compact summary:
//   { _kind: "jwt", len: 512, preview: "eyJhbGciOi…" }

// Secret patterns: a previewed prefix is itself sensitive — emit `_kind, len`
// only. Order: secret patterns run before LONG_STRING_PATTERNS so a string
// matching both is classified as the secret it actually is.
const SECRET_STRING_PATTERNS: { name: string; test: (s: string) => boolean }[] = [
  { name: 'pem_key', test: (s) => s.includes('-----BEGIN') },
  { name: 'jwt', test: (s) => /^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(s) },
  { name: 'data_uri', test: (s) => /^data:[^;]+;base64,/.test(s) },
  { name: 'connection_str', test: (s) => /^(postgres|mysql|mongodb|redis|wss?):\/\//.test(s) },
  { name: 'nsec', test: (s) => /^nsec1[023456789acdefghjklmnpqrstuvwxyz]{58}$/.test(s) },
  { name: 'cashu_token', test: (s) => s.startsWith('cashuA') || s.startsWith('cashuB') },
  { name: 'lightning_invoice', test: (s) => /^ln(bc|tb|tbs)[0-9a-z]{50,}/i.test(s) },
];

const LONG_STRING_PATTERNS: { name: string; test: (s: string) => boolean }[] = [
  { name: 'npub', test: (s) => /^npub1[023456789acdefghjklmnpqrstuvwxyz]{58}$/.test(s) },
  { name: 'base64', test: (s) => /^[A-Za-z0-9+/]{60,}={0,2}$/.test(s) },
  { name: 'hex', test: (s) => /^(0x)?[0-9a-fA-F]{40,}$/.test(s) },
  {
    name: 'uuid',
    test: (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
  },
  { name: 'url', test: (s) => /^https?:\/\/.{80,}/.test(s) },
  { name: 'json_blob', test: (s) => s.length > 200 && (s[0] === '{' || s[0] === '[') },
  { name: 'xml_blob', test: (s) => s.length > 200 && s.trimStart().startsWith('<') },
  { name: 'solana_pubkey', test: (s) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s) && s.length >= 32 },
];

type StringClass =
  | { kind: 'secret'; name: string }
  | { kind: 'long'; name: string }
  | { kind: 'long'; name: 'long_string' };

function classifyString(s: string): StringClass {
  for (const p of SECRET_STRING_PATTERNS) if (p.test(s)) return { kind: 'secret', name: p.name };
  for (const p of LONG_STRING_PATTERNS) if (p.test(s)) return { kind: 'long', name: p.name };
  return { kind: 'long', name: 'long_string' };
}

type Compact = string | { _kind: string; len: number; preview?: string };

function summarizeString(s: string, maxLen: number): Compact {
  if (s.length <= maxLen) return s;
  const c = classifyString(s);
  if (c.kind === 'secret') return { _kind: c.name, len: s.length };
  return { _kind: c.name, len: s.length, preview: s.slice(0, 32) + '…' };
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
    let match = target.match(/at\s+(.+?)\s+\((.+):(\d+):\d+\)/);
    if (match)
      return { func: match[1], file: simplifyPath(match[2]), line: parseInt(match[3], 10) };
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
    .replace(/\?.*$/, '')
    .replace(/\/\/&.*$/, '');
  const parts = cleaned.split(/[\\/]/);
  return parts.slice(-3).join('/');
}

// ─── Async Emission ──────────────────────────────────────────────────────────

type IdleCallback = (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void;
const _idleDeadline = { didTimeout: false, timeRemaining: () => 50 };
const scheduleIdle: (cb: IdleCallback) => void =
  typeof requestIdleCallback !== 'undefined'
    ? requestIdleCallback
    : typeof queueMicrotask !== 'undefined'
      ? (cb) => queueMicrotask(() => cb(_idleDeadline))
      : (cb) => cb(_idleDeadline);

// ─── Ring Buffer ─────────────────────────────────────────────────────────────

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

function consoleTransport(pretty: boolean) {
  return (entry: LogEntry): void => {
    const method = LEVEL_CONSOLE_METHOD[entry.level];
    try {
      const serialized = pretty ? JSON.stringify(entry, null, 2) : JSON.stringify(entry);
      if (serialized != null) console[method](serialized);
    } catch {
      console[method](`[${entry.level}] ${entry.event}`, entry.params ?? '');
    }
  };
}

// ─── Logger Factory ──────────────────────────────────────────────────────────

interface LoggerCore {
  buffer: RingBuffer<LogEntry>;
  transports: ((entry: LogEntry) => void)[];
  compactOpts: {
    maxStringLength: number;
    maxArrayItems: number;
    maxDepth: number;
    maxObjectKeys: number;
  };
  async: boolean;
  enabled: boolean;
  dedupWindowMs: number;
  minSeverity: number;
  hasLoggedDevice: boolean;
  lastEvent: string;
  lastEventTime: number;
  lastEntry: LogEntry | null;
  dedupCount: number;
}

function flushSuppressedDedup(core: LoggerCore): void {
  if (core.dedupCount === 0 || !core.lastEntry) return;
  const summary: LogEntry = {
    ts: new Date().toISOString(),
    _t: now(),
    level: core.lastEntry.level,
    event: core.lastEvent,
    src: core.lastEntry.src,
    params: { _suppressed: core.dedupCount },
  };
  core.buffer.push(summary);
  for (const transport of core.transports) {
    try {
      transport(summary);
    } catch (transportError) {
      try {
        const reason =
          transportError instanceof Error
            ? `${transportError.name}: ${transportError.message}`
            : String(transportError);
        console.error('[logger.transport-error]', summary.event, reason);
      } catch {
        /* console itself failed — give up rather than crash */
      }
    }
  }
  core.dedupCount = 0;
}

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
    dedupWindowMs = 50,
  } = options;

  const core: LoggerCore = {
    buffer: new RingBuffer<LogEntry>(ringBufferSize),
    transports,
    compactOpts: { maxStringLength, maxArrayItems, maxDepth, maxObjectKeys },
    async,
    enabled,
    dedupWindowMs,
    minSeverity: LEVEL_SEVERITY[level],
    hasLoggedDevice: false,
    lastEvent: '',
    lastEventTime: 0,
    lastEntry: null,
    dedupCount: 0,
  };

  return makeLogger(core, context);
}

function makeLogger(core: LoggerCore, context: Record<string, unknown>): Logger {
  function emit(logLevel: LogLevel, event: string, params?: Record<string, unknown>): void {
    if (!SHOW_LOGS || !core.enabled) return;
    if (LEVEL_SEVERITY[logLevel] < core.minSeverity) return;

    if (
      core.dedupWindowMs > 0 &&
      logLevel !== 'warn' &&
      logLevel !== 'error' &&
      logLevel !== 'fatal'
    ) {
      const t = now();
      if (
        event === core.lastEvent &&
        t - core.lastEventTime < core.dedupWindowMs &&
        core.lastEntry
      ) {
        core.dedupCount++;
        core.lastEventTime = t;
        return;
      }
      flushSuppressedDedup(core);
      core.lastEvent = event;
      core.lastEventTime = t;
      core.dedupCount = 0;
    }

    const src =
      IS_DEV || logLevel === 'error' || logLevel === 'fatal'
        ? getCallerLocation(3)
        : { file: 'unknown', func: 'unknown', line: 0 };

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
        } else {
          cleanParams[key] = compactValue(val, core.compactOpts);
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

    if (!core.hasLoggedDevice) {
      entry.device = getExpoDeviceInfo();
      core.hasLoggedDevice = true;
    }

    core.buffer.push(entry);
    core.lastEntry = entry;

    const write = () => {
      for (const transport of core.transports) {
        try {
          transport(entry);
        } catch (transportError) {
          try {
            const reason =
              transportError instanceof Error
                ? `${transportError.name}: ${transportError.message}`
                : String(transportError);
            console.error('[logger.transport-error]', entry.event, reason);
          } catch {
            /* console itself failed — give up rather than crash */
          }
        }
      }
    };

    if (core.async && logLevel !== 'fatal') {
      scheduleIdle(write);
    } else {
      write();
    }
  }

  const logger: Logger = {
    debug: (event, params) => emit('debug', event, params),
    info: (event, params) => emit('info', event, params),
    warn: (event, params) => emit('warn', event, params),
    error: (event, params) => emit('error', event, params),
    fatal: (event, params) => emit('fatal', event, params),
    child: (childContext) => makeLogger(core, { ...context, ...childContext }),
    setLevel: (newLevel) => {
      core.minSeverity = LEVEL_SEVERITY[newLevel];
    },
    getRecentLogs: () => core.buffer.getAll(),
    clearRecentLogs: () => core.buffer.clear(),
    dumpForLLM: (dumpOpts?: DumpOptions) => {
      const logs = core.buffer.getAll();
      if (logs.length === 0) return '(no recent logs)';

      const fmt = dumpOpts?.format ?? 'json';
      const errFirst = dumpOpts?.errorsFirst ?? false;

      const compSrc = (src: LogEntry['src']): string => {
        if (!src) return '';
        const f = src.file;
        const fn = src.func !== 'unknown' ? src.func : '';
        if (!f || f === 'unknown' || f.includes('index.bundle') || f.includes('bundle/'))
          return fn ? `${fn}:${src.line}` : String(src.line);
        const short = f.split('/').slice(-2).join('/');
        return fn ? `${short}:${fn}:${src.line}` : `${short}:${src.line}`;
      };

      const hasKind = (v: unknown): v is { _kind: string } =>
        typeof v === 'object' && v !== null && '_kind' in v && typeof v._kind === 'string';
      const kvParams = (params?: Record<string, unknown>, max = 6): string => {
        if (!params) return '';
        const keys = Object.keys(params);
        return (
          keys
            .slice(0, max)
            .map((k) => {
              const v = params[k];
              if (v === null || v === undefined) return `${k}=null`;
              if (hasKind(v)) return `${k}=[${v._kind}]`;
              if (typeof v === 'string' && v.length > 40) return `${k}="${v.slice(0, 37)}…"`;
              if (typeof v === 'object') return `${k}={…}`;
              return `${k}=${JSON.stringify(v)}`;
            })
            .join(' ') + (keys.length > max ? ` +${keys.length - max}` : '')
        );
      };

      type DumpEntry = LogEntry & { delta_ms: number };
      const withDeltas: DumpEntry[] = logs.map((e, i) => ({
        ...e,
        delta_ms: i > 0 ? Math.round((e._t - (logs[i - 1]._t ?? 0)) * 100) / 100 : 0,
      }));

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

      if (fmt === 'yaml') {
        const lines = [...header];
        for (const e of withDeltas) {
          const parts: string[] = [`- {_t: ${Math.round(e._t)}`];
          if (e.delta_ms > 0) parts.push(`d: ${Math.round(e.delta_ms)}`);
          parts.push(`lvl: ${e.level}, ev: ${e.event}`);
          if (e.params) parts.push(`p: ${JSON.stringify(e.params)}`);
          if (e.error) parts.push(`err: "${e.error.name}: ${e.error.message}"`);
          const ctxKey = e.ctx ? JSON.stringify(e.ctx) : '';
          if (ctxKey && ctxKey !== defaultCtxKey) parts.push(`ctx: ${ctxKey}`);
          lines.push(parts.join(', ') + '}');
        }
        return lines.join('\n');
      }

      // NDJSON: strip default ctx + redundant ts; produce a fresh record each
      // line so we don't mutate the original LogEntry stored in the buffer.
      return (
        header.join('\n') +
        withDeltas
          .map((e) => {
            const { ts: _ts, ctx, ...rest } = e;
            const ctxKey = ctx ? JSON.stringify(ctx) : '';
            const compact: Record<string, unknown> = {
              ...rest,
              src: compSrc(e.src),
            };
            if (ctx && ctxKey !== defaultCtxKey) compact.ctx = ctx;
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
      const t0 = monotonicNow();
      try {
        const result = await fn();
        const duration_ms = Math.round((monotonicNow() - t0) * 100) / 100;
        const level: LogLevel = duration_ms > threshold ? 'warn' : 'debug';
        const endParams: Record<string, unknown> = { ...opts?.params, duration_ms };
        if (duration_ms > threshold) {
          endParams._slow = true;
          endParams._threshold_ms = threshold;
        }
        emit(level, `${event}.end`, endParams);
        return result;
      } catch (error) {
        const duration_ms = Math.round((monotonicNow() - t0) * 100) / 100;
        emit('error', `${event}.error`, {
          ...opts?.params,
          duration_ms,
          error: error instanceof Error ? error : new Error(String(error)),
        });
        throw error;
      }
    },

    startSpan: (event: string, params?: Record<string, unknown>, opts?: SpanOptions): Span => {
      // Defaults preserve the historical 1s/5s thresholds for callers that
      // don't pass opts. Long-running operations (AI completions, long
      // network polls) override `errorAtMs` to keep success out of ERROR.
      const warnAtMs = opts?.warnAtMs ?? 1000;
      const errorAtMs = opts?.errorAtMs ?? 5000;
      emit('debug', `${event}.start`, params);
      const t0 = monotonicNow();
      let ended = false;
      return {
        end: (endParams?: Record<string, unknown>) => {
          if (ended) return;
          ended = true;
          const duration_ms = Math.round((monotonicNow() - t0) * 100) / 100;
          const merged: Record<string, unknown> = { ...params, ...endParams, duration_ms };
          const level: LogLevel =
            duration_ms > errorAtMs ? 'error' : duration_ms > warnAtMs ? 'warn' : 'debug';
          if (duration_ms > warnAtMs) {
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

export function initLog(tag: string, msg: string): void {
  log.info('init.timing', { tag, msg, offsetMs: now() });
}

export function useInitMount(tag: string): void {
  useEffect(() => {
    initLog(tag, 'mount');
    return () => initLog(tag, 'unmount');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

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
export const wnLog = log.child({ module: 'whitenoise' });
export const popupLog = log.child({ module: 'popup' });
export const mapLog = log.child({ module: 'map' });

/**
 * Narrow an unknown caught value to a stable `{ name, message }` shape
 * suitable for the ring buffer. Non-Error throws (third-party SDKs that
 * throw plain objects with `cause`, `config`, or response payloads attached)
 * would otherwise dump every enumerable field. Always route catch sites
 * through this helper.
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
