#!/usr/bin/env node

/**
 * log-doctor — CLI log preprocessor for LLM-assisted debugging
 *
 * Reads structured JSON logs (from dumpForLLM() or piped input) and produces
 * token-efficient summaries optimized for LLM context windows.
 *
 * RESEARCH BASIS:
 *
 * - REFLEX (arxiv 2511.07458) preprocesses logs through: format
 *   normalization, field extraction, noise filtering, and sequence
 *   chunking before passing to LLMs.
 *
 * - LogSage (arxiv 2506.03691) uses "token-efficient log preprocessing
 *   to filter noise and extract critical errors" achieving 98% precision.
 *
 * - RCAgent uses "OBSK which allows only important information to be
 *   analyzed, reducing the number of tokens."
 *
 * USAGE:
 *   npx tsx scripts/log-doctor.ts <mode> [options] < log.txt
 *   npm run log-doctor -- <mode> [options]
 *
 * MODES:
 *   stats        Aggregate statistics: event frequency, slowest ops, error rate
 *   timeline     Compact one-line-per-entry with delta timing
 *   errors       Only warn/error/fatal entries with surrounding context
 *   slow         Operations exceeding a duration threshold
 *   renders      Re-render analysis (counts, why-did-update hints)
 *   screens      Screen navigation flow, content snapshots, and durations
 *   startup      Initialization waterfall, stage timing, gate sequence
 *   coco         Coco/Colada wallet module breakdown, issues, mint requests
 *   network      Network request/response pairs with latency
 *   feed         Feed/thread GraphQL, page mapping, and reply seed/render flow
 *   full         Full entries but deduplicated and trimmed
 *   diff         Compare latest session against previous to isolate failure-specific entries
 *   flows        Reconstruct cross-async traces using flowId in ctx
 *   ws           WebSocket connection health, subscription analysis, message rates
 *   gc           Hermes memory trend, GC pressure, JS thread blocks, leak detection
 *   budget       Token cost meta-analysis — shows which modes fit in which context windows
 *   phone        Drive a real iPhone via WebDriverAgent (subcommands: tap, tap-id, tree, shot, …)
 *
 * OPTIONS:
 *   --threshold <ms>    Duration threshold for 'slow' mode (default: 500)
 *   --context <n>       Number of entries before/after errors (default: 3)
 *   --limit <n>         Page size (default: 200)
 *   --offset <n>        Skip first N entries for pagination (default: 0)
 *   --no-device         Omit device info block
 *   --no-inst           Exclude instrumentation events (render.count, state.change, etc.)
 *   --since <ms>        Only entries after this _t value
 *   --until <ms>        Only entries before this _t value
 *   --event <pattern>   Filter to events matching this substring
 *   --latest            Only analyse the most recent app session (detects restarts via _t resets)
 *   --format <fmt>      Output format for 'full' mode: json (default), yaml, md (pipe-delimited)
 *   --token-budget <n>  Max approximate tokens — output is pruned to fit
 */

/* eslint-disable @typescript-eslint/no-var-requires */
import * as fs from 'fs';
import * as nodePath from 'path';
import * as url from 'url';

// Test DSL — parser, executor, discovery, verification metadata writer.
// These power the `phone test ...` subcommand.
import { discoverTests, findMatrix, findTest, formatTestList } from './test-dsl/discovery';
import type { RunnerEvent } from './test-dsl/events';
import { executeMatrix, executeTest } from './test-dsl/executor';
import { parseSuite } from './test-dsl/parser';
import { createTtyReporter, isInteractiveTty, type TtyReporter } from './test-dsl/tty-reporter';
import { writeMatrixResultTable, writeVerifiedComment } from './test-dsl/verification';
// WebDriverAgent primitives — see ./wda.ts for the rationale this lives in
// its own module (executor.ts also depends on these primitives, so keeping
// them here would form a real `index.ts` ↔ `executor.ts` cycle).
import {
  WDA_BASE,
  buildAddTestIDNudge,
  buildCoordTapNudge,
  detectDeviceLabel,
  dismissModal,
  ensureWDAReady,
  findByTestID,
  findByText,
  flattenAll,
  formatTreeOutput,
  getCurrentTree,
  invalidateCachedSession,
  pressHome,
  setRecoveryLogSink,
  swipe,
  takeScreenshot,
  tapXY,
  typeKeys,
  wdaRequest,
} from './wda';

// ─── Types ───────────────────────────────────────────────────────────────────

interface LogEntry {
  ts: string;
  _t?: number;
  level: string;
  event: string;
  src: { file: string; func: string; line: number } | string;
  params?: Record<string, unknown>;
  ctx?: Record<string, unknown>;
  error?: { name: string; message: string; stack: string[]; properties?: Record<string, unknown> };
  device?: Record<string, unknown>;
}

interface Options {
  mode: string;
  threshold: number;
  context: number;
  limit: number;
  offset: number;
  noDevice: boolean;
  noInstrumentation: boolean;
  since: number | null;
  until: number | null;
  eventFilter: string | null;
  latest: boolean;
  /** Output format for full mode: 'json' (default), 'yaml', or 'md' (pipe-delimited) */
  format: 'json' | 'yaml' | 'md';
  /** Max approximate token budget. Output is pruned to fit. null = unlimited. */
  tokenBudget: number | null;
  /** Positional args after the mode name. Used by `phone` mode for subcommands. */
  restArgs: string[];
}

// ─── Parse CLI args ──────────────────────────────────────────────────────────

function parseArgs(argv: string[]): Options {
  const args = argv.slice(2);
  const opts: Options = {
    mode: 'stats',
    threshold: 500,
    context: 3,
    limit: 200,
    offset: 0,
    noDevice: false,
    noInstrumentation: false,
    since: null,
    until: null,
    eventFilter: null,
    latest: false,
    format: 'json',
    tokenBudget: null,
    restArgs: [],
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--') && i === 0) {
      opts.mode = arg;
    } else if (!arg.startsWith('--')) {
      // Positional after the mode — collected for subcommand-style modes (phone).
      opts.restArgs.push(arg);
    } else if (arg === '--threshold' && args[i + 1]) {
      opts.threshold = parseInt(args[++i], 10);
    } else if (arg === '--context' && args[i + 1]) {
      opts.context = parseInt(args[++i], 10);
    } else if (arg === '--limit' && args[i + 1]) {
      opts.limit = parseInt(args[++i], 10);
    } else if (arg === '--offset' && args[i + 1]) {
      opts.offset = parseInt(args[++i], 10);
    } else if (arg === '--no-device') {
      opts.noDevice = true;
    } else if (arg === '--no-inst') {
      opts.noInstrumentation = true;
    } else if (arg === '--since' && args[i + 1]) {
      opts.since = parseFloat(args[++i]);
    } else if (arg === '--until' && args[i + 1]) {
      opts.until = parseFloat(args[++i]);
    } else if (arg === '--event' && args[i + 1]) {
      opts.eventFilter = args[++i];
    } else if (arg === '--latest') {
      opts.latest = true;
    } else if (arg === '--format' && args[i + 1]) {
      const f = args[++i];
      if (f === 'yaml' || f === 'md' || f === 'json') opts.format = f;
    } else if (arg === '--token-budget' && args[i + 1]) {
      opts.tokenBudget = parseInt(args[++i], 10);
    } else {
      // Unknown flag — pass through to subcommand-style modes (phone test ...).
      opts.restArgs.push(arg);
    }
  }

  return opts;
}

// ─── Parse log input ─────────────────────────────────────────────────────────

function parseLogInput(raw: string): LogEntry[] {
  const entries: LogEntry[] = [];
  const lines = raw.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      !trimmed ||
      trimmed.startsWith('===') ||
      trimmed.startsWith('Entries:') ||
      trimmed.startsWith('Time range:') ||
      trimmed.startsWith('Device:')
    )
      continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.event && parsed.level) entries.push(parsed);
    } catch {
      // Not JSON — skip
    }
  }

  // Fallback: try pretty-printed JSON blocks from console output
  if (entries.length === 0) {
    const jsonBlocks = raw.match(/\{[\s\S]*?\n\}/g);
    if (jsonBlocks) {
      for (const block of jsonBlocks) {
        try {
          const parsed = JSON.parse(block);
          if (parsed.event && parsed.level) entries.push(parsed);
        } catch {
          /* skip */
        }
      }
    }
  }

  return entries;
}

// ─── Session detection ──────────────────────────────────────────────────────
// When `expo start 2>&1 | tee log.txt` runs across hot-reloads or restarts,
// multiple sessions are concatenated. A session boundary is detected when _t
// jumps backwards (performance.now() resets on restart) or there is a gap > 60s.

function extractLatestSession(entries: LogEntry[]): LogEntry[] {
  if (entries.length === 0) return entries;
  let lastBoundary = 0;
  let prevT = -1;
  for (let i = 0; i < entries.length; i++) {
    const t = entries[i]._t ?? 0;
    if (prevT >= 0) {
      const delta = t - prevT;
      if (delta < -500 || delta > 60_000) {
        // _t went backwards (restart) or huge gap (>60s) — new session
        lastBoundary = i;
      }
    }
    prevT = t;
  }
  const session = entries.slice(lastBoundary);
  if (lastBoundary > 0) {
    const dropped = lastBoundary;
    const total = entries.length;
    console.error(
      `[--latest] Skipped ${dropped} entries from older sessions (keeping ${session.length} of ${total})`
    );
  }
  return session;
}

// ─── Pagination helper ───────────────────────────────────────────────────────

function paginate<T>(items: T[], opts: Options): { page: T[]; footer: string } {
  const total = items.length;
  const start = opts.offset;
  const page = items.slice(start, start + opts.limit);
  const remaining = total - start - page.length;

  let footer = `\nShowing ${start + 1}-${start + page.length} of ${total}`;
  if (remaining > 0) {
    footer += ` | Next: --offset ${start + opts.limit}`;
  }

  return { page, footer };
}

// ─── Instrumentation event set ───────────────────────────────────────────────
// High-volume events from React debug hooks. Stats groups these into categories;
// timeline/slow/errors can exclude them via --no-inst.
const INSTRUMENTATION_EVENTS = new Set([
  'render.count',
  'render.why',
  'component.mount',
  'component.unmount',
  'state.change',
  'query.result',
  'query.diff',
  'ui.screen',
  'ui.screen.diff',
  'lifecycle.mount',
  'lifecycle.unmount',
]);

// ─── Filter entries ──────────────────────────────────────────────────────────

function filterEntries(entries: LogEntry[], opts: Options): LogEntry[] {
  return entries.filter((e) => {
    if (opts.since !== null && e._t !== undefined && e._t < opts.since) return false;
    if (opts.until !== null && e._t !== undefined && e._t > opts.until) return false;
    if (opts.eventFilter) {
      try {
        if (!new RegExp(opts.eventFilter).test(e.event)) return false;
      } catch {
        if (!e.event.includes(opts.eventFilter)) return false;
      }
    }
    if (opts.noInstrumentation && INSTRUMENTATION_EVENTS.has(e.event)) return false;
    return true;
  });
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

function shortSrc(src: LogEntry['src']): string {
  if (typeof src === 'string') return src;
  const file = src.file.split('/').slice(-2).join('/');
  return `${file}:${src.line}`;
}

function shortParams(params: Record<string, unknown> | undefined, maxKeys = 6): string {
  if (!params) return '';
  const keys = Object.keys(params);
  const items = keys.slice(0, maxKeys).map((k) => {
    const v = params[k];
    if (v === null || v === undefined) return `${k}=null`;
    if (typeof v === 'object' && (v as any)._kind) return `${k}=[${(v as any)._kind}]`;
    if (typeof v === 'string' && v.length > 40) return `${k}="${v.slice(0, 37)}…"`;
    if (typeof v === 'object') return `${k}={…}`;
    return `${k}=${JSON.stringify(v)}`;
  });
  if (keys.length > maxKeys) items.push(`+${keys.length - maxKeys} more`);
  return items.join(' ');
}

function levelIcon(level: string): string {
  switch (level) {
    case 'fatal':
      return 'FATAL';
    case 'error':
      return 'ERROR';
    case 'warn':
      return 'WARN ';
    case 'info':
      return 'INFO ';
    case 'debug':
      return 'DEBUG';
    default:
      return '     ';
  }
}

function formatDelta(deltaMs: number): string {
  if (deltaMs < 1) return '      ';
  if (deltaMs < 10) return `  +${deltaMs.toFixed(1)}ms`.padStart(10);
  if (deltaMs < 1000) return `  +${Math.round(deltaMs)}ms`.padStart(10);
  if (deltaMs < 10000) return ` +${(deltaMs / 1000).toFixed(1)}s`.padStart(10);
  return ` +${Math.round(deltaMs / 1000)}s`.padStart(10);
}

// ─── Mode: stats ─────────────────────────────────────────────────────────────

function modeStats(entries: LogEntry[], opts: Options): string {
  const eventCounts: Map<string, number> = new Map();
  const levelCounts: Map<string, number> = new Map();
  let minT = Infinity,
    maxT = -Infinity;
  const gaps: number[] = [];

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    eventCounts.set(e.event, (eventCounts.get(e.event) ?? 0) + 1);
    levelCounts.set(e.level, (levelCounts.get(e.level) ?? 0) + 1);

    const t = e._t ?? 0;
    if (t < minT) minT = t;
    if (t > maxT) maxT = t;

    if (i > 0) {
      const prevT = entries[i - 1]._t ?? 0;
      gaps.push(t - prevT);
    }
  }

  gaps.sort((a, b) => b - a);

  const lines: string[] = [];
  const device = entries.find((e) => e.device);

  lines.push('=== LOG SESSION STATISTICS ===');
  lines.push('');
  if (device?.device && !opts.noDevice) lines.push(`Device: ${JSON.stringify(device.device)}`);
  lines.push(`Entries: ${entries.length}`);
  lines.push(
    `Time span: ${((maxT - minT) / 1000).toFixed(1)}s (${minT.toFixed(0)}ms -> ${maxT.toFixed(0)}ms)`
  );
  lines.push('');

  lines.push('BY LEVEL:');
  for (const [level, count] of [...levelCounts.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${levelIcon(level)} ${count}`);
  }
  lines.push('');

  // Split events into app events vs instrumentation events
  let instrumentationTotal = 0;
  const instrumentationBreakdown = new Map<string, number>();
  const appEventCounts: [string, number][] = [];

  for (const [event, count] of eventCounts) {
    if (INSTRUMENTATION_EVENTS.has(event)) {
      instrumentationTotal += count;
      // Group into categories
      let category: string;
      if (event.startsWith('render.') || event.startsWith('component.'))
        category = 'render tracking';
      else if (event.startsWith('state.')) category = 'state tracking';
      else if (event.startsWith('query.')) category = 'data hook tracking';
      else if (event.startsWith('ui.screen') || event.startsWith('lifecycle.'))
        category = 'screen tracking';
      else category = event;
      instrumentationBreakdown.set(category, (instrumentationBreakdown.get(category) ?? 0) + count);
    } else {
      appEventCounts.push([event, count]);
    }
  }

  if (instrumentationTotal > 0) {
    const pct = ((instrumentationTotal / entries.length) * 100).toFixed(0);
    lines.push(
      `INSTRUMENTATION: ${instrumentationTotal} entries (${pct}% of total) — use "renders" or "screens" mode for details`
    );
    for (const [cat, count] of [...instrumentationBreakdown.entries()].sort(
      (a, b) => b[1] - a[1]
    )) {
      lines.push(`  ${String(count).padStart(5)}x  ${cat}`);
    }
    lines.push('');
  }

  lines.push('TOP APP EVENTS (by frequency):');
  const topEvents = appEventCounts.sort((a, b) => b[1] - a[1]).slice(0, 15);
  for (const [event, count] of topEvents) {
    lines.push(`  ${String(count).padStart(5)}x  ${event}`);
  }
  lines.push('');

  if (gaps.length > 0) {
    lines.push('TIMING:');
    lines.push(`  Largest gap: ${Math.round(gaps[0])}ms`);
    lines.push(
      `  Top 5 gaps: ${gaps
        .slice(0, 5)
        .map((g) => Math.round(g) + 'ms')
        .join(', ')}`
    );
    lines.push(`  Median gap: ${Math.round(gaps[Math.floor(gaps.length / 2)])}ms`);
    lines.push('');
  }

  lines.push('NOISE DETECTION:');
  const noisy = topEvents.filter(([_, count]) => count > entries.length * 0.15);
  if (noisy.length > 0) {
    for (const [event, count] of noisy) {
      const pct = ((count / entries.length) * 100).toFixed(0);
      lines.push(`  "${event}" is ${pct}% of all logs`);
    }
  } else {
    lines.push('  No excessively repeated events detected.');
  }
  lines.push('');

  // Duplicate detection: consecutive entries with identical event + params
  const dupes: Array<{ event: string; count: number; params: string }> = [];
  let runEvent = '';
  let runParams = '';
  let runCount = 0;
  for (const e of entries) {
    const p = JSON.stringify(e.params ?? {});
    if (e.event === runEvent && p === runParams) {
      runCount++;
    } else {
      if (runCount > 1) dupes.push({ event: runEvent, count: runCount, params: runParams });
      runEvent = e.event;
      runParams = p;
      runCount = 1;
    }
  }
  if (runCount > 1) dupes.push({ event: runEvent, count: runCount, params: runParams });
  const bigDupes = dupes.filter((d) => d.count >= 2).sort((a, b) => b.count - a.count);
  if (bigDupes.length > 0) {
    lines.push('DUPLICATE RUNS (consecutive identical event+params):');
    for (const d of bigDupes.slice(0, 10)) {
      const p = d.params.length > 60 ? d.params.slice(0, 57) + '...' : d.params;
      lines.push(`  ${d.count}x  ${d.event}  ${p}`);
    }
    lines.push('');
  }

  // Report entries that were collapsed by the logger's dedup mechanism
  const dedupedEntries = entries.filter(
    (e) => e.params && typeof (e.params as any)._dedup === 'number' && (e.params as any)._dedup > 1
  );
  if (dedupedEntries.length > 0) {
    const totalSuppressed = dedupedEntries.reduce(
      (s, e) => s + ((e.params as any)._dedup as number) - 1,
      0
    );
    lines.push(
      `DEDUPED BY LOGGER: ${totalSuppressed} entries collapsed into ${dedupedEntries.length} (${totalSuppressed} suppressed)`
    );
    const byEvent = new Map<string, number>();
    for (const e of dedupedEntries)
      byEvent.set(e.event, (byEvent.get(e.event) ?? 0) + ((e.params as any)._dedup as number) - 1);
    for (const [event, count] of [...byEvent.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
      lines.push(`  ${String(count).padStart(5)}x  ${event}`);
    }
  }

  // Template-based dedup: group by event name, show which params vary.
  // Simplified Drain algorithm — for structured logs the event name IS the template,
  // and the varying parts are the param values.
  lines.push('');
  lines.push('EVENT TEMPLATES (param variability):');
  const templateGroups = new Map<
    string,
    {
      count: number;
      paramKeys: Set<string>;
      varyingKeys: Set<string>;
      tFirst: number;
      tLast: number;
    }
  >();
  for (const e of entries) {
    const existing = templateGroups.get(e.event);
    const t = e._t ?? 0;
    const keys = e.params ? Object.keys(e.params).filter((k) => k !== '_dedup') : [];
    if (!existing) {
      templateGroups.set(e.event, {
        count: 1,
        paramKeys: new Set(keys),
        varyingKeys: new Set(),
        tFirst: t,
        tLast: t,
      });
    } else {
      existing.count++;
      existing.tLast = t;
      // Detect varying keys: keys present in some entries but not others, or keys with different values
      for (const k of keys) {
        if (!existing.paramKeys.has(k)) existing.varyingKeys.add(k);
        existing.paramKeys.add(k);
      }
    }
  }
  // Track value variance: for events with >1 occurrence, sample first+last values
  const highFreqTemplates = [...templateGroups.entries()]
    .filter(([_, g]) => g.count >= 3)
    .sort((a, b) => b[1].count - a[1].count);
  if (highFreqTemplates.length > 0) {
    for (const [event, g] of highFreqTemplates.slice(0, 15)) {
      const span = g.tLast - g.tFirst;
      const spanStr = span < 1000 ? `${Math.round(span)}ms` : `${(span / 1000).toFixed(1)}s`;
      const keys = [...g.paramKeys].join(', ');
      lines.push(
        `  ${String(g.count).padStart(5)}x  ${event} (${spanStr}) [${keys || 'no params'}]`
      );
    }
    if (highFreqTemplates.length > 15) lines.push(`  ... +${highFreqTemplates.length - 15} more`);
  } else {
    lines.push('  No events with 3+ occurrences.');
  }

  return lines.join('\n');
}

// ─── Mode: timeline ──────────────────────────────────────────────────────────

function modeTimeline(entries: LogEntry[], opts: Options): string {
  const { page, footer } = paginate(entries, opts);
  const lines: string[] = [];

  // For delta computation, get the entry just before the page
  let prevT: number | null =
    opts.offset > 0 && entries[opts.offset - 1] ? (entries[opts.offset - 1]._t ?? null) : null;

  lines.push('DELTA      LVL    EVENT                              PARAMS');
  lines.push('-'.repeat(100));

  for (const e of page) {
    const t = e._t ?? 0;
    const delta = prevT !== null ? t - prevT : 0;
    prevT = t;

    const deltaStr = formatDelta(delta);
    const lvl = levelIcon(e.level);
    const event = e.event.padEnd(35).slice(0, 35);
    const params = shortParams(e.params);

    let line = `${deltaStr} ${lvl} ${event} ${params}`;
    if (e.error) line += ` ERR:${e.error.name}:${e.error.message}`;
    lines.push(line);
  }

  lines.push(footer);

  return lines.join('\n');
}

// ─── Mode: errors ────────────────────────────────────────────────────────────

function modeErrors(entries: LogEntry[], opts: Options): string {
  const errorIndices: number[] = [];
  for (let i = 0; i < entries.length; i++) {
    if (['warn', 'error', 'fatal'].includes(entries[i].level)) {
      errorIndices.push(i);
    }
  }

  if (errorIndices.length === 0) return 'No warnings, errors, or fatal entries found.';

  const lines: string[] = [];
  lines.push(`Found ${errorIndices.length} warning/error/fatal entries:\n`);

  const included = new Set<number>();
  for (const idx of errorIndices) {
    for (
      let i = Math.max(0, idx - opts.context);
      i <= Math.min(entries.length - 1, idx + opts.context);
      i++
    ) {
      included.add(i);
    }
  }

  let prevT: number | null = null;
  let lastPrinted: number | null = null;

  for (const i of [...included].sort((a, b) => a - b)) {
    if (lastPrinted !== null && i - lastPrinted > 1) lines.push('  ...');
    lastPrinted = i;

    const e = entries[i];
    const t = e._t ?? 0;
    const delta = prevT !== null ? t - prevT : 0;
    prevT = t;

    const isError = ['warn', 'error', 'fatal'].includes(e.level);
    const marker = isError ? '>>>' : '   ';

    let line = `${marker} ${formatDelta(delta)} ${levelIcon(e.level)} ${e.event}  ${shortParams(e.params)}`;

    if (e.error) {
      lines.push(line);
      lines.push(`       ERROR: ${e.error.name}: ${e.error.message}`);
      if (e.error.stack?.length > 0) {
        lines.push(`       STACK: ${e.error.stack.slice(0, 5).join(' -> ')}`);
      }
      continue;
    }

    lines.push(line);
  }

  return lines.join('\n');
}

// ─── Mode: slow ──────────────────────────────────────────────────────────────

function modeSlow(entries: LogEntry[], opts: Options): string {
  const gaps: Array<{ from: LogEntry; to: LogEntry; gap: number; fromIdx: number; toIdx: number }> =
    [];

  for (let i = 1; i < entries.length; i++) {
    const prevT = entries[i - 1]._t ?? 0;
    const currT = entries[i]._t ?? 0;
    const gap = currT - prevT;
    if (gap >= opts.threshold) {
      gaps.push({ from: entries[i - 1], to: entries[i], gap, fromIdx: i - 1, toIdx: i });
    }
  }

  if (gaps.length === 0) return `No operations exceeding ${opts.threshold}ms threshold found.`;

  const lines: string[] = [];
  lines.push(`SLOW GAPS (>${opts.threshold}ms between consecutive entries):`);
  lines.push('');
  gaps.sort((a, b) => b.gap - a.gap);
  const { page, footer } = paginate(gaps, opts);
  for (const g of page) {
    lines.push(`  ${Math.round(g.gap)}ms gap:`);
    lines.push(`    BEFORE: [${g.fromIdx}] ${g.from.event}  ${shortParams(g.from.params)}`);
    lines.push(`    AFTER:  [${g.toIdx}] ${g.to.event}  ${shortParams(g.to.params)}`);
    lines.push('');
  }

  lines.push(footer);
  return lines.join('\n');
}

// ─── Mode: renders ───────────────────────────────────────────────────────────

function modeRenders(entries: LogEntry[], _opts: Options): string {
  const renderEvents = entries.filter(
    (e) =>
      INSTRUMENTATION_EVENTS.has(e.event) ||
      e.event.includes('render') ||
      e.event.includes('.mount') ||
      e.event.includes('scroll.offset.init')
  );

  if (renderEvents.length === 0) return 'No render-related entries found.';

  const lines: string[] = [];

  // ── Section 1: Per-component render counts (from render.count) ──
  interface ComponentStats {
    maxRenders: number;
    maxRendersPerSec: number;
    aliveMs: number;
    warned: boolean;
  }
  const componentRenders = new Map<string, ComponentStats>();
  for (const e of renderEvents) {
    if (e.event !== 'render.count') continue;
    const name = (e.params?.component as string) ?? '?';
    const renders = (e.params?.renders as number) ?? 0;
    const rps = (e.params?.rendersPerSec as number) ?? 0;
    const alive = (e.params?.aliveMs as number) ?? 0;
    const prev = componentRenders.get(name);
    componentRenders.set(name, {
      maxRenders: Math.max(prev?.maxRenders ?? 0, renders),
      maxRendersPerSec: Math.max(prev?.maxRendersPerSec ?? 0, rps),
      aliveMs: Math.max(prev?.aliveMs ?? 0, alive),
      warned: prev?.warned || e.level === 'warn',
    });
  }

  if (componentRenders.size > 0) {
    lines.push('COMPONENT RENDER COUNTS:');
    lines.push('');
    const sorted = [...componentRenders.entries()].sort(
      (a, b) => b[1].maxRenders - a[1].maxRenders
    );
    for (const [name, stats] of sorted) {
      const flag = stats.warned ? 'EXCESSIVE' : stats.maxRenders > 10 ? 'HIGH' : 'ok';
      const rps = stats.maxRendersPerSec > 0 ? ` ${stats.maxRendersPerSec.toFixed(1)}/s` : '';
      lines.push(
        `  [${flag.padEnd(9)}] ${name}: ${stats.maxRenders} renders${rps} (alive ${formatDelta(stats.aliveMs).trim()})`
      );
    }
    lines.push('');
  }

  // ── Section 2: Why-did-update summary (from render.why) ──
  // Aggregate by component → prop → hint, showing only unique causes
  interface PropChangeInfo {
    hint: string;
    count: number;
  }
  const whyUpdates = new Map<string, Map<string, PropChangeInfo>>();
  for (const e of renderEvents) {
    if (e.event !== 'render.why') continue;
    const name = (e.params?.component as string) ?? '?';
    const changes = (e.params?.changes as Record<string, { hint?: string }>) ?? {};
    if (!whyUpdates.has(name)) whyUpdates.set(name, new Map());
    const propMap = whyUpdates.get(name)!;
    for (const [prop, detail] of Object.entries(changes)) {
      const hint = detail?.hint ?? 'value changed';
      const existing = propMap.get(prop);
      if (existing) {
        existing.count++;
      } else {
        propMap.set(prop, { hint, count: 1 });
      }
    }
  }

  if (whyUpdates.size > 0) {
    lines.push('WHY DID RE-RENDER (by component → prop):');
    lines.push('');
    const sorted = [...whyUpdates.entries()].sort((a, b) => {
      const aTotal = [...a[1].values()].reduce((s, v) => s + v.count, 0);
      const bTotal = [...b[1].values()].reduce((s, v) => s + v.count, 0);
      return bTotal - aTotal;
    });
    for (const [name, propMap] of sorted) {
      const total = [...propMap.values()].reduce((s, v) => s + v.count, 0);
      lines.push(`  ${name} (${total}x):`);
      const propsSorted = [...propMap.entries()].sort((a, b) => b[1].count - a[1].count);
      for (const [prop, info] of propsSorted.slice(0, 5)) {
        lines.push(`    ${prop}: ${info.count}x — ${info.hint}`);
      }
      if (propsSorted.length > 5) lines.push(`    ... +${propsSorted.length - 5} more props`);
    }
    lines.push('');
  }

  // ── Section 3: State churn (from state.change) ──
  const stateChanges = new Map<string, number>(); // "Component.stateName" → count
  for (const e of renderEvents) {
    if (e.event !== 'state.change') continue;
    const name = (e.params?.component as string) ?? '?';
    const state = (e.params?.state as string) ?? '?';
    const key = `${name}.${state}`;
    stateChanges.set(key, (stateChanges.get(key) ?? 0) + 1);
  }

  if (stateChanges.size > 0) {
    lines.push('STATE CHURN:');
    lines.push('');
    const sorted = [...stateChanges.entries()].sort((a, b) => b[1] - a[1]);
    for (const [key, count] of sorted.slice(0, 15)) {
      const flag = count > 10 ? 'EXCESSIVE' : count > 5 ? 'HIGH' : 'ok';
      lines.push(`  [${flag.padEnd(9)}] ${key}: ${count}x`);
    }
    if (sorted.length > 15) lines.push(`  ... +${sorted.length - 15} more`);
    lines.push('');
  }

  // ── Section 4: Query data updates (from query.result / query.diff) ──
  const queryUpdates = new Map<string, number>();
  for (const e of renderEvents) {
    if (e.event !== 'query.result' && e.event !== 'query.diff') continue;
    const source = (e.params?.source as string) ?? '?';
    queryUpdates.set(source, (queryUpdates.get(source) ?? 0) + 1);
  }

  if (queryUpdates.size > 0) {
    lines.push('DATA HOOK UPDATES:');
    lines.push('');
    const sorted = [...queryUpdates.entries()].sort((a, b) => b[1] - a[1]);
    for (const [source, count] of sorted.slice(0, 15)) {
      const flag = count > 10 ? 'EXCESSIVE' : count > 5 ? 'HIGH' : 'ok';
      lines.push(`  [${flag.padEnd(9)}] ${source}: ${count}x`);
    }
    if (sorted.length > 15) lines.push(`  ... +${sorted.length - 15} more`);
    lines.push('');
  }

  // ── Section 5: Legacy event-based render counts (fallback for manual .render logs) ──
  const legacyEvents = renderEvents.filter(
    (e) =>
      !INSTRUMENTATION_EVENTS.has(e.event) &&
      (e.event.includes('render') || e.event.includes('scroll.offset.init'))
  );
  if (legacyEvents.length > 0) {
    const eventCounts = new Map<string, { count: number; timestamps: number[] }>();
    for (const e of legacyEvents) {
      const existing = eventCounts.get(e.event) ?? { count: 0, timestamps: [] };
      existing.count++;
      if (e._t) existing.timestamps.push(e._t);
      eventCounts.set(e.event, existing);
    }
    lines.push('MANUAL RENDER LOGS:');
    lines.push('');
    for (const [event, data] of [...eventCounts.entries()].sort(
      (a, b) => b[1].count - a[1].count
    )) {
      const flag = data.count > 10 ? 'EXCESSIVE' : data.count > 5 ? 'HIGH' : 'ok';
      const span =
        data.timestamps.length > 1
          ? ` (${Math.round(data.timestamps[data.timestamps.length - 1] - data.timestamps[0])}ms span)`
          : '';
      lines.push(`  [${flag.padEnd(9)}] ${event}: ${data.count}x${span}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Mode: screens ──────────────────────────────────────────────────────────

function modeScreens(entries: LogEntry[], opts: Options): string {
  // Collect screen lifecycle events: ui.screen, ui.screen.diff, lifecycle.mount/unmount
  const screenEvents = entries.filter(
    (e) =>
      e.event === 'ui.screen' ||
      e.event === 'ui.screen.diff' ||
      e.event === 'lifecycle.mount' ||
      e.event === 'lifecycle.unmount'
  );

  if (screenEvents.length === 0)
    return 'No screen events found. Ensure <Screen> and useLifecycleLogger kill switches are removed.';

  const lines: string[] = [];

  // ── Section 1: Navigation flow (mount/unmount timeline with durations) ──
  const mounts = new Map<string, number>(); // component → mount timestamp
  const durations: Array<{ component: string; duration: number; mountT: number }> = [];
  const mountOrder: Array<{ component: string; t: number; action: 'mount' | 'unmount' }> = [];

  for (const e of screenEvents) {
    const t = e._t ?? 0;
    if (e.event === 'lifecycle.mount') {
      const name = (e.params?.component as string) ?? '?';
      mounts.set(name, t);
      mountOrder.push({ component: name, t, action: 'mount' });
    } else if (e.event === 'lifecycle.unmount') {
      const name = (e.params?.component as string) ?? '?';
      const mountT = mounts.get(name);
      if (mountT !== undefined) {
        durations.push({ component: name, duration: t - mountT, mountT });
        mounts.delete(name);
      }
      mountOrder.push({ component: name, t, action: 'unmount' });
    }
  }

  if (mountOrder.length > 0) {
    lines.push('NAVIGATION FLOW:');
    lines.push('');
    let prevT: number | null = null;
    const { page: mountPage, footer: mountFooter } = paginate(mountOrder, opts);
    for (const m of mountPage) {
      const delta = prevT !== null ? m.t - prevT : 0;
      prevT = m.t;
      const icon = m.action === 'mount' ? '→' : '←';
      const dur =
        m.action === 'unmount'
          ? (() => {
              const d = durations.find((d) => d.component === m.component);
              return d ? ` (visible ${formatDelta(d.duration).trim()})` : '';
            })()
          : '';
      lines.push(`${formatDelta(delta)} ${icon} ${m.component}${dur}`);
    }
    lines.push(mountFooter);
    lines.push('');
  }

  // ── Section 2: Screen content snapshots ──
  const contentEvents = screenEvents.filter(
    (e) => e.event === 'ui.screen' || e.event === 'ui.screen.diff'
  );
  if (contentEvents.length > 0) {
    lines.push('SCREEN CONTENT:');
    lines.push('');
    let prevT: number | null = null;
    for (const e of contentEvents) {
      const t = e._t ?? 0;
      const delta = prevT !== null ? t - prevT : 0;
      prevT = t;
      const screen = (e.params?.screen as string) ?? '?';
      if (e.event === 'ui.screen') {
        const content = e.params?.content as string[] | undefined;
        lines.push(`${formatDelta(delta)} [mount] ${screen}`);
        if (content?.length) {
          for (const c of content.slice(0, 10)) {
            lines.push(`           ${c}`);
          }
          if (content.length > 10) lines.push(`           ... +${content.length - 10} more`);
        }
      } else {
        const added = e.params?.added as string[] | undefined;
        const removed = e.params?.removed as string[] | undefined;
        lines.push(`${formatDelta(delta)} [diff]  ${screen}`);
        if (removed?.length) lines.push(`           - ${removed.join(', ')}`);
        if (added?.length) lines.push(`           + ${added.join(', ')}`);
      }
    }
    lines.push('');
  }

  // ── Section 3: Still-mounted screens (never unmounted) ──
  if (mounts.size > 0) {
    lines.push('STILL MOUNTED (never unmounted during session):');
    for (const [name, t] of mounts) {
      lines.push(`  ${name} (mounted at ${Math.round(t)}ms)`);
    }
    lines.push('');
  }

  // ── Section 4: Screen duration summary ──
  if (durations.length > 0) {
    lines.push('SCREEN DURATIONS:');
    durations.sort((a, b) => b.duration - a.duration);
    for (const d of durations.slice(0, 20)) {
      lines.push(`  ${formatDelta(d.duration).trim().padEnd(10)} ${d.component}`);
    }
  }

  return lines.join('\n');
}

// ─── Mode: startup ──────────────────────────────────────────────────────────

function modeStartup(entries: LogEntry[], _opts: Options): string {
  // Build a per-stage timeline from init.timing + gate events
  interface Stage {
    id: string;
    startMs: number;
    endMs: number | null;
    messages: string[];
  }

  const stages = new Map<string, Stage>();
  const gateEvents: Array<{ event: string; t: number }> = [];
  let appReadyMs: number | null = null;
  let splashHideMs: number | null = null;

  for (const e of entries) {
    const t = e._t ?? 0;

    if (e.event === 'init.timing') {
      const tag = (e.params?.tag as string) ?? '';
      const msg = String(e.params?.msg ?? '');
      const offsetMs = (e.params?.offsetMs as number) ?? t;

      if (!stages.has(tag)) {
        stages.set(tag, { id: tag, startMs: offsetMs, endMs: null, messages: [] });
      }
      const stage = stages.get(tag)!;
      stage.endMs = offsetMs;
      stage.messages.push(msg);

      if (msg.includes('SplashScreen') && msg.includes('hid')) splashHideMs = offsetMs;
    }

    if (e.event.startsWith('gate.')) {
      gateEvents.push({ event: e.event, t });
    }

    if (e.event === 'gate.app.ready' && appReadyMs === null) {
      appReadyMs = t;
    }
  }

  const lines: string[] = [];
  lines.push('STARTUP WATERFALL:');
  lines.push('');

  // Sort stages by start time
  const sorted = [...stages.values()].sort((a, b) => a.startMs - b.startMs);

  // Find the latest end to compute total span
  const maxEnd = Math.max(...sorted.map((s) => s.endMs ?? s.startMs));
  const minStart = sorted.length > 0 ? sorted[0].startMs : 0;

  for (const stage of sorted) {
    const duration = (stage.endMs ?? stage.startMs) - stage.startMs;
    const start = Math.round(stage.startMs);
    const durStr =
      duration < 1
        ? '<1ms'
        : duration < 1000
          ? `${Math.round(duration)}ms`
          : `${(duration / 1000).toFixed(1)}s`;
    const bar =
      duration > 0
        ? '█'.repeat(Math.max(1, Math.round((duration / (maxEnd - minStart)) * 40)))
        : '·';
    lines.push(`  ${String(start).padStart(7)}ms  ${bar} ${stage.id} (${durStr})`);
  }
  lines.push('');

  // Key milestones
  lines.push('MILESTONES:');
  if (splashHideMs !== null) lines.push(`  Splash hidden:   ${Math.round(splashHideMs)}ms`);
  if (appReadyMs !== null) lines.push(`  App ready:       ${Math.round(appReadyMs)}ms`);
  lines.push(`  Total init span: ${Math.round(maxEnd - minStart)}ms`);
  lines.push('');

  // Gate timeline
  if (gateEvents.length > 0) {
    lines.push('GATES:');
    for (const g of gateEvents) {
      const relMs = Math.round(g.t - (entries[0]._t ?? 0));
      lines.push(`  ${String(relMs).padStart(7)}ms  ${g.event}`);
    }
  }

  return lines.join('\n');
}

// ─── Mode: coco ─────────────────────────────────────────────────────────────

function isCocoDiagnosticEvent(e: LogEntry): boolean {
  return e.event.startsWith('coco.') || e.event.startsWith('colada.');
}

function cocoModuleName(event: string): string {
  const parts = event.split('.');
  if (parts[0] === '@sovranbitcoin/colada') return `${parts[0]}.${parts[1] ?? 'unknown'}`;
  return parts[1] ?? 'unknown';
}

function modeCoco(entries: LogEntry[], opts: Options): string {
  // Coco events come from CocoLogger; Colada emits wallet-boundary diagnostics
  // under "colada." so this mode can trace a user action across both layers.
  const cocoEntries = entries.filter(isCocoDiagnosticEvent);

  if (cocoEntries.length === 0)
    return 'No coco/colada events found. Ensure CocoLogger and Colada logger are wired into the app logger.';

  const lines: string[] = [];

  // ── Section 1: Module breakdown ──
  const moduleCounts = new Map<
    string,
    { debug: number; info: number; warn: number; error: number }
  >();
  for (const e of cocoEntries) {
    // event format: coco.<module>.<event_key> or colada.<module>.<event_key>
    const module = cocoModuleName(e.event);
    const counts = moduleCounts.get(module) ?? { debug: 0, info: 0, warn: 0, error: 0 };
    const level = e.level as keyof typeof counts;
    if (level in counts) counts[level]++;
    moduleCounts.set(module, counts);
  }

  lines.push('COCO/COLADA MODULE BREAKDOWN:');
  lines.push('');
  const sortedModules = [...moduleCounts.entries()].sort((a, b) => {
    const aTotal = a[1].debug + a[1].info + a[1].warn + a[1].error;
    const bTotal = b[1].debug + b[1].info + b[1].warn + b[1].error;
    return bTotal - aTotal;
  });
  for (const [mod, counts] of sortedModules) {
    const total = counts.debug + counts.info + counts.warn + counts.error;
    const parts = [`${total} total`];
    if (counts.error > 0) parts.push(`${counts.error} errors`);
    if (counts.warn > 0) parts.push(`${counts.warn} warns`);
    lines.push(`  ${mod.padEnd(30)} ${parts.join(', ')}`);
  }
  lines.push('');

  // ── Section 2: Warnings and errors with context ──
  const issues = cocoEntries.filter((e) => e.level === 'warn' || e.level === 'error');
  if (issues.length > 0) {
    lines.push(`COCO/COLADA ISSUES (${issues.length} warnings/errors):`);
    lines.push('');
    // Deduplicate by message
    const byMsg = new Map<
      string,
      { count: number; level: string; event: string; params: Record<string, unknown> | undefined }
    >();
    for (const e of issues) {
      const msg = (e.params?.msg as string) ?? e.event;
      const existing = byMsg.get(msg);
      if (existing) {
        existing.count++;
      } else {
        byMsg.set(msg, { count: 1, level: e.level, event: e.event, params: e.params });
      }
    }
    for (const [msg, info] of [...byMsg.entries()].sort((a, b) => b[1].count - a[1].count)) {
      const countStr = info.count > 1 ? ` (${info.count}x)` : '';
      lines.push(`  [${info.level.toUpperCase()}] ${msg}${countStr}`);
    }
    lines.push('');
  }

  // ── Section 3: Amount boundary diagnostics ──
  const amountEvents = cocoEntries.filter(
    (e) =>
      e.event.includes('amount') ||
      e.params?.rawAmount != null ||
      e.params?.satAmount != null ||
      e.params?.effectiveSatAmount != null
  );
  if (amountEvents.length > 0) {
    lines.push(`AMOUNT DIAGNOSTICS (${amountEvents.length} events):`);
    lines.push('');
    const notable = amountEvents
      .filter((e) => e.level !== 'debug' || e.event.includes('boundary'))
      .slice(-25);
    for (const e of notable) {
      const t = e._t ? `[${Math.round(e._t)}ms] ` : '';
      lines.push(`  ${t}${levelIcon(e.level)} ${e.event} ${shortParams(e.params, 8)}`);
    }
    lines.push('');
  }

  // ── Section 4: Mint request summary ──
  const mintRequests = cocoEntries.filter((e) => {
    const msg = (e.params?.msg as string) ?? '';
    return msg.includes('Mint request') || msg.includes('Mint response');
  });
  if (mintRequests.length > 0) {
    const byEndpoint = new Map<string, number>();
    for (const e of mintRequests) {
      const msg = (e.params?.msg as string) ?? '';
      const params = e.params as Record<string, unknown>;
      // Try to extract endpoint from msg or nested params
      const endpoint = (params?.endpoint as string) ?? msg;
      const key = endpoint.length > 60 ? endpoint.slice(0, 57) + '...' : endpoint;
      byEndpoint.set(key, (byEndpoint.get(key) ?? 0) + 1);
    }
    lines.push('MINT REQUESTS:');
    lines.push('');
    for (const [endpoint, count] of [...byEndpoint.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)) {
      lines.push(`  ${String(count).padStart(4)}x  ${endpoint}`);
    }
    lines.push('');
  }

  // ── Section 5: Timeline of key coco/colada events (non-debug) ──
  const keyEvents = cocoEntries.filter((e) => e.level !== 'debug');
  if (keyEvents.length > 0) {
    lines.push('COCO/COLADA KEY EVENTS (info/warn/error):');
    lines.push('');
    const { page, footer } = paginate(keyEvents, opts);
    let prevT: number | null = null;
    for (const e of page) {
      const t = e._t ?? 0;
      const delta = prevT !== null ? t - prevT : 0;
      prevT = t;
      const msg = (e.params?.msg as string) ?? '';
      const params = msg || shortParams(e.params);
      const shortMsg = params.length > 60 ? params.slice(0, 57) + '...' : params;
      lines.push(
        `${formatDelta(delta)} ${levelIcon(e.level)} ${e.event.padEnd(40).slice(0, 40)} ${shortMsg}`
      );
    }
    lines.push(footer);
  }

  return lines.join('\n');
}

// ─── Mode: network ───────────────────────────────────────────────────────────

function modeNetwork(entries: LogEntry[], opts: Options): string {
  const netEntries = entries.filter(
    (e) =>
      e.event.startsWith('net.') ||
      e.event.startsWith('api.') ||
      e.event.includes('fetch') ||
      e.event.includes('.ws.')
  );

  if (netEntries.length === 0) return 'No network entries found.';

  const { page, footer } = paginate(netEntries, opts);
  const lines: string[] = [];
  lines.push('NETWORK LOG:');
  lines.push('');

  for (const e of page) {
    const t = e._t ? `[${Math.round(e._t)}ms]` : '';
    lines.push(`${t} ${levelIcon(e.level)} ${e.event}  ${shortParams(e.params)}`);
  }

  lines.push(footer);
  return lines.join('\n');
}

function modeFeed(entries: LogEntry[], opts: Options): string {
  const feedEntries = entries.filter(
    (e) =>
      e.event.startsWith('feed.') ||
      e.event.startsWith('thread.') ||
      e.event.startsWith('nagg.graphql.') ||
      e.event === 'api.fetch' ||
      e.event.startsWith('api.fetch_') ||
      e.event === 'api.parse_failed'
  );

  if (feedEntries.length === 0) return 'No feed/thread entries found.';

  const lines: string[] = [];
  const warnings = feedEntries.filter((e) => e.level === 'warn').length;
  const errors = feedEntries.filter((e) => e.level === 'error' || e.level === 'fatal').length;
  const gqlEntries = feedEntries.filter((e) => e.event.startsWith('nagg.graphql.'));
  const feedPages = feedEntries.filter((e) => e.event === 'feed.nagg.page.done');
  const threadResults = feedEntries.filter(
    (e) => e.event === 'thread.nagg.graphql.result' || e.event === 'thread.load.done'
  );
  const threadSeeds = feedEntries.filter((e) => e.event.startsWith('thread.seed.'));

  lines.push('FEED/THREAD LOG:');
  lines.push(
    `  entries=${feedEntries.length} warnings=${warnings} errors=${errors} graphql=${gqlEntries.length} feedPages=${feedPages.length} threadResults=${threadResults.length}`
  );
  lines.push('');

  if (gqlEntries.length > 0) {
    const opCounts = new Map<string, number>();
    for (const e of gqlEntries) {
      const op = String(e.params?.operationName ?? '?');
      const suffix = e.event.replace('nagg.graphql.request.', '').replace('nagg.graphql.', '');
      const key = `${op}:${suffix}`;
      opCounts.set(key, (opCounts.get(key) ?? 0) + 1);
    }
    lines.push('GRAPHQL OPS:');
    for (const [key, count] of Array.from(opCounts.entries()).slice(0, 16)) {
      lines.push(`  ${key} x${count}`);
    }
    lines.push('');
  }

  if (feedPages.length > 0) {
    lines.push('FEED PAGES:');
    for (const e of feedPages.slice(-12)) {
      const p = e.params ?? {};
      const t = e._t ? `[${Math.round(e._t)}ms]` : '';
      lines.push(
        `${t} ${p.source ?? '?'} items=${p.items ?? '?'} previews=${p.replyPreviews ?? '?'} ` +
          `profiles=${p.profiles ?? '?'} missingProfiles=${p.missingProfiles ?? '?'} ` +
          `offset=${p.offset ?? '?'} duration=${p.durationMs ?? '?'}ms`
      );
    }
    lines.push('');
  }

  if (threadSeeds.length > 0 || threadResults.length > 0) {
    lines.push('THREADS:');
    for (const e of [...threadSeeds.slice(-6), ...threadResults.slice(-12)]) {
      const p = e.params ?? {};
      const t = e._t ? `[${Math.round(e._t)}ms]` : '';
      lines.push(
        `${t} ${e.event} event=${p.eventId ?? '?'} sort=${p.replySort ?? p.sort ?? '?'} ` +
          `nodes=${p.replyNodeCount ?? '?'} rendered=${p.renderedReplies ?? p.replies ?? '?'} ` +
          `hidden=${p.hiddenReplies ?? '?'} expected=${p.expectedReplies ?? p.targetReplyCount ?? '?'} ` +
          `hasMore=${p.hasMoreReplies ?? '?'} duration=${p.durationMs ?? '?'}ms`
      );
    }
    lines.push('');
  }

  const problemEntries = feedEntries.filter(
    (e) =>
      e.level === 'warn' ||
      e.level === 'error' ||
      e.level === 'fatal' ||
      e.event.endsWith('.error') ||
      e.event.endsWith('.graphql_error') ||
      e.event.endsWith('.aborted')
  );
  if (problemEntries.length > 0) {
    lines.push('PROBLEMS:');
    for (const e of problemEntries.slice(-16)) {
      const t = e._t ? `[${Math.round(e._t)}ms]` : '';
      lines.push(`${t} ${levelIcon(e.level)} ${e.event} ${shortParams(e.params)}`);
    }
    lines.push('');
  }

  const { page, footer } = paginate(feedEntries, opts);
  lines.push('TIMELINE:');
  for (const e of page) {
    const t = e._t ? `[${Math.round(e._t)}ms]` : '';
    lines.push(`${t} ${levelIcon(e.level)} ${e.event} ${shortParams(e.params)}`);
  }
  lines.push(footer);
  return lines.join('\n');
}

// ─── Mode: full ──────────────────────────────────────────────────────────────

function modeFull(entries: LogEntry[], opts: Options): string {
  const deduped: Array<LogEntry & { _count?: number }> = [];

  for (const e of entries) {
    const prev = deduped[deduped.length - 1];
    if (
      prev &&
      prev.event === e.event &&
      JSON.stringify(prev.params) === JSON.stringify(e.params) &&
      prev.level === e.level
    ) {
      prev._count = (prev._count ?? 1) + 1;
    } else {
      deduped.push({ ...e, _count: 1 });
    }
  }

  const saved = entries.length - deduped.length;
  const { page, footer } = paginate(deduped, opts);

  const lines: string[] = [];
  if (saved > 0) {
    lines.push(
      `// Deduplicated: ${entries.length} entries -> ${deduped.length} (${saved} duplicates removed)`
    );
  }

  // ── Pipe-delimited markdown format (~40% fewer tokens than JSON) ──
  if (opts.format === 'md') {
    lines.push('_t|Δ|lvl|event|src|params|err');
    let prevT: number | null = null;
    for (const e of page) {
      const t = e._t ?? 0;
      const delta = prevT !== null ? Math.round(t - prevT) : 0;
      prevT = t;
      const lvl =
        e.level === 'debug'
          ? 'DBG'
          : e.level === 'info'
            ? 'INF'
            : e.level.slice(0, 3).toUpperCase();
      const deltaStr = delta > 0 ? `+${delta}` : '';
      const params = shortParams(e.params);
      const rep = (e._count ?? 1) > 1 ? ` x${e._count}` : '';
      const err = e.error ? `${e.error.name}:${e.error.message}` : '';
      lines.push(
        `${Math.round(t)}|${deltaStr}|${lvl}|${e.event}|${shortSrc(e.src)}|${params}${rep}|${err}`
      );
    }
    lines.push(footer);
    return lines.join('\n');
  }

  // ── YAML inline format (best LLM comprehension for nested data) ──
  if (opts.format === 'yaml') {
    let prevT: number | null = null;
    for (const e of page) {
      const t = e._t ?? 0;
      const delta = prevT !== null ? Math.round(t - prevT) : 0;
      prevT = t;
      const parts: string[] = [`- {_t: ${Math.round(t)}`];
      if (delta > 0) parts.push(`d: ${delta}`);
      parts.push(`lvl: ${e.level}, ev: ${e.event}`);
      if ((e._count ?? 1) > 1) parts.push(`x: ${e._count}`);
      if (e.params) {
        const p: any = { ...e.params };
        delete p._dedup;
        if (Object.keys(p).length > 0) parts.push(`p: ${JSON.stringify(p)}`);
      }
      if (e.error) parts.push(`err: "${e.error.name}: ${e.error.message}"`);
      if (e.ctx) parts.push(`ctx: ${JSON.stringify(e.ctx)}`);
      lines.push(parts.join(', ') + '}');
    }
    lines.push(footer);
    return lines.join('\n');
  }

  // ── Default: JSON ──
  for (const e of page) {
    const entry: any = { ...e };
    if (e._count && e._count > 1) entry._repeated = e._count;
    delete entry._count;
    if (opts.noDevice) delete entry.device;
    lines.push(JSON.stringify(entry));
  }

  lines.push(footer);
  return lines.join('\n');
}

// ─── Mode: diff ─────────────────────────────────────────────────────────────
// Compare the latest session against the previous one to isolate
// failure-specific entries. Based on LogSage's session diff technique:
// lines present in the failing session but absent from the baseline are signal.

function modeDiff(allEntries: LogEntry[], _opts: Options): string {
  // Find session boundaries (same logic as extractLatestSession)
  const boundaries: number[] = [0];
  let prevT = -1;
  for (let i = 0; i < allEntries.length; i++) {
    const t = allEntries[i]._t ?? 0;
    if (prevT >= 0) {
      const delta = t - prevT;
      if (delta < -500 || delta > 60_000) boundaries.push(i);
    }
    prevT = t;
  }

  if (boundaries.length < 2) {
    return 'Only one session found — need at least two sessions to diff.\nRun the app twice with logs piped to log.txt, then re-run diff.';
  }

  // Last two sessions
  const prevStart = boundaries[boundaries.length - 2];
  const currStart = boundaries[boundaries.length - 1];
  const prevSession = allEntries.slice(prevStart, currStart);
  const currSession = allEntries.slice(currStart);

  // Build event template: "level|event|param_keys" — the invariant shape of each log type
  const templateOf = (e: LogEntry): string => {
    const paramKeys = e.params ? Object.keys(e.params).sort().join(',') : '';
    return `${e.level}|${e.event}|${paramKeys}`;
  };

  const prevTemplates = new Map<string, number>();
  for (const e of prevSession) {
    const t = templateOf(e);
    prevTemplates.set(t, (prevTemplates.get(t) ?? 0) + 1);
  }

  const currTemplates = new Map<string, number>();
  for (const e of currSession) {
    const t = templateOf(e);
    currTemplates.set(t, (currTemplates.get(t) ?? 0) + 1);
  }

  // Entries unique to the current (failing) session
  const onlyCurr: Array<{ template: string; count: number; sample: LogEntry }> = [];
  const seen = new Set<string>();
  for (const e of currSession) {
    const t = templateOf(e);
    if (!prevTemplates.has(t) && !seen.has(t)) {
      seen.add(t);
      onlyCurr.push({ template: t, count: currTemplates.get(t) ?? 1, sample: e });
    }
  }

  // Templates significantly more frequent in current session
  const countDiffs: Array<{ event: string; prev: number; curr: number }> = [];
  for (const [t, currCount] of currTemplates) {
    const prevCount = prevTemplates.get(t) ?? 0;
    if (prevCount > 0 && currCount > prevCount * 2 && currCount - prevCount >= 3) {
      const sample = currSession.find((e) => templateOf(e) === t)!;
      countDiffs.push({ event: sample.event, prev: prevCount, curr: currCount });
    }
  }

  // Entries unique to the previous (baseline) session
  const onlyPrev: Array<{ template: string; count: number; sample: LogEntry }> = [];
  const seenPrev = new Set<string>();
  for (const e of prevSession) {
    const t = templateOf(e);
    if (!currTemplates.has(t) && !seenPrev.has(t)) {
      seenPrev.add(t);
      onlyPrev.push({ template: t, count: prevTemplates.get(t) ?? 1, sample: e });
    }
  }

  const lines: string[] = [];
  lines.push('SESSION DIFF (latest vs previous):');
  lines.push(`  Previous session: ${prevSession.length} entries`);
  lines.push(`  Current session:  ${currSession.length} entries`);
  lines.push('');

  if (onlyCurr.length > 0) {
    lines.push(`ONLY IN CURRENT SESSION (${onlyCurr.length} unique event types):`);
    lines.push('  These entries appear in the failing session but NOT in the baseline.');
    lines.push('');
    onlyCurr.sort((a, b) => b.count - a.count);
    for (const o of onlyCurr.slice(0, 30)) {
      const params = shortParams(o.sample.params);
      const countStr = o.count > 1 ? ` (${o.count}x)` : '';
      lines.push(`  ${levelIcon(o.sample.level)} ${o.sample.event}${countStr}  ${params}`);
      if (o.sample.error) {
        lines.push(`       ERR: ${o.sample.error.name}: ${o.sample.error.message}`);
      }
    }
    if (onlyCurr.length > 30) lines.push(`  ... +${onlyCurr.length - 30} more`);
    lines.push('');
  } else {
    lines.push('No event types unique to the current session.');
    lines.push('');
  }

  if (countDiffs.length > 0) {
    lines.push('SIGNIFICANTLY MORE FREQUENT IN CURRENT SESSION:');
    lines.push('');
    countDiffs.sort((a, b) => b.curr - b.prev - (a.curr - a.prev));
    for (const d of countDiffs.slice(0, 15)) {
      lines.push(`  ${d.event}: ${d.prev}x -> ${d.curr}x (+${d.curr - d.prev})`);
    }
    lines.push('');
  }

  if (onlyPrev.length > 0) {
    lines.push(`MISSING FROM CURRENT SESSION (${onlyPrev.length} event types):`);
    lines.push('  These entries appeared in the baseline but are absent now.');
    lines.push('');
    onlyPrev.sort((a, b) => b.count - a.count);
    for (const o of onlyPrev.slice(0, 20)) {
      const params = shortParams(o.sample.params);
      const countStr = o.count > 1 ? ` (${o.count}x)` : '';
      lines.push(`  ${levelIcon(o.sample.level)} ${o.sample.event}${countStr}  ${params}`);
    }
    if (onlyPrev.length > 20) lines.push(`  ... +${onlyPrev.length - 20} more`);
  }

  return lines.join('\n');
}

// ─── Mode: flows ────────────────────────────────────────────────────────────
// Reconstructs cross-async operation traces using flowId in ctx.
// Shows each flow as a timeline with relative timing and outcome.

function modeFlows(entries: LogEntry[], opts: Options): string {
  // Group entries by flowId
  const flows = new Map<string, LogEntry[]>();
  for (const e of entries) {
    const flowId = (e.ctx as any)?.flowId as string | undefined;
    if (!flowId) continue;
    if (!flows.has(flowId)) flows.set(flowId, []);
    flows.get(flowId)!.push(e);
  }

  if (flows.size === 0) {
    return 'No flow entries found. Use startFlow() in the app to trace user actions across async boundaries.';
  }

  const lines: string[] = [];
  lines.push(`FLOW ANALYSIS (${flows.size} flows):`);
  lines.push('');

  const flowEntries = [...flows.entries()].sort((a, b) => {
    const aStart = a[1][0]._t ?? 0;
    const bStart = b[1][0]._t ?? 0;
    return aStart - bStart;
  });

  const { page, footer } = paginate(flowEntries, opts);

  for (const [flowId, events] of page) {
    const first = events[0];
    const last = events[events.length - 1];
    const duration = Math.round(((last._t ?? 0) - (first._t ?? 0)) * 100) / 100;

    // Determine outcome
    const hasError = events.some((e) => e.level === 'error' || e.level === 'fatal');
    const hasEnd = events.some((e) => e.event === 'flow.end');
    const outcome = hasError ? 'ERROR' : hasEnd ? 'COMPLETED' : 'IN-PROGRESS';

    lines.push(`  ${flowId} (${duration}ms, ${outcome})`);

    const startT = first._t ?? 0;
    for (const e of events) {
      const rel = Math.round(((e._t ?? 0) - startT) * 100) / 100;
      const params = shortParams(e.params);
      const err = e.error ? ` ERR:${e.error.name}:${e.error.message}` : '';
      lines.push(
        `    +${rel}ms  ${levelIcon(e.level)} ${e.event.padEnd(35).slice(0, 35)} ${params}${err}`
      );
    }
    lines.push('');
  }

  lines.push(footer);
  return lines.join('\n');
}

// ─── Mode: ws ───────────────────────────────────────────────────────────────
// WebSocket connection health and subscription analysis.

function extractHost(url: string): string {
  return url.replace(/^(wss?|https?):\/\//, '').split('/')[0];
}

function modeWS(entries: LogEntry[], _opts: Options): string {
  const wsEntries = entries.filter(
    (e) =>
      e.event.startsWith('ws.') ||
      e.event.includes('.ws.') ||
      e.event.includes('ws_error') ||
      e.event.includes('subscribe') ||
      e.event.includes('ws_message') ||
      e.event.includes('socket')
  );

  if (wsEntries.length === 0) return 'No WebSocket entries found.';

  const lines: string[] = [];

  // ── Connection lifecycle ──
  const connections = new Map<
    string,
    {
      opens: number;
      closes: number;
      errors: number;
      reconnects: number;
      lastCode?: number;
      lastReason?: string;
    }
  >();
  for (const e of wsEntries) {
    // Match both our ws.* events and coco's ws_error/ws_* events
    const isWsLifecycle = e.event.startsWith('ws.') || e.event.includes('ws_error');
    if (!isWsLifecycle) continue;
    const url = (e.params?.url as string) ?? (e.params?.mintUrl as string) ?? 'unknown';
    const host = extractHost(url);
    if (!connections.has(host))
      connections.set(host, { opens: 0, closes: 0, errors: 0, reconnects: 0 });
    const conn = connections.get(host)!;
    if (e.event === 'ws.open') conn.opens++;
    else if (e.event === 'ws.close') {
      conn.closes++;
      conn.lastCode = e.params?.code as number;
      conn.lastReason = e.params?.reason as string;
    } else if (e.event === 'ws.error' || e.event.includes('ws_error')) conn.errors++;
    else if (e.event === 'ws.reconnect') conn.reconnects++;
  }

  if (connections.size > 0) {
    lines.push('WEBSOCKET CONNECTIONS:');
    lines.push('');
    for (const [host, c] of [...connections.entries()].sort((a, b) => b[1].errors - a[1].errors)) {
      const status = c.opens > c.closes ? 'OPEN' : 'CLOSED';
      lines.push(`  ${host}  [${status}]`);
      lines.push(
        `    opens=${c.opens} closes=${c.closes} errors=${c.errors} reconnects=${c.reconnects}`
      );
      if (c.lastCode)
        lines.push(`    last close: code=${c.lastCode} reason="${c.lastReason ?? ''}"`);
    }
    lines.push('');
  }

  // ── Subscription health ──
  const subRequests = wsEntries.filter(
    (e) => e.event.includes('subscribe') && !e.event.includes('unsubscribe')
  );
  const subAccepted = wsEntries.filter(
    (e) => e.event.includes('subscribe_request_accepted') || e.event.includes('subscribed_to')
  );
  const unmatched = wsEntries.filter((e) => e.event.includes('unmatched'));
  const queued = wsEntries.filter((e) => e.event.includes('queued_message'));

  lines.push('SUBSCRIPTION HEALTH:');
  lines.push(`  Requests:  ${subRequests.length}`);
  lines.push(`  Accepted:  ${subAccepted.length}`);
  if (unmatched.length > 0) lines.push(`  Unmatched: ${unmatched.length}  <- investigate`);
  if (queued.length > 0)
    lines.push(`  Queued:    ${queued.length} (socket not open at time of send)`);
  lines.push('');

  // ── Message rate by host ──
  const msgByHost = new Map<string, { count: number; firstT: number; lastT: number }>();
  for (const e of wsEntries) {
    if (!e.event.includes('ws_message') && !e.event.includes('ws.rate')) continue;
    const url = (e.params?.mintUrl as string) ?? (e.params?.url as string) ?? 'unknown';
    const host = extractHost(url);
    const t = e._t ?? 0;
    const existing = msgByHost.get(host);
    if (existing) {
      existing.count++;
      existing.lastT = t;
    } else msgByHost.set(host, { count: 1, firstT: t, lastT: t });
  }

  if (msgByHost.size > 0) {
    lines.push('MESSAGE RATES:');
    for (const [host, m] of [...msgByHost.entries()].sort((a, b) => b[1].count - a[1].count)) {
      const span = (m.lastT - m.firstT) / 1000;
      const rate = span > 0 ? (m.count / span).toFixed(1) : '∞';
      lines.push(`  ${host}: ${m.count} msgs (${rate}/s over ${span.toFixed(1)}s)`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Mode: gc ───────────────────────────────────────────────────────────────
// Memory and garbage collection trend analysis from perf.hermes entries.

function modeGC(entries: LogEntry[], _opts: Options): string {
  const hermesEntries = entries.filter((e) => e.event === 'perf.hermes');
  const threadEntries = entries.filter((e) => e.event === 'perf.js_thread.blocked');

  if (hermesEntries.length === 0 && threadEntries.length === 0) {
    return 'No Hermes/GC entries found. Call logHermesStats() and startThreadMonitor() in the app to enable.';
  }

  const lines: string[] = [];

  if (hermesEntries.length > 0) {
    lines.push('HEAP TREND:');
    lines.push('');

    let prevHeap = 0;
    let prevGCs = 0;
    const firstT = hermesEntries[0]._t ?? 0;

    for (const e of hermesEntries) {
      const t = (e._t ?? 0) - firstT;
      const heap = (e.params?.heapSize as number) ?? 0;
      const heapMB = (heap / (1024 * 1024)).toFixed(1);
      const delta = heap - prevHeap;
      const deltaMB = (delta / (1024 * 1024)).toFixed(1);
      const gcs = (e.params?.numGCs as number) ?? 0;
      const gcDelta = gcs - prevGCs;

      const sign = delta >= 0 ? '+' : '';
      const alert = delta > 2 * 1024 * 1024 ? '  <- GROWTH' : '';
      lines.push(
        `  T+${(t / 1000).toFixed(0)}s  ${heapMB} MB  (${sign}${deltaMB} MB)  GC: ${gcDelta}${alert}`
      );

      prevHeap = heap;
      prevGCs = gcs;
    }
    lines.push('');

    // Leak detection: check if heap is monotonically increasing
    const heapValues = hermesEntries.map((e) => (e.params?.heapSize as number) ?? 0);
    let monotonic = true;
    for (let i = 1; i < heapValues.length; i++) {
      if (heapValues[i] < heapValues[i - 1] * 0.95) {
        monotonic = false;
        break;
      }
    }
    if (monotonic && heapValues.length >= 3) {
      const growth = heapValues[heapValues.length - 1] - heapValues[0];
      lines.push(
        `LEAK DETECTED: heap grew monotonically by ${(growth / (1024 * 1024)).toFixed(1)} MB over ${hermesEntries.length} samples`
      );
      lines.push('');
    }
  }

  if (threadEntries.length > 0) {
    lines.push(`JS THREAD BLOCKS (${threadEntries.length} detected):`);
    lines.push('');
    threadEntries.sort(
      (a, b) => ((b.params?.drift_ms as number) ?? 0) - ((a.params?.drift_ms as number) ?? 0)
    );
    for (const e of threadEntries.slice(0, 15)) {
      const drift = (e.params?.drift_ms as number) ?? 0;
      const frames = (e.params?.frames_dropped as number) ?? 0;
      lines.push(`  [${Math.round(e._t ?? 0)}ms] ${drift}ms drift (${frames} frames dropped)`);
    }
    if (threadEntries.length > 15) lines.push(`  ... +${threadEntries.length - 15} more`);
    lines.push('');

    // Correlate: find nearby events around the worst blocks
    const worst = threadEntries[0];
    if (worst) {
      const worstT = worst._t ?? 0;
      const nearby = entries
        .filter((e) => {
          const t = e._t ?? 0;
          return t >= worstT - 500 && t <= worstT + 100 && e !== worst;
        })
        .slice(0, 5);
      if (nearby.length > 0) {
        lines.push(`EVENTS NEAR WORST BLOCK (${Math.round(worstT)}ms):`);
        for (const e of nearby) {
          lines.push(`  [${Math.round(e._t ?? 0)}ms] ${e.event}  ${shortParams(e.params)}`);
        }
      }
    }
  }

  return lines.join('\n');
}

// ─── Mode: crypto ───────────────────────────────────────────────────────────

function modeCrypto(entries: LogEntry[], opts: Options): string {
  // Crypto ops come from __CASHU_PERF or native_crypto events
  const cryptoOps = [
    'hashToCurve',
    'hash_e',
    'blindMessage',
    'unblind',
    'constructProof',
    'schnorr.sign',
    'schnorr.verify',
    'dleq.verify',
    'dleq.verifyReblind',
    'derive_deprecated',
    'deriveBoth',
    'createDeterministicData_batch',
    'createRandomData',
    'createSingleRandomData',
    'outputData.toProof',
    'encodeToken',
    'decodeToken',
    'wallet.checkProofsStates',
  ];

  // Find cashu.native_crypto events
  const nativeCryptoEntries = entries.filter((e) => e.event === 'cashu.native_crypto.enabled');

  // Find coco perf entries with crypto timing
  const perfEntries = entries.filter((e) => {
    const params = e.params as Record<string, unknown> | undefined;
    return params?._perf === true && typeof params?.ms === 'number';
  });

  // Find entries that match our crypto operations by event name patterns
  const cryptoEntries = entries.filter((e) => {
    return (
      cryptoOps.some((op) => e.event.includes(op)) ||
      e.event.includes('native_crypto') ||
      e.event.includes('hashToCurve') ||
      e.event.includes('blind') ||
      e.event.includes('unblind')
    );
  });

  const lines: string[] = [];
  lines.push('=== CRYPTO OPERATIONS ANALYSIS ===');
  lines.push('');

  // Native crypto status
  if (nativeCryptoEntries.length > 0) {
    const lastEntry = nativeCryptoEntries[nativeCryptoEntries.length - 1];
    const funcs = (lastEntry.params as Record<string, unknown>)?.functions;
    lines.push(`Native crypto: ENABLED`);
    lines.push(`  Functions: ${JSON.stringify(funcs)}`);
  } else {
    lines.push('Native crypto: NOT DETECTED (JS fallback)');
  }
  lines.push('');

  // Aggregate perf entries by operation type
  const byOp = new Map<
    string,
    {
      count: number;
      totalMs: number;
      minMs: number;
      maxMs: number;
      native: number;
      jsCount: number;
    }
  >();
  for (const e of perfEntries) {
    const params = e.params as Record<string, unknown>;
    // Try to extract op from event name
    let op = e.event;
    if (op.startsWith('coco.')) op = op.replace('coco.', '');

    const ms = params.ms as number;
    const isNative = params.native === true;
    const existing = byOp.get(op) ?? {
      count: 0,
      totalMs: 0,
      minMs: Infinity,
      maxMs: 0,
      native: 0,
      jsCount: 0,
    };
    existing.count++;
    existing.totalMs += ms;
    existing.minMs = Math.min(existing.minMs, ms);
    existing.maxMs = Math.max(existing.maxMs, ms);
    if (isNative) existing.native++;
    else existing.jsCount++;
    byOp.set(op, existing);
  }

  if (byOp.size > 0) {
    lines.push('PERF-TAGGED OPERATIONS:');
    lines.push('');
    lines.push('  Operation                          Count   Total ms   Avg ms   Min      Max');
    lines.push('  ' + '-'.repeat(85));
    for (const [op, stats] of [...byOp.entries()].sort((a, b) => b[1].totalMs - a[1].totalMs)) {
      const avg = stats.totalMs / stats.count;
      const nativeTag = stats.native > 0 ? ` [${stats.native} native]` : '';
      lines.push(
        `  ${op.padEnd(35)} ${String(stats.count).padStart(5)}   ${stats.totalMs.toFixed(1).padStart(8)}   ${avg.toFixed(2).padStart(6)}   ${stats.minMs.toFixed(2).padStart(6)}   ${stats.maxMs.toFixed(2).padStart(6)}${nativeTag}`
      );
    }
    lines.push('');
  }

  // Show timeline of crypto events
  if (cryptoEntries.length > 0) {
    lines.push(`CRYPTO EVENT TIMELINE (${cryptoEntries.length} entries):`);
    lines.push('');
    const { page, footer } = paginate(cryptoEntries, opts);
    let prevT: number | null = null;
    for (const e of page) {
      const t = e._t ?? 0;
      const delta = prevT !== null ? t - prevT : 0;
      prevT = t;
      const params = e.params as Record<string, unknown> | undefined;
      const ms = params?.ms as number | undefined;
      const msStr = ms !== undefined ? `${ms.toFixed(2)}ms` : '';
      lines.push(
        `${formatDelta(delta)} ${levelIcon(e.level)} ${e.event.padEnd(40).slice(0, 40)} ${msStr}`
      );
    }
    lines.push(footer);
  }

  return lines.join('\n');
}

// ─── Mode: ops ──────────────────────────────────────────────────────────────

function modeOps(entries: LogEntry[], opts: Options): string {
  // Operation phase tracking for mint/melt/send/receive flows
  const opPatterns = [
    { prefix: 'colada.operations.', name: 'Colada Operations' },
    { prefix: 'colada.amount.', name: 'Colada Amount' },
    { prefix: 'colada.amount_actions.', name: 'Colada Amount Actions' },
    { prefix: 'colada.amount_boundary.', name: 'Colada Amount Boundary' },
    { prefix: 'colada.bolt11.', name: 'Colada Bolt11' },
    { prefix: 'colada.lnurl.', name: 'Colada LNURL' },
    { prefix: 'colada.flow.', name: 'Colada Flow' },
    { prefix: 'colada.screen.', name: 'Colada Screen' },
    { prefix: 'colada.sovran.', name: 'Sovran Colada Boundary' },
    { prefix: 'coco.mint.', name: 'Mint' },
    { prefix: 'coco.melt.', name: 'Melt' },
    { prefix: 'coco.send.', name: 'Send' },
    { prefix: 'coco.receive.', name: 'Receive' },
    { prefix: 'coco.restore.', name: 'Restore' },
    { prefix: 'coco.proof.', name: 'Proof' },
    { prefix: 'coco.wallet.', name: 'Wallet' },
  ];

  const lines: string[] = [];
  lines.push('=== OPERATION PHASE ANALYSIS ===');
  lines.push('');

  for (const pattern of opPatterns) {
    const opEntries = entries.filter((e) => e.event.startsWith(pattern.prefix));
    if (opEntries.length === 0) continue;

    lines.push(`${pattern.name.toUpperCase()} OPERATIONS (${opEntries.length} events):`);
    lines.push('');

    // Group by sub-event (prepare, execute, etc.)
    const byPhase = new Map<string, { count: number; totalMs: number; entries: LogEntry[] }>();
    for (const e of opEntries) {
      const phase = e.event.replace(pattern.prefix, '');
      const params = e.params as Record<string, unknown> | undefined;
      const ms = (params?.ms as number) ?? 0;
      const existing = byPhase.get(phase) ?? { count: 0, totalMs: 0, entries: [] };
      existing.count++;
      existing.totalMs += ms;
      existing.entries.push(e);
      byPhase.set(phase, existing);
    }

    for (const [phase, stats] of [...byPhase.entries()].sort(
      (a, b) => b[1].totalMs - a[1].totalMs
    )) {
      const avg = stats.count > 0 ? stats.totalMs / stats.count : 0;
      const msStr =
        stats.totalMs > 0 ? ` (${stats.totalMs.toFixed(1)}ms total, ${avg.toFixed(1)}ms avg)` : '';
      lines.push(`  ${phase.padEnd(25)} ${String(stats.count).padStart(3)}x${msStr}`);
    }
    lines.push('');
  }

  // Show wallet-level operations (wallet.send, wallet.receive, etc. from cashu-ts __CASHU_PERF)
  const walletOps = entries.filter((e) => {
    return (
      e.event.startsWith('wallet.action.') ||
      e.event.startsWith('payment.step.') ||
      e.event.startsWith('payment.processing')
    );
  });
  if (walletOps.length > 0) {
    lines.push('WALLET ACTIONS:');
    lines.push('');
    const { page, footer } = paginate(walletOps, opts);
    let prevT: number | null = null;
    for (const e of page) {
      const t = e._t ?? 0;
      const delta = prevT !== null ? t - prevT : 0;
      prevT = t;
      const params = e.params as Record<string, unknown> | undefined;
      const paramsStr = params
        ? Object.entries(params)
            .filter(([k]) => k !== '_t' && k !== '_dedup')
            .map(([k, v]) => `${k}=${v}`)
            .join(' ')
        : '';
      lines.push(
        `${formatDelta(delta)} ${levelIcon(e.level)} ${e.event.padEnd(35).slice(0, 35)} ${paramsStr}`
      );
    }
    lines.push(footer);
  }

  return lines.join('\n');
}

// ─── Mode: perf ─────────────────────────────────────────────────────────────

function modePerf(entries: LogEntry[], _opts: Options): string {
  // Aggregate all entries with _perf: true or ms field
  const perfEntries = entries.filter((e) => {
    const params = e.params as Record<string, unknown> | undefined;
    return (params?._perf === true || params?.ms !== undefined) && typeof params?.ms === 'number';
  });

  if (perfEntries.length === 0)
    return 'No performance-tagged events found. Ensure patches are applied and operations have been performed.';

  const lines: string[] = [];
  lines.push('=== PERFORMANCE SUMMARY ===');
  lines.push('');

  // Aggregate by event name
  const byEvent = new Map<
    string,
    { count: number; totalMs: number; minMs: number; maxMs: number; samples: number[] }
  >();
  for (const e of perfEntries) {
    const ms = (e.params as Record<string, unknown>).ms as number;
    const existing = byEvent.get(e.event) ?? {
      count: 0,
      totalMs: 0,
      minMs: Infinity,
      maxMs: 0,
      samples: [],
    };
    existing.count++;
    existing.totalMs += ms;
    existing.minMs = Math.min(existing.minMs, ms);
    existing.maxMs = Math.max(existing.maxMs, ms);
    existing.samples.push(ms);
    byEvent.set(e.event, existing);
  }

  // Sort by total time (biggest bottlenecks first)
  const sorted = [...byEvent.entries()].sort((a, b) => b[1].totalMs - a[1].totalMs);

  lines.push('BOTTLENECK RANKING (by total time):');
  lines.push('');
  lines.push(
    '  Event                                  Count   Total ms   Avg ms   Min ms   Max ms   P95 ms'
  );
  lines.push('  ' + '-'.repeat(100));

  for (const [event, stats] of sorted) {
    const avg = stats.totalMs / stats.count;
    const sorted95 = [...stats.samples].sort((a, b) => a - b);
    const p95 = sorted95[Math.floor(sorted95.length * 0.95)] ?? stats.maxMs;
    lines.push(
      `  ${event.padEnd(40).slice(0, 40)} ${String(stats.count).padStart(5)}   ${stats.totalMs.toFixed(1).padStart(8)}   ${avg.toFixed(1).padStart(6)}   ${stats.minMs.toFixed(1).padStart(6)}   ${stats.maxMs.toFixed(1).padStart(6)}   ${p95.toFixed(1).padStart(6)}`
    );
  }
  lines.push('');

  // Show entries with ms > 500 (slow operations)
  const slowOps = perfEntries.filter(
    (e) => ((e.params as Record<string, unknown>).ms as number) > 500
  );
  if (slowOps.length > 0) {
    lines.push(`SLOW OPERATIONS (>500ms): ${slowOps.length}`);
    lines.push('');
    for (const e of slowOps
      .sort((a, b) => ((b.params as any).ms as number) - ((a.params as any).ms as number))
      .slice(0, 20)) {
      const params = e.params as Record<string, unknown>;
      const ms = params.ms as number;
      const extra = Object.entries(params)
        .filter(([k]) => !['ms', '_perf', '_t', '_dedup'].includes(k))
        .map(([k, v]) => `${k}=${typeof v === 'string' ? v.slice(0, 30) : v}`)
        .join(' ');
      lines.push(`  ${ms.toFixed(1).padStart(8)}ms  ${e.event.padEnd(35).slice(0, 35)} ${extra}`);
    }
    lines.push('');
  }

  // Network vs compute breakdown
  const withNetwork = perfEntries.filter(
    (e) => (e.params as Record<string, unknown>).networkMs !== undefined
  );
  if (withNetwork.length > 0) {
    lines.push('NETWORK vs COMPUTE BREAKDOWN:');
    lines.push('');
    let totalCompute = 0;
    let totalNetwork = 0;
    for (const e of withNetwork) {
      const params = e.params as Record<string, unknown>;
      const total = params.ms as number;
      const network = params.networkMs as number;
      totalNetwork += network;
      totalCompute += total - network;
    }
    const pctNetwork = ((totalNetwork / (totalNetwork + totalCompute)) * 100).toFixed(1);
    lines.push(`  Total compute: ${totalCompute.toFixed(1)}ms`);
    lines.push(`  Total network: ${totalNetwork.toFixed(1)}ms (${pctNetwork}%)`);
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Mode: budget ───────────────────────────────────────────────────────────
// Meta-analysis: shows token cost of each mode to help pick the right one.

function modeBudget(entries: LogEntry[], opts: Options): string {
  const lines: string[] = [];

  // Run each mode and measure token cost
  const modes: Array<{ name: string; fn: (e: LogEntry[], o: Options) => string }> = [
    { name: 'stats', fn: modeStats },
    { name: 'timeline', fn: modeTimeline },
    { name: 'errors', fn: modeErrors },
    { name: 'slow', fn: modeSlow },
    { name: 'renders', fn: modeRenders },
    { name: 'screens', fn: modeScreens },
    { name: 'startup', fn: modeStartup },
    { name: 'coco', fn: modeCoco },
    { name: 'network', fn: modeNetwork },
    { name: 'feed', fn: modeFeed },
    { name: 'full (json)', fn: (e, o) => modeFull(e, { ...o, format: 'json' }) },
    { name: 'full (md)', fn: (e, o) => modeFull(e, { ...o, format: 'md' }) },
    { name: 'full (yaml)', fn: (e, o) => modeFull(e, { ...o, format: 'yaml' }) },
  ];

  lines.push('TOKEN BUDGET ANALYSIS:');
  lines.push(`  Total entries: ${entries.length}`);
  lines.push('');

  lines.push('MODE TOKEN COSTS (approximate):');
  lines.push('');

  const results: Array<{ name: string; tokens: number }> = [];
  for (const mode of modes) {
    try {
      const output = mode.fn(entries, opts);
      const tokens = estimateTokens(output);
      results.push({ name: mode.name, tokens });
    } catch {
      results.push({ name: mode.name, tokens: -1 });
    }
  }

  results.sort((a, b) => a.tokens - b.tokens);

  for (const r of results) {
    if (r.tokens < 0) {
      lines.push(`  ${r.name.padEnd(18)} ERROR`);
      continue;
    }
    const bar = '█'.repeat(
      Math.max(1, Math.round((r.tokens / Math.max(...results.map((x) => x.tokens))) * 40))
    );
    lines.push(`  ${r.name.padEnd(18)} ${String(r.tokens).padStart(8)} tokens  ${bar}`);
  }
  lines.push('');

  // Context window fit analysis
  const windows = [
    { name: 'Claude Haiku (200K)', tokens: 200000, reserve: 0.25 },
    { name: 'Claude Sonnet (200K)', tokens: 200000, reserve: 0.25 },
    { name: 'GPT-4o (128K)', tokens: 128000, reserve: 0.25 },
    { name: 'Small prompt (8K)', tokens: 8000, reserve: 0.15 },
  ];

  lines.push('FITS IN CONTEXT WINDOW:');
  for (const w of windows) {
    const budget = Math.floor(w.tokens * (1 - w.reserve));
    const fits = results.filter((r) => r.tokens > 0 && r.tokens <= budget).map((r) => r.name);
    lines.push(`  ${w.name}: ${fits.join(', ') || 'none'}`);
  }
  lines.push('');

  // Top token consumers in raw data
  let srcTokens = 0;
  let ctxTokens = 0;
  let tsTokens = 0;
  for (const e of entries) {
    if (e.src) srcTokens += estimateTokens(JSON.stringify(e.src));
    if (e.ctx) ctxTokens += estimateTokens(JSON.stringify(e.ctx));
    if (e.ts) tsTokens += estimateTokens(JSON.stringify(e.ts));
  }

  lines.push('TOP TOKEN CONSUMERS IN RAW JSON:');
  const consumers = [
    { field: 'src (source location)', tokens: srcTokens },
    { field: 'ctx (context)', tokens: ctxTokens },
    { field: 'ts (ISO timestamp)', tokens: tsTokens },
  ].sort((a, b) => b.tokens - a.tokens);
  for (const c of consumers) {
    lines.push(`  ${c.field}: ~${c.tokens} tokens`);
  }
  lines.push('');
  lines.push('TIP: Use "full --format md" for ~40% fewer tokens than JSON.');
  lines.push('     Use dumpForLLM({ format: "md" }) in the app for the same savings.');

  return lines.join('\n');
}

// ─── Token estimation ───────────────────────────────────────────────────────
// Rough heuristic: ~4 characters per token for English/technical text.
// Avoids requiring tiktoken as a dependency.

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function applyTokenBudget(output: string, budget: number): string {
  const tokens = estimateTokens(output);
  if (tokens <= budget) return output;

  const lines = output.split('\n');
  let truncated = '';
  let currentTokens = 0;
  const targetTokens = Math.floor(budget * 0.95); // 5% headroom

  for (const line of lines) {
    const lineTokens = estimateTokens(line + '\n');
    if (currentTokens + lineTokens > targetTokens) {
      truncated += `\n[TRUNCATED: ~${tokens} tokens exceeds ${budget} budget — showing ~${currentTokens} tokens]`;
      break;
    }
    truncated += line + '\n';
    currentTokens += lineTokens;
  }

  return truncated;
}

async function modePhoneTest(args: string[]): Promise<string> {
  // ── Discovery / list ──
  if (args.length === 0 || args[0] === '--list' || args[0] === 'list') {
    const result = discoverTests();
    return formatTestList(result);
  }

  // ── Help ──
  if (args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    return phoneTestHelp();
  }

  // ── Parse-only debug (no device required) ──
  if (args[0] === 'parse') {
    const file = args[1];
    if (!file) throw new Error('Usage: phone test parse <file>');
    const path = nodePath.resolve(process.cwd(), file);
    const source = fs.readFileSync(path, 'utf-8');
    const suite = parseSuite(source, path);
    const out: string[] = [
      `${nodePath.relative(process.cwd(), path)}`,
      `  defines:  ${suite.defines.size}`,
      `  tests:    ${suite.tests.length}`,
      ...suite.tests.map((t) => `    - "${t.name}" (${t.body.length} steps)`),
      `  matrices: ${suite.matrices.length}`,
    ];
    for (const m of suite.matrices) {
      const cells = m.stages.reduce(
        (n, stage) => n * (stage.variantKind === 'bundleOf' ? 1 : stage.variants.length),
        1
      );
      out.push(
        `    - "${m.title}" (${m.mode}, ${m.stages.length} stage${m.stages.length === 1 ? '' : 's'}, ~${cells} cell${cells === 1 ? '' : 's'})`
      );
      for (const stage of m.stages) {
        out.push(
          `        · stage ${stage.name} (${stage.variantKind}): ${stage.variants.length} variant${stage.variants.length === 1 ? '' : 's'}`
        );
      }
    }
    return out.join('\n');
  }

  // UI mode selection. Default to the rich TTY reporter when stdout
  // is an interactive terminal and the user didn't explicitly opt out
  // with `--no-ui`. CI / piped output falls back to the flat streaming
  // log which is the only thing that works without cursor control.
  const disableUi = args.includes('--no-ui') || process.env.LOG_DOCTOR_FLAT === '1';
  const useTtyReporter = !disableUi && isInteractiveTty();
  // Pass our local `setRecoveryLogSink` through so the reporter can
  // plug its own `commit()` into the recovery log path without having
  // to import from log-doctor (which would create a circular module
  // dependency — log-doctor already imports createTtyReporter). The
  // reporter's `finish()` unregisters the sink by calling us with
  // `null`, restoring the default stderr fallback for any late calls.
  const reporter: TtyReporter | null = useTtyReporter
    ? createTtyReporter({ setRecoveryLogSink })
    : null;

  // Streaming log sink used when the rich UI is disabled. Each log
  // line fires through this as the executor emits it, so long
  // operations (wallet send, wait for, swap retries) show up live
  // instead of appearing only when the whole test finishes. Returning
  // '' from the handler prevents the outer `console.log(output)` in
  // main() from re-printing the buffered transcript.
  const streamLog = reporter
    ? reporter.onLog // tees into the sidecar log, doesn't touch stdout
    : (line: string): void => {
        // eslint-disable-next-line no-console
        console.log(line);
      };

  // Structured event sink — wired only when the reporter is active.
  // Executor emits events alongside log strings so both can coexist
  // without double-printing.
  const streamEvent: ((event: RunnerEvent) => void) | undefined = reporter
    ? reporter.onEvent
    : undefined;

  // ── Run all ──
  if (args[0] === 'all') {
    const result = discoverTests();
    if (result.tests.size === 0 && result.matrices.size === 0) {
      return '(no tests to run — create one in tests/*.sov)';
    }
    await ensureWDAReady();
    const totalUnits =
      result.tests.size +
      Array.from(result.matrices.values()).reduce(
        (n, m) =>
          n +
          m.matrix.stages.reduce(
            (k, stage) => k * (stage.variantKind === 'bundleOf' ? 1 : stage.variants.length),
            1
          ),
        0
      );
    streamEvent?.({
      type: 'run.begin',
      t: Date.now(),
      kind: 'all',
      title: 'all tests',
      totalUnits,
    });
    let pass = 0;
    let fail = 0;
    // Run plain tests first, then matrices. Matrices tend to be much
    // longer so surfacing their failures at the bottom makes the
    // terminal scrollback easier to read.
    for (const [name, found] of result.tests) {
      const execOpts: Parameters<typeof executeTest>[1] = {
        testName: name,
        suite: found.suite,
        globalDefines: result.globalDefines,
        onLog: streamLog,
      };
      if (streamEvent) execOpts.onEvent = streamEvent;
      const exec = await executeTest(found.test, execOpts);
      if (exec.ok) {
        pass++;
        try {
          writeVerifiedComment(found.file, found.test, { label: await detectDeviceLabel() });
        } catch {
          /* best effort — verification metadata write is non-fatal */
        }
      } else {
        fail++;
      }
      streamLog('');
    }
    for (const [, foundMatrix] of result.matrices) {
      const matrixOpts: Parameters<typeof executeMatrix>[1] = {
        suite: foundMatrix.suite,
        globalDefines: result.globalDefines,
        onLog: streamLog,
      };
      if (streamEvent) matrixOpts.onEvent = streamEvent;
      const matrixResult = await executeMatrix(foundMatrix.matrix, matrixOpts);
      if (matrixResult.ok) pass++;
      else fail++;
      try {
        writeMatrixResultTable(foundMatrix.file, foundMatrix.matrix, matrixResult, {
          label: await detectDeviceLabel(),
        });
      } catch {
        /* best effort */
      }
      streamLog('');
    }
    streamLog(`──── summary: ${pass} passed, ${fail} failed ────`);
    streamEvent?.({
      type: 'run.end',
      t: Date.now(),
      ok: fail === 0,
      passed: pass,
      failed: fail,
    });
    reporter?.finish();
    return '';
  }

  // ── Run single ──
  const name = args[0];
  if (!name) throw new Error('Usage: phone test <name>');
  const result = discoverTests();
  const found = findTest(result, name);
  if (found) {
    await ensureWDAReady();
    streamEvent?.({
      type: 'run.begin',
      t: Date.now(),
      kind: 'test',
      title: found.test.name,
      totalUnits: 1,
    });
    const execOpts: Parameters<typeof executeTest>[1] = {
      testName: name,
      suite: found.suite,
      globalDefines: result.globalDefines,
      onLog: streamLog,
    };
    if (streamEvent) execOpts.onEvent = streamEvent;
    const exec = await executeTest(found.test, execOpts);
    if (exec.ok) {
      try {
        writeVerifiedComment(found.file, found.test, { label: await detectDeviceLabel() });
      } catch {
        /* best effort */
      }
    }
    streamEvent?.({
      type: 'run.end',
      t: Date.now(),
      ok: exec.ok,
      passed: exec.ok ? 1 : 0,
      failed: exec.ok ? 0 : 1,
    });
    reporter?.finish();
    return '';
  }

  // Fall back to matrix lookup — matrices share the display-name
  // namespace with tests, and the discovery collision logic guarantees
  // a given key resolves to exactly one runnable.
  const foundMatrix = findMatrix(result, name);
  if (!foundMatrix) {
    throw new Error(`no test or matrix named '${name}'.\n\nAvailable:\n${formatTestList(result)}`);
  }
  await ensureWDAReady();
  const cellCount = foundMatrix.matrix.stages.reduce(
    (k, stage) => k * (stage.variantKind === 'bundleOf' ? 1 : stage.variants.length),
    1
  );
  streamEvent?.({
    type: 'run.begin',
    t: Date.now(),
    kind: 'matrix',
    title: foundMatrix.matrix.title,
    totalUnits: cellCount,
  });
  const matrixOpts: Parameters<typeof executeMatrix>[1] = {
    suite: foundMatrix.suite,
    globalDefines: result.globalDefines,
    onLog: streamLog,
  };
  if (streamEvent) matrixOpts.onEvent = streamEvent;
  const matrixResult = await executeMatrix(foundMatrix.matrix, matrixOpts);
  try {
    writeMatrixResultTable(foundMatrix.file, foundMatrix.matrix, matrixResult, {
      label: await detectDeviceLabel(),
    });
  } catch {
    /* best effort */
  }
  streamEvent?.({
    type: 'run.end',
    t: Date.now(),
    ok: matrixResult.ok,
    passed: matrixResult.cells.filter((c) => c.ok).length,
    failed: matrixResult.cells.filter((c) => !c.ok).length,
  });
  reporter?.finish();
  return '';
}

function phoneTestHelp(): string {
  return [
    'phone test — run verified end-to-end flows from tests/*.sov',
    '',
    'Usage:',
    '  phone test                  # list discovered tests',
    '  phone test <name>           # run a single test (kebab-case of test name)',
    '  phone test all              # run every test',
    '  phone test parse <file>     # parse-only debug — prints AST summary',
    '',
    'Flags:',
    '  --no-ui                     # disable the rich terminal reporter',
    '                                (also: set LOG_DOCTOR_FLAT=1 in the env)',
    '                                falls back to flat streaming log',
    '',
    'Test files live in <repo>/tests/*.sov and use the line-oriented Sovran',
    'Test DSL. See tests/README.md for the language reference. Quick examples:',
    '',
    '  test "Example"',
    '    launch com.sovranbitcoin.dev',
    '    tap #wallet-receive when visible',
    '    keypad 1',
    '    tap #amount-next',
    '    wait for screen #screen-mint-quote',
    '    capture #payment-info-token-data as $token',
    '    assert $token starts-with "cashuB"',
    '    dismiss',
    '    wait for screen #screen-wallet',
    '  end',
    '',
    'Selectors:',
    '  #testID         exact match (PREFERRED)',
    '  "visible text"  fallback by label',
    '  #prefix*        wildcard match (for dynamic IDs like transaction-mint-*)',
    '',
    'On a passing run, the # verified: line inside the test block is updated',
    'in place with the current date and device label.',
  ].join('\n');
}

async function modePhone(args: string[]): Promise<string> {
  const [sub, ...rest] = args;
  if (!sub || sub === 'help' || sub === '-h' || sub === '--help') {
    return [
      'phone — drive a physical iPhone via WebDriverAgent (localhost:8100)',
      '',
      'Reads via sessionless WDA endpoints, taps via short-lived sessions —',
      'safe to run alongside mobile-mcp (Claude Code MCP server).',
      '',
      'Subcommands:',
      '  status              Probe WDA health',
      '  tree [--all]        Print accessibility tree (testID-targetable first,',
      '                      then text-only fallbacks; --all also shows unlabeled',
      '                      containers)',
      '  tap-id <testID>     Tap by accessibility identifier (PREFERRED)',
      '  tap "<text>"        Tap by visible label (FALLBACK — emits a nudge to',
      '                      add a testID if matched element has none)',
      '  tap-xy <x> <y>      Tap at screen coordinate (LAST RESORT — always nudges)',
      '  text "<input>"      Type into the focused field',
      '  shot [path]         Save a PNG screenshot (default: ./wda-<ts>.png)',
      '  home                Press the home button',
      '  dismiss-modal       Swipe down to dismiss the topmost iOS modal sheet',
      '                      (use this instead of `relaunch-app` to return to root)',
      '  swipe <direction>   Swipe up|down|left|right across the screen',
      '  test [...]          Run verified end-to-end tests from tests/*.sov',
      '                      (`phone test help` for the test sub-DSL)',
      '',
      'Env:',
      '  WDA_BASE_URL        WDA base URL (default: http://localhost:8100)',
      '',
      'Setup: see docs/device-automation.md.',
      'Daily bring-up: `npm run dev` (starts Metro + WDA together).',
    ].join('\n');
  }

  if (sub === 'status') {
    const status = await wdaRequest('GET', '/status');
    const ready = status.value?.ready;
    return `WDA at ${WDA_BASE}: ${ready ? 'READY ✓' : 'NOT READY'}\n${JSON.stringify(status, null, 2)}`;
  }

  if (sub === 'tree') {
    const showAll = rest.includes('--all');
    const tree = await getCurrentTree();
    const flat = flattenAll(tree);
    return formatTreeOutput(flat, showAll);
  }

  if (sub === 'tap-id') {
    const id = rest[0];
    if (!id) throw new Error('Usage: phone tap-id <testID>');
    const tree = await getCurrentTree();
    const flat = flattenAll(tree);
    const node = findByTestID(flat, id);
    if (!node) {
      const available = flat
        .filter((n) => n.hasIdent)
        .map((n) => `  ${n.identifier}`)
        .slice(0, 30)
        .join('\n');
      throw new Error(
        `No element with testID="${id}" on the current screen.\n` +
          (available
            ? `Available testIDs on this screen:\n${available}`
            : '(no elements with testIDs are present — add some, then try again)')
      );
    }
    if (!node.rect) throw new Error(`Element [${id}] has no rect — cannot tap.`);
    await tapXY(node.centerX, node.centerY);
    return `Tapped [${id}] at (${node.centerX},${node.centerY})`;
  }

  if (sub === 'tap') {
    const text = rest.join(' ');
    if (!text) throw new Error('Usage: phone tap "<text>"');
    const tree = await getCurrentTree();
    const flat = flattenAll(tree);
    const match = findByText(flat, text);
    if (!match) {
      throw new Error(
        `No element matches "${text}" on the current screen.\n` +
          'Try `phone tree` to see what is targetable, or use `phone tap-xy` as a last resort.'
      );
    }
    const { node, matchKind } = match;
    await tapXY(node.centerX, node.centerY);
    const summary =
      `Tapped "${text}"${matchKind === 'substring' ? ' (substring match)' : ''}` +
      ` at (${node.centerX},${node.centerY})`;
    if (node.hasIdent) {
      // Element does have a testID — gently steer toward using it.
      return (
        `${summary}\n\n` +
        `✓  This element has a testID. For stability, prefer:\n` +
        `     npm run log-doctor -- phone tap-id ${node.identifier}`
      );
    }
    // Fallback path — emit the loud nudge.
    return summary + '\n' + buildAddTestIDNudge(node, `phone tap "${text}"`);
  }

  if (sub === 'tap-xy') {
    const x = Number(rest[0]);
    const y = Number(rest[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error('Usage: phone tap-xy <x> <y>');
    }
    await tapXY(x, y);
    return `Tapped (${x},${y})` + '\n' + buildCoordTapNudge(x, y);
  }

  if (sub === 'text') {
    const text = rest.join(' ');
    if (!text) throw new Error('Usage: phone text "<input>"');
    await typeKeys(text);
    return `Typed: ${text}`;
  }

  if (sub === 'shot') {
    const out = rest[0];
    const saved = await takeScreenshot(out);
    return `Screenshot saved: ${saved}`;
  }

  if (sub === 'home') {
    await pressHome();
    return 'Pressed home';
  }

  if (sub === 'dismiss-modal') {
    await dismissModal();
    return 'Swiped down to dismiss topmost modal';
  }

  if (sub === 'swipe') {
    const dir = (rest[0] || '').toLowerCase();
    if (dir !== 'up' && dir !== 'down' && dir !== 'left' && dir !== 'right') {
      throw new Error('Usage: phone swipe <up|down|left|right>');
    }
    await swipe(dir);
    return `Swiped ${dir}`;
  }

  if (sub === 'test') {
    return await modePhoneTest(rest);
  }

  if (sub === 'reset-session') {
    // Kept for backward-compat — phone mode no longer caches sessions.
    return '(reset-session is a no-op now — phone mode uses ephemeral sessions)';
  }

  throw new Error(`Unknown phone subcommand: ${sub}\nRun \`log-doctor phone help\` for usage.`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv);

  // `phone` mode talks to the device, not to log files — short-circuit before
  // we try to read log.txt or stdin.
  if (opts.mode === 'phone') {
    try {
      const output = await modePhone(opts.restArgs);
      // Some sub-modes (notably `phone test`) stream output live via a
      // logger callback and return '' to avoid double-printing. Only
      // echo the buffered return value when it's non-empty.
      if (output.length > 0) console.log(output);
      return;
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  }

  // Read from log.txt (default) or stdin if piped
  let raw: string;
  const logPath = nodePath.resolve(process.cwd(), 'log.txt');

  if (process.stdin.isTTY !== undefined && !process.stdin.isTTY) {
    // Data is being piped in
    raw = fs.readFileSync(0, 'utf-8');
  } else if (fs.existsSync(logPath)) {
    const stat = fs.statSync(logPath);
    const MB = stat.size / (1024 * 1024);
    if (MB > 50) {
      console.error(`log.txt is ${MB.toFixed(1)}MB — too large. Pipe a subset instead:`);
      console.error(`  head -1000 log.txt | npm run log-doctor -- ${opts.mode}`);
      process.exit(1);
    }
    raw = fs.readFileSync(logPath, 'utf-8');
  } else {
    console.error('No log.txt found in sovran-app/. Either:');
    console.error('  1. Paste dumpForLLM() output into sovran-app/log.txt');
    console.error('  2. Pipe logs: cat logs.jsonl | npm run log-doctor -- stats');
    console.error('');
    console.error(
      'Modes: stats, timeline, errors, slow, renders, screens, startup, coco, network, feed, full, diff, flows, ws, gc, budget, phone'
    );
    process.exit(1);
  }

  let allEntries = parseLogInput(raw);

  if (allEntries.length === 0) {
    console.error('No valid log entries found in input.');
    process.exit(1);
  }

  // diff mode needs all sessions before --latest filtering
  if (opts.mode === 'diff') {
    let output = modeDiff(allEntries, opts);
    if (opts.tokenBudget !== null) output = applyTokenBudget(output, opts.tokenBudget);
    console.log(output);
    return;
  }

  if (opts.latest) {
    allEntries = extractLatestSession(allEntries);
  }

  const entries = filterEntries(allEntries, opts);

  let output: string;

  switch (opts.mode) {
    case 'stats':
      output = modeStats(entries, opts);
      break;
    case 'timeline':
      output = modeTimeline(entries, opts);
      break;
    case 'errors':
      output = modeErrors(entries, opts);
      break;
    case 'slow':
      output = modeSlow(entries, opts);
      break;
    case 'renders':
      output = modeRenders(entries, opts);
      break;
    case 'screens':
      output = modeScreens(entries, opts);
      break;
    case 'startup':
      output = modeStartup(entries, opts);
      break;
    case 'coco':
      output = modeCoco(entries, opts);
      break;
    case 'network':
      output = modeNetwork(entries, opts);
      break;
    case 'feed':
      output = modeFeed(entries, opts);
      break;
    case 'full':
      output = modeFull(entries, opts);
      break;
    case 'flows':
      output = modeFlows(entries, opts);
      break;
    case 'ws':
      output = modeWS(entries, opts);
      break;
    case 'gc':
      output = modeGC(entries, opts);
      break;
    case 'budget':
      output = modeBudget(entries, opts);
      break;
    case 'crypto':
      output = modeCrypto(entries, opts);
      break;
    case 'ops':
      output = modeOps(entries, opts);
      break;
    case 'perf':
      output = modePerf(entries, opts);
      break;
    default:
      console.error(`Unknown mode: ${opts.mode}`);
      console.error(
        'Valid modes: stats, timeline, errors, slow, renders, screens, startup, coco, network, feed, full, diff, flows, ws, gc, budget, crypto, ops, perf, phone'
      );
      process.exit(1);
  }

  // Apply token budget if specified
  if (opts.tokenBudget !== null) {
    output = applyTokenBudget(output, opts.tokenBudget);
  }

  console.log(output);
}

// Only run main() when invoked directly as a CLI — not when imported as a
// module by the test-dsl executor (or any other consumer). The entry can
// be the real index, or the back-compat shim at scripts/log-doctor.ts that
// just imports this file.
const __thisFile = url.fileURLToPath(import.meta.url);
const __entryFile = process.argv[1] ? nodePath.resolve(process.argv[1]) : '';
const __isShimEntry = __entryFile.endsWith(`${nodePath.sep}scripts${nodePath.sep}log-doctor.ts`);
if (__entryFile === __thisFile || __isShimEntry) {
  // Best-effort cleanup of the cached WDA session on exit.
  process.on('exit', () => {
    invalidateCachedSession();
  });
  main().catch((err) => {
    console.error(err instanceof Error ? err.stack || err.message : String(err));
    process.exit(1);
  });
}
