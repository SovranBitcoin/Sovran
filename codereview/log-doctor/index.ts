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
 *   coco         Coco wallet module breakdown, issues, mint requests
 *   network      Network request/response pairs with latency
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
import { spawn, spawnSync } from 'child_process';

// Test DSL — parser, executor, discovery, verification metadata writer.
// These power the `phone test ...` subcommand.
import {
  discoverTests,
  findMatrix,
  findTest,
  formatTestList,
} from './test-dsl/discovery';
import type { RunnerEvent } from './test-dsl/events';
import { executeMatrix, executeTest } from './test-dsl/executor';
import { parseSuite } from './test-dsl/parser';
import {
  createTtyReporter,
  isInteractiveTty,
  type TtyReporter,
} from './test-dsl/tty-reporter';
import { writeMatrixResultTable, writeVerifiedComment } from './test-dsl/verification';

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

function modeCoco(entries: LogEntry[], opts: Options): string {
  // Coco events come from CocoLogger: event starts with "coco."
  const cocoEntries = entries.filter((e) => e.event.startsWith('coco.'));

  if (cocoEntries.length === 0)
    return 'No coco events found. Ensure CocoLogger is wired into Manager (replaces ConsoleLogger).';

  const lines: string[] = [];

  // ── Section 1: Module breakdown ──
  const moduleCounts = new Map<
    string,
    { debug: number; info: number; warn: number; error: number }
  >();
  for (const e of cocoEntries) {
    // event format: coco.<module>.<event_key>
    const parts = e.event.split('.');
    const module = parts[1] ?? 'unknown';
    const counts = moduleCounts.get(module) ?? { debug: 0, info: 0, warn: 0, error: 0 };
    const level = e.level as keyof typeof counts;
    if (level in counts) counts[level]++;
    moduleCounts.set(module, counts);
  }

  lines.push('COCO MODULE BREAKDOWN:');
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
    lines.push(`COCO ISSUES (${issues.length} warnings/errors):`);
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

  // ── Section 3: Mint request summary ──
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

  // ── Section 4: Timeline of key coco events (non-debug) ──
  const keyEvents = cocoEntries.filter((e) => e.level !== 'debug');
  if (keyEvents.length > 0) {
    lines.push('COCO KEY EVENTS (info/warn/error):');
    lines.push('');
    const { page, footer } = paginate(keyEvents, opts);
    let prevT: number | null = null;
    for (const e of page) {
      const t = e._t ?? 0;
      const delta = prevT !== null ? t - prevT : 0;
      prevT = t;
      const msg = (e.params?.msg as string) ?? '';
      const shortMsg = msg.length > 60 ? msg.slice(0, 57) + '...' : msg;
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
    'hashToCurve', 'hash_e', 'blindMessage', 'unblind', 'constructProof',
    'schnorr.sign', 'schnorr.verify', 'dleq.verify', 'dleq.verifyReblind',
    'derive_deprecated', 'deriveBoth', 'createDeterministicData_batch',
    'createRandomData', 'createSingleRandomData', 'outputData.toProof',
    'encodeToken', 'decodeToken', 'wallet.checkProofsStates',
  ];

  // Find cashu.native_crypto events
  const nativeCryptoEntries = entries.filter(
    (e) => e.event === 'cashu.native_crypto.enabled'
  );

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
  const byOp = new Map<string, { count: number; totalMs: number; minMs: number; maxMs: number; native: number; jsCount: number }>();
  for (const e of perfEntries) {
    const params = e.params as Record<string, unknown>;
    // Try to extract op from event name
    let op = e.event;
    if (op.startsWith('coco.')) op = op.replace('coco.', '');

    const ms = params.ms as number;
    const isNative = params.native === true;
    const existing = byOp.get(op) ?? { count: 0, totalMs: 0, minMs: Infinity, maxMs: 0, native: 0, jsCount: 0 };
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

    for (const [phase, stats] of [...byPhase.entries()].sort((a, b) => b[1].totalMs - a[1].totalMs)) {
      const avg = stats.count > 0 ? stats.totalMs / stats.count : 0;
      const msStr = stats.totalMs > 0 ? ` (${stats.totalMs.toFixed(1)}ms total, ${avg.toFixed(1)}ms avg)` : '';
      lines.push(`  ${phase.padEnd(25)} ${String(stats.count).padStart(3)}x${msStr}`);
    }
    lines.push('');
  }

  // Show wallet-level operations (wallet.send, wallet.receive, etc. from cashu-ts __CASHU_PERF)
  const walletOps = entries.filter((e) => {
    return e.event.startsWith('wallet.action.') || e.event.startsWith('payment.step.') || e.event.startsWith('payment.processing');
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
      const paramsStr = params ? Object.entries(params).filter(([k]) => k !== '_t' && k !== '_dedup').map(([k, v]) => `${k}=${v}`).join(' ') : '';
      lines.push(`${formatDelta(delta)} ${levelIcon(e.level)} ${e.event.padEnd(35).slice(0, 35)} ${paramsStr}`);
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
    const existing = byEvent.get(e.event) ?? { count: 0, totalMs: 0, minMs: Infinity, maxMs: 0, samples: [] };
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
  lines.push('  Event                                  Count   Total ms   Avg ms   Min ms   Max ms   P95 ms');
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
  const slowOps = perfEntries.filter((e) => ((e.params as Record<string, unknown>).ms as number) > 500);
  if (slowOps.length > 0) {
    lines.push(`SLOW OPERATIONS (>500ms): ${slowOps.length}`);
    lines.push('');
    for (const e of slowOps.sort((a, b) => ((b.params as any).ms as number) - ((a.params as any).ms as number)).slice(0, 20)) {
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
  const withNetwork = perfEntries.filter((e) => (e.params as Record<string, unknown>).networkMs !== undefined);
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

// ─── Phone mode (drive a real iOS device via WebDriverAgent) ────────────────
//
// Talks to a WebDriverAgent REST server on localhost:8100 (forwarded by go-ios).
// Designed to coexist peacefully with mobile-mcp (https://github.com/mobile-next/
// mobile-mcp), which uses the same WDA. To avoid stealing each other's session,
// this CLI:
//
//   - Reads via the SESSIONLESS endpoints `/source` and `/screenshot` — no
//     session needed for tree dumps or screenshots.
//   - Walks the tree itself to locate elements by testID or visible text, then
//     creates a SHORT-LIVED session JUST for the tap and tears it down.
//
// Targeting priority is testID-first:
//
//   1. `phone tap-id <testID>`        (preferred — stable across copy/i18n)
//   2. `phone tap "<visible text>"`   (fallback — emits a nudge if matched
//                                       element has no testID, telling the
//                                       agent to add one)
//   3. `phone tap-xy <x> <y>`         (last resort — always emits a nudge)
//
// See `docs/device-automation.md` for the full one-time setup. `npm run dev`
// brings WDA up automatically alongside Metro.

const WDA_BASE = process.env.WDA_BASE_URL || 'http://localhost:8100';

export interface AXNode {
  type?: string;
  label?: string | null;
  name?: string | null;
  value?: string | null;
  rawIdentifier?: string | null;
  identifier?: string | null;
  rect?: { x: number; y: number; width: number; height: number };
  isVisible?: boolean | string;
  isEnabled?: boolean | string;
  children?: AXNode[];
}

export interface FlatNode {
  type: string;
  label: string;
  name: string;
  identifier: string;
  rect: { x: number; y: number; width: number; height: number } | null;
  centerX: number;
  centerY: number;
  hasIdent: boolean;
  hasText: boolean;
}

/**
 * Optional sink for WDA recovery / bring-up log lines. When the TTY
 * reporter is active, it registers a sink that commits each line into
 * scrollback via the reporter's `commit()` path. Without the sink,
 * every `▸ WDA ...` / `[wda] ...` line was written directly to
 * `process.stderr`, which collided with the reporter's live-area
 * cursor math and corrupted the progress footer with duplicated
 * headers and bleed-through text. Routing through a sink keeps the
 * reporter in charge of its own cursor state.
 *
 * Default is null → lines fall through to `process.stderr.write` so
 * non-reporter callers (plain piped output, CI) see the same output
 * they did before.
 */
let recoveryLogSink: ((line: string) => void) | null = null;
export function setRecoveryLogSink(sink: ((line: string) => void) | null): void {
  recoveryLogSink = sink;
}
/**
 * Emit a single line of recovery/bring-up progress. Lines land in the
 * reporter's scrollback when a sink is registered, and on stderr
 * otherwise. Multi-line input is split so each line is committed
 * atomically through the sink — the reporter assumes one line per
 * call, and a single sink invocation with embedded newlines would
 * break its paint math.
 */
function emitRecoveryLine(line: string): void {
  // Strip a single trailing newline so callers that follow the
  // `stream.write('foo\n')` convention and callers that don't both
  // produce the same result.
  const normalized = line.endsWith('\n') ? line.slice(0, -1) : line;
  if (normalized.length === 0) return;
  if (recoveryLogSink) {
    for (const sub of normalized.split('\n')) recoveryLogSink(sub);
  } else {
    process.stderr.write(normalized + '\n');
  }
}

/**
 * Shared recovery promise. When a wdaRequest hits a transport-level
 * failure (tunnel dropped, forwarder died, port unbound), it triggers
 * an `ensureWDAReady()` pass. If another request is already running
 * that pass, it joins the in-flight promise instead of kicking off a
 * second parallel bring-up — parallel bring-ups race the pkill
 * cleanup and stomp on each other's tunnels.
 *
 * Reset to null once the promise settles so the NEXT drop (hours
 * later in a long test run) can trigger a fresh bring-up.
 */
let wdaRecoveryPromise: Promise<void> | null = null;
async function recoverWDA(): Promise<void> {
  // Any cached session is stale after a WDA restart.
  invalidateCachedSession();
  if (wdaRecoveryPromise) return wdaRecoveryPromise;
  wdaRecoveryPromise = (async () => {
    try {
      await ensureWDAReady();
    } finally {
      wdaRecoveryPromise = null;
    }
  })();
  return wdaRecoveryPromise;
}

async function wdaRequest(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown
): Promise<any> {
  const url = `${WDA_BASE}${path}`;
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) init.body = JSON.stringify(body);

  // Transport-level retry with auto-recovery. WDA's userspace tunnel
  // and port forwarder are fragile on long runs — the forwarder can
  // die after minutes of traffic, leaving `localhost:8100` with
  // nothing listening. Every in-flight `wdaRequest` then fails with
  // `fetch failed`, the test runner tears down a cell, and all the
  // downstream cells also fail because nothing brought WDA back.
  //
  // Recovery strategy: on the first `fetch` throw, call `recoverWDA`
  // (which serialises through `ensureWDAReady` — the same bring-up
  // path the runner uses at startup) and retry the request once.
  // Only transport failures retry; HTTP-level errors (4xx/5xx from
  // a live WDA) surface immediately — they mean the request was
  // malformed or the target element is gone, not that the tunnel
  // died, and retrying would just mask the real cause.
  //
  // The retry is bounded at one attempt so a genuinely dead device
  // fails fast after ~180s (the ensureWDAReady budget) instead of
  // looping forever.
  let res: Response | null = null;
  let transportErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await fetch(url, init);
      break;
    } catch (err) {
      transportErr = err;
      if (attempt === 0) {
        emitRecoveryLine(
          `▸ WDA request failed (${(err as Error).message}) — attempting recovery…`
        );
        try {
          await recoverWDA();
          emitRecoveryLine(`▸ WDA recovered, retrying ${method} ${path}`);
        } catch (recoveryErr) {
          // Recovery itself failed — surface the original transport
          // error wrapped with the usual recovery hint, since that's
          // the most actionable message the user will see.
          throw new Error(
            `WDA unreachable at ${WDA_BASE} and recovery bring-up failed.\n` +
              `\n` +
              `Bring it up with:\n` +
              `  npm run dev          # Metro + WDA in one shot\n` +
              `  scripts/start-wda.sh # WDA only\n` +
              `\n` +
              `See docs/device-automation.md for the full setup.\n` +
              `Transport error: ${(err as Error).message}\n` +
              `Recovery error:  ${(recoveryErr as Error).message}`
          );
        }
        continue;
      }
      // Second attempt — give up with the original-looking message.
      throw new Error(
        `WDA unreachable at ${WDA_BASE}.\n` +
          `\n` +
          `Bring it up with:\n` +
          `  npm run dev          # Metro + WDA in one shot\n` +
          `  scripts/start-wda.sh # WDA only\n` +
          `\n` +
          `See docs/device-automation.md for the full setup.\n` +
          `Underlying error: ${(err as Error).message}`
      );
    }
  }
  if (!res) {
    // Unreachable because either `break` ran (res set) or the loop
    // threw — but TS needs a narrowing for the block below.
    throw new Error(
      `WDA unreachable at ${WDA_BASE}: ${transportErr instanceof Error ? transportErr.message : 'unknown'}`
    );
  }

  const text = await res.text();
  let parsed: any;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`WDA returned non-JSON ${res.status} for ${method} ${path}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    const value = (parsed as { value?: { message?: string } }).value;
    throw new Error(
      `WDA ${res.status} ${method} ${path}: ${value?.message || JSON.stringify(parsed).slice(0, 300)}`
    );
  }
  return parsed;
}

/** Get the current accessibility tree without creating a session. */
export async function getCurrentTree(): Promise<AXNode> {
  const res = await wdaRequest('GET', '/source?format=json');
  if (!res.value) throw new Error('WDA /source returned no value');
  return res.value as AXNode;
}

export function flattenAll(node: AXNode, out: FlatNode[] = []): FlatNode[] {
  const rect = node.rect ?? null;
  const label = node.label || '';
  const name = node.name || '';
  const ident = node.rawIdentifier || node.identifier || '';
  out.push({
    type: node.type || '',
    label,
    name,
    identifier: ident,
    rect,
    centerX: rect ? Math.round(rect.x + rect.width / 2) : 0,
    centerY: rect ? Math.round(rect.y + rect.height / 2) : 0,
    hasIdent: !!ident,
    hasText: !!(label || name),
  });
  if (node.children) for (const c of node.children) flattenAll(c, out);
  return out;
}

/**
 * Find the back button of the topmost (most recently rendered) navigation
 * bar. iOS Stack screens render their back button as the FIRST Button
 * descendant of an `XCUIElementTypeNavigationBar`. When multiple modals are
 * stacked (e.g. wallet home + a presented modal), both nav bars are in the
 * tree — we want the LAST one, which corresponds to the topmost modal.
 *
 * Returns null when there's no nav bar with a back button (e.g. on the
 * root screen with no presented modal).
 */
function findFirstButtonDescendant(node: AXNode): AXNode | null {
  if (node.type === 'XCUIElementTypeButton') return node;
  if (node.children) {
    for (const c of node.children) {
      const found = findFirstButtonDescendant(c);
      if (found) return found;
    }
  }
  return null;
}

function countDescendantButtons(node: AXNode): number {
  let n = node.type === 'XCUIElementTypeButton' ? 1 : 0;
  if (node.children) for (const c of node.children) n += countDescendantButtons(c);
  return n;
}

interface NavBackHit {
  button: AXNode;
  centerX: number;
  centerY: number;
}

export function findTopmostNavBackButton(tree: AXNode): NavBackHit | null {
  let last: NavBackHit | null = null;
  function walk(node: AXNode): void {
    if (node.type === 'XCUIElementTypeNavigationBar' && node.children) {
      const button = findFirstButtonDescendant(node);
      if (button && button.rect && button.rect.width > 0 && button.rect.height > 0) {
        last = {
          button,
          centerX: Math.round(button.rect.x + button.rect.width / 2),
          centerY: Math.round(button.rect.y + button.rect.height / 2),
        };
      }
    }
    if (node.children) for (const c of node.children) walk(c);
  }
  walk(tree);
  return last;
}

function ellipsis(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function formatNodeLine(n: FlatNode): string {
  const t = (n.type || '').replace('XCUIElementType', '').padEnd(12);
  const id = n.identifier ? `[${n.identifier}] ` : '';
  const labelOrName = n.label || n.name || '';
  const text = labelOrName ? `"${ellipsis(labelOrName, 60)}" ` : '';
  const at = n.rect
    ? `@${n.centerX},${n.centerY} ${n.rect.width}x${n.rect.height}`
    : '';
  return `${t} ${id}${text}${at}`.trimEnd();
}

function formatTreeOutput(nodes: FlatNode[], showAll: boolean): string {
  // testID-first sort: nodes with rawIdentifier come first, then text-only nodes,
  // then everything else (only when --all). Within each bucket, sort by visual
  // position (top-down, left-right).
  const withId = nodes.filter((n) => n.hasIdent);
  const withText = nodes.filter((n) => !n.hasIdent && n.hasText);
  const rest = nodes.filter((n) => !n.hasIdent && !n.hasText);
  const positionSort = (a: FlatNode, b: FlatNode) =>
    a.centerY - b.centerY || a.centerX - b.centerX;
  withId.sort(positionSort);
  withText.sort(positionSort);
  rest.sort(positionSort);

  const sections: string[] = [];
  if (withId.length > 0) {
    sections.push('# testID-targetable (preferred)');
    sections.push(...withId.map(formatNodeLine));
  } else {
    sections.push('# testID-targetable (preferred)');
    sections.push('  (none — none of the visible elements have a testID set)');
  }
  if (withText.length > 0) {
    sections.push('');
    sections.push('# text-only (fallback — fragile to copy/i18n)');
    sections.push(...withText.map(formatNodeLine));
  }
  if (showAll && rest.length > 0) {
    sections.push('');
    sections.push(`# unlabeled containers (--all, ${rest.length} nodes)`);
    sections.push(...rest.slice(0, 200).map(formatNodeLine));
    if (rest.length > 200) sections.push(`  …and ${rest.length - 200} more`);
  }
  return sections.join('\n');
}

export function findByTestID(nodes: FlatNode[], id: string): FlatNode | null {
  return nodes.find((n) => n.identifier === id) || null;
}

interface TextMatch {
  node: FlatNode;
  matchKind: 'exact' | 'substring';
}

export function findByText(nodes: FlatNode[], text: string): TextMatch | null {
  const exact = nodes.find(
    (n) =>
      n.rect && // must be tappable (has a rect)
      (n.label === text || n.name === text)
  );
  if (exact) return { node: exact, matchKind: 'exact' };
  const lower = text.toLowerCase();
  const sub = nodes.find(
    (n) =>
      n.rect &&
      ((n.label && n.label.toLowerCase().includes(lower)) ||
        (n.name && n.name.toLowerCase().includes(lower)))
  );
  if (sub) return { node: sub, matchKind: 'substring' };
  return null;
}

// ─── Cached WDA session for fast element queries ────────────────────────────
//
// `waitForID` and `waitForText` poll for element appearance. The old approach
// fetched the full accessibility tree (`GET /source?format=json`) each poll —
// fast on simple screens, but **seconds** on dense ones (~130 transaction
// rows). WDA's W3C `POST /session/{sid}/element` finds a single element by
// accessibility id WITHOUT serialising the whole tree, bringing per-poll cost
// from seconds down to ~20-80ms.
//
// The session is created lazily on first use, reused across all fast-path
// calls, and invalidated on any error that suggests staleness.

let _cachedSessionId: string | null = null;
let _sessionCreating: Promise<string> | null = null;

async function getCachedSession(): Promise<string> {
  if (_cachedSessionId) return _cachedSessionId;
  // Dedup concurrent callers — don't create N sessions in parallel.
  if (_sessionCreating) return _sessionCreating;
  _sessionCreating = (async () => {
    const created = await wdaRequest('POST', '/session', {
      capabilities: { alwaysMatch: { platformName: 'iOS' } },
    });
    const sid: string | undefined = created.sessionId || created.value?.sessionId;
    if (!sid) throw new Error('WDA POST /session did not return a sessionId');
    _cachedSessionId = sid;
    return sid;
  })();
  try {
    return await _sessionCreating;
  } finally {
    _sessionCreating = null;
  }
}

function invalidateCachedSession(): void {
  const old = _cachedSessionId;
  _cachedSessionId = null;
  if (old) {
    // Best-effort cleanup in the background — don't block the caller.
    wdaRequest('DELETE', `/session/${old}`).catch(() => {});
  }
}

export async function destroyCachedSession(): Promise<void> {
  const old = _cachedSessionId;
  _cachedSessionId = null;
  if (old) {
    await wdaRequest('DELETE', `/session/${old}`).catch(() => {});
  }
}

// ─── Fast element finders ───────────────────────────────────────────────────
//
// These use the W3C WebDriver `POST /session/{sid}/element` endpoint which
// resolves a single element without serialising the full tree. Returns true
// if the element exists, false if WDA reports "no such element", and throws
// on session-level errors so the caller can invalidate and fall back.

async function fastFindByID(sid: string, accessibilityId: string): Promise<boolean> {
  try {
    await wdaRequest('POST', `/session/${sid}/element`, {
      using: 'accessibility id',
      value: accessibilityId,
    });
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // WDA returns status 7 (NoSuchElement) or a 404 when the element
    // isn't in the tree — that's a normal "not found", not an error.
    if (/no such element|NoSuchElement/i.test(msg) || msg.includes('404')) {
      return false;
    }
    throw err; // session-level error — propagate
  }
}

async function fastFindByText(sid: string, text: string): Promise<boolean> {
  const escaped = text.replace(/'/g, "\\'");
  try {
    await wdaRequest('POST', `/session/${sid}/element`, {
      using: '-ios predicate string',
      value: `label == '${escaped}' OR name == '${escaped}'`,
    });
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/no such element|NoSuchElement/i.test(msg) || msg.includes('404')) {
      return false;
    }
    throw err;
  }
}

async function ephemeralSession<T>(fn: (sessionId: string) => Promise<T>): Promise<T> {
  const created = await wdaRequest('POST', '/session', {
    capabilities: { alwaysMatch: { platformName: 'iOS' } },
  });
  const sessionId: string | undefined = created.sessionId || created.value?.sessionId;
  if (!sessionId) {
    throw new Error(`WDA POST /session did not return a sessionId: ${JSON.stringify(created)}`);
  }
  try {
    return await fn(sessionId);
  } finally {
    try {
      await wdaRequest('DELETE', `/session/${sessionId}`);
    } catch {
      /* best effort */
    }
  }
}

export async function tapXY(x: number, y: number): Promise<void> {
  await ephemeralSession((sid) => wdaRequest('POST', `/session/${sid}/wda/tap`, { x, y }));
}

/**
 * Cached logical window size from WDA `GET /window/size`. Cached because the
 * iPhone's logical bounds don't change between steps and the round-trip is
 * non-trivial — we typically only need it for swipe coordinate math.
 */
let cachedWindowSize: { width: number; height: number } | null = null;
async function getWindowSize(): Promise<{ width: number; height: number }> {
  if (cachedWindowSize) return cachedWindowSize;
  const size = await ephemeralSession(async (sid) => {
    const res = await wdaRequest('GET', `/session/${sid}/window/size`);
    const value = (res.value || res) as { width?: number; height?: number };
    if (typeof value.width !== 'number' || typeof value.height !== 'number') {
      throw new Error(`WDA /window/size returned unexpected payload: ${JSON.stringify(res)}`);
    }
    return { width: value.width, height: value.height };
  });
  cachedWindowSize = size;
  return size;
}

/**
 * Perform a flick (fast swipe with velocity) from one logical screen point to
 * another via WDA's W3C `POST /session/{sid}/actions` endpoint.
 *
 * `wda/dragfromtoforduration` is a press-and-hold-then-drag — it doesn't
 * impart velocity, so iOS treats it as a slow drag rather than a flick.
 * That's the wrong gesture for sheet dismissal: iOS snaps the sheet back
 * unless EITHER the drag passes the dismissal threshold OR the release
 * velocity is high enough. We use the W3C action sequence to control the
 * exact pointer-move timing, giving a clean flick that iOS recognises.
 *
 * `moveDurationMs` is the duration of the pointerMove from `from` to `to`.
 * Shorter = higher velocity = more flick-like. ~120ms is a good default.
 */
async function flickFromTo(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  moveDurationMs: number = 120
): Promise<void> {
  await ephemeralSession((sid) =>
    wdaRequest('POST', `/session/${sid}/actions`, {
      actions: [
        {
          type: 'pointer',
          id: 'finger1',
          parameters: { pointerType: 'touch' },
          actions: [
            { type: 'pointerMove', duration: 0, x: fromX, y: fromY },
            { type: 'pointerDown', button: 0 },
            { type: 'pause', duration: 30 },
            { type: 'pointerMove', duration: moveDurationMs, x: toX, y: toY },
            { type: 'pointerUp', button: 0 },
          ],
        },
      ],
    })
  );
}

/**
 * Perform a directional swipe across the screen.
 *
 * Logical coordinates are taken from `getWindowSize()` so the gesture works
 * the same on every device. The swipe spans 70% of the relevant axis with a
 * brisk 0.35s duration — long enough to register as a flick but short enough
 * to feel natural.
 */
export async function swipe(direction: 'up' | 'down' | 'left' | 'right'): Promise<void> {
  const { width, height } = await getWindowSize();
  const cx = width / 2;
  const cy = height / 2;
  const span = (axis: number) => axis * 0.35; // half of the 70% travel
  let from: { x: number; y: number };
  let to: { x: number; y: number };
  switch (direction) {
    case 'down':
      from = { x: cx, y: cy - span(height) };
      to = { x: cx, y: cy + span(height) };
      break;
    case 'up':
      from = { x: cx, y: cy + span(height) };
      to = { x: cx, y: cy - span(height) };
      break;
    case 'left':
      from = { x: cx + span(width), y: cy };
      to = { x: cx - span(width), y: cy };
      break;
    case 'right':
      from = { x: cx - span(width), y: cy };
      to = { x: cx + span(width), y: cy };
      break;
  }
  await flickFromTo(from.x, from.y, to.x, to.y, 120);
}

/**
 * Dismiss the topmost iOS modal sheet by performing the native swipe-down
 * gesture from the navigation bar area to the bottom of the screen.
 *
 * Used as a fast alternative to `relaunch-app` when a test wants to return
 * to the root screen after pushing through a modal stack (e.g. receive-flow,
 * send-flow). The gesture has to start in a non-scrollable region near the
 * top — the nav bar at y≈80–110 logical points is the most reliable spot.
 *
 * iOS dismisses a sheet when EITHER:
 *   - the drag passes ~50% of the modal height, OR
 *   - the release velocity is high enough to be a flick.
 *
 * We use a long, brisk drag (top → 90% of screen, 0.4s) so we hit both
 * conditions and dismiss reliably across screen sizes.
 */
export async function dismissModal(): Promise<void> {
  const { width, height } = await getWindowSize();
  // Start the swipe BELOW the iOS notification banner zone (~y=0-110)
  // and BELOW the modal nav bar (which can be obscured by a banner).
  // y≈130 lands in the top of the modal's content area: when the scroll
  // is at the top (true after every navigation in our tests), iOS treats
  // the downward drag as a sheet-dismiss gesture rather than a scroll.
  // This avoids the gesture being intercepted by an arriving push
  // notification banner.
  const fromX = Math.round(width / 2);
  const fromY = Math.round(Math.min(130, height * 0.16));
  const toX = fromX;
  const toY = Math.round(height * 0.92);
  // 100ms move duration → ~7000 pts/sec on a 850-tall device — well above
  // iOS's flick-velocity threshold so the sheet dismisses on release rather
  // than snapping back.
  await flickFromTo(fromX, fromY, toX, toY, 100);
  // Settle the dismissal animation so subsequent waits see the destination.
  await sleep(500);
}

export async function typeKeys(text: string): Promise<void> {
  await ephemeralSession((sid) =>
    wdaRequest('POST', `/session/${sid}/wda/keys`, { value: text.split('') })
  );
}

export async function pressHome(): Promise<void> {
  await ephemeralSession((sid) => wdaRequest('POST', `/session/${sid}/wda/homescreen`));
}

export async function relaunchApp(bundleId: string): Promise<void> {
  await ephemeralSession(async (sid) => {
    try {
      await wdaRequest('POST', `/session/${sid}/wda/apps/terminate`, { bundleId });
    } catch {
      /* may not be running */
    }
    await wdaRequest('POST', `/session/${sid}/wda/apps/launch`, { bundleId });
  });
  // Expo dev clients show a "Dev tools" menu sheet on launch that can render
  // anywhere from 0 to ~15 seconds after the process starts, and sometimes
  // re-renders right after dismissal. Poll aggressively: every 400ms for
  // 15 seconds, dismissing every xmark we find. After a successful dismiss,
  // do an extra 2-second confirmation pass to catch a delayed second
  // instance. Soft-fails if the menu never appears (production builds).
  await dismissDevMenuRepeatedly(15_000);
}

/**
 * Repeatedly poll for the Expo dev menu [xmark] close button and tap it
 * whenever it appears. After the first successful dismiss, we run an
 * extra confirmation window because the dev menu can re-render moments
 * after the initial dismissal animation completes.
 *
 * Used by `relaunchApp` (long initial window) and by the test executor's
 * pre-tap pre-flight (short window — see preflightDismissDevMenu).
 */
export async function dismissDevMenuRepeatedly(totalMs: number): Promise<void> {
  const start = Date.now();
  let dismissedAt = 0;
  while (Date.now() - start < totalMs) {
    try {
      const tree = await getCurrentTree();
      const flat = flattenAll(tree);
      const xmark = findByTestID(flat, 'xmark');
      if (xmark && xmark.rect) {
        await tapXY(xmark.centerX, xmark.centerY);
        await sleep(400);
        dismissedAt = Date.now();
        continue; // immediately recheck — sometimes a second sheet renders
      }
      // No xmark right now. If we already dismissed once, give the dev
      // menu a 2-second grace window to re-render. Otherwise keep polling.
      if (dismissedAt && Date.now() - dismissedAt > 2000) return;
    } catch {
      /* WDA may briefly drop the source while the app is restarting */
    }
    await sleep(400);
  }
}

/**
 * Quick (single-shot) check for the dev menu, used by the test executor
 * before each tap. Bounded at ~600ms total so it doesn't slow down clean
 * runs. The full retry behaviour stays in `dismissDevMenuRepeatedly`.
 */
export async function preflightDismissDevMenu(): Promise<void> {
  // Loop the recovery logic up to 3 times. Why: several obstructions
  // can coexist (e.g. a notification banner sitting on top of the app
  // switcher, because a background coco-created payment notification
  // arrived after an earlier gesture pushed Sovran into the switcher).
  // A one-shot preflight handles the first-matched condition and
  // returns; the next step then re-fetches the tree, finds the SECOND
  // condition still present, and fails before another preflight runs.
  // Iterating here keeps the whole recovery bounded to one step entry
  // but lets multiple obstructions drain in a single pass.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const tree = await getCurrentTree();
      const flat = flattenAll(tree);

      // ── 0. iOS paste permission dialog — HIGHEST PRIORITY ──
      // This system alert can overlay both the app AND the app switcher,
      // blocking all interaction underneath. Must be dismissed first.
      const allowPaste = flat.find(
        (n) =>
          (n.label === 'Allow Paste' || n.name === 'Allow Paste') &&
          n.rect && n.rect.width > 30
      );
      if (allowPaste && allowPaste.rect) {
        await tapXY(allowPaste.centerX, allowPaste.centerY);
        await sleep(400);
        continue;
      }

      // ── 1. iOS App Switcher (Sovran is in background) — HIGHEST PRIORITY ──
      // Detected via SBSwitcherWindow / AppSwitcherContentView in the
      // tree. If this is present, nothing else matters — taps into the
      // app will just land on the switcher background. Bring the app
      // back to foreground FIRST, then re-check for notifications or
      // dev menus on the next iteration.
      //
      // The card has a stable testID
      // `card:com.sovranbitcoin.dev:sceneID:com.sovranbitcoin.dev-default`.
      const switcher = flat.find((n) => n.identifier === 'SBSwitcherWindow:Main');
      if (switcher) {
        const card = flat.find(
          (n) =>
            n.identifier &&
            n.identifier.startsWith('card:com.sovranbitcoin.dev:sceneID')
        );
        if (card && card.rect) {
          await tapXY(card.centerX, card.centerY);
          await sleep(600);
          continue; // recheck — a banner may still be on top
        }
        // No card visible — fall back to terminate + relaunch to bail
        // out of whatever switcher state we're stuck in.
        await relaunchApp('com.sovranbitcoin.dev');
        continue;
      }

      // ── 2. iOS notification banner ──
      // Detected via NotificationShortLookView (iOS 16+) or
      // ShortLook.Platter (iOS 15). The banner overlays the top portion
      // of the screen and absorbs taps beneath it.
      //
      // IMPORTANT: the previous implementation did a fast 200pt upward
      // flick starting at the banner's centre. On a tall modern iPhone
      // a fast upward flick anywhere near the top of the screen can
      // race iOS's edge-gesture recogniser and trigger the app
      // switcher, which is exactly what broke the downstream tests.
      //
      // Safer approach: swipe upward ONLY within the banner's own rect
      // — start at the banner's bottom edge, end just above its top —
      // and use a slower move duration so iOS recognises it as a
      // standard banner dismiss drag, not a system-edge flick.
      const notification = flat.find(
        (n) =>
          n.identifier === 'NotificationShortLookView' ||
          n.identifier === 'ShortLook.Platter'
      );
      if (notification && notification.rect) {
        const r = notification.rect;
        const cx = Math.round(r.x + r.width / 2);
        const bottom = Math.round(r.y + r.height * 0.85);
        const top = Math.round(Math.max(10, r.y + r.height * 0.1));
        // 300ms move duration over ~50-80pt — inside-banner drag, not a
        // fast system flick.
        await flickFromTo(cx, bottom, cx, top, 300);
        await sleep(500);
        continue; // re-check: dismissing the banner may have revealed a dev menu
      }

      // ── 3. Expo dev menu (xmark close button) ──
      const xmark = findByTestID(flat, 'xmark');
      if (xmark && xmark.rect) {
        await tapXY(xmark.centerX, xmark.centerY);
        await sleep(400);
        continue;
      }

      // Nothing to recover from — we're clean.
      return;
    } catch {
      /* best effort — WDA may briefly drop the source; retry */
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function takeScreenshot(outPath?: string): Promise<string> {
  // Sessionless screenshot endpoint.
  const res = await wdaRequest('GET', '/screenshot');
  if (!res.value) throw new Error('WDA /screenshot returned no value');
  const target = outPath || nodePath.join(process.cwd(), `wda-${Date.now()}.png`);
  fs.writeFileSync(target, Buffer.from(res.value, 'base64'));
  return target;
}

/** Build the "you used a fallback — add a testID" nudge for an agent. */
function buildAddTestIDNudge(node: FlatNode, calledAs: string): string {
  const labelOrName = node.label || node.name || '(unlabeled)';
  const grepTerm = labelOrName.replace(/"/g, '\\"');
  const suggestedID = labelOrName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return [
    '',
    '⚠  TAPPED BY VISIBLE TEXT — please add a testID',
    '',
    `   You ran:  ${calledAs}`,
    `   Element:  ${node.type.replace('XCUIElementType', '')} "${labelOrName}" @(${node.centerX},${node.centerY})`,
    '',
    '   This match is fragile to copy or i18n changes. To make future taps',
    '   stable, add a testID to the source component:',
    '',
    `     1) Find it:  rg -n '${grepTerm}' --type tsx --type ts`,
    `     2) Add prop: testID="${suggestedID}"`,
    '        (on the <Pressable>, <Button>, or ButtonHandlerButton config)',
    '     3) Save — Metro hot-reloads the dev client automatically.',
    `     4) Next time:  npm run log-doctor -- phone tap-id ${suggestedID}`,
    '',
    '   Sovran convention: kebab-case `<screen>-<action>`, e.g.',
    '   `receive-fixed-amount`, `send-confirm`, `mint-add`.',
  ].join('\n');
}

function buildCoordTapNudge(x: number, y: number): string {
  return [
    '',
    '⚠  COORDINATE-BASED TAP — brittle, please switch to a testID',
    '',
    `   You ran:  phone tap-xy ${x} ${y}`,
    '',
    '   Coordinates break on screen-size, layout, or theme changes. Replace',
    '   this with a testID-based tap:',
    '',
    '     1) Inspect the screen:  npm run log-doctor -- phone tree',
    '     2) If the target element has a `[testID]` listed → use it:',
    '          npm run log-doctor -- phone tap-id <testID>',
    '     3) If it does NOT have one → add one in the source component',
    '        (kebab-case, e.g. `receive-fixed-amount`) and use tap-id after',
    '        Metro hot-reloads.',
  ].join('\n');
}

const STEP_TIMEOUT_MS = 90_000;


/**
 * Read the iOS clipboard via WDA. iOS 14+ blocks pasteboard reads from
 * background apps, so we have to briefly bring the WDA runner to the
 * foreground, read, and then re-activate the target app. The user sees a
 * brief visual flicker between WDA and Sovran — that's expected.
 */
export async function readClipboard(targetBundleId = 'com.sovranbitcoin.dev'): Promise<string> {
  return await ephemeralSession(async (sid) => {
    // Step 1: bring the WDA runner to the foreground so iOS allows the read.
    const wdaBundle = 'com.kelbie.WebDriverAgentRunner.xctrunner';
    try {
      await wdaRequest('POST', `/session/${sid}/wda/apps/activate`, { bundleId: wdaBundle });
      // Brief settle so foreground state actually flips before the read.
      await sleep(400);
    } catch {
      /* if activation fails, attempt the read anyway */
    }

    // Step 2: read the pasteboard.
    let text = '';
    try {
      const res = await wdaRequest('POST', `/session/${sid}/wda/getPasteboard`, {
        contentType: 'plaintext',
      });
      const b64 = res.value;
      if (typeof b64 === 'string') {
        text = Buffer.from(b64, 'base64').toString('utf-8');
      }
    } finally {
      // Step 3: bring the target app back to the foreground regardless of
      // whether the read succeeded, so subsequent steps see the right
      // screen. Note: NO explicit post-activate sleep — the next step's
      // own preflight (tap, keypad, capture all call
      // `preflightDismissDevMenu` first, which always fetches the tree)
      // naturally gives the target app time to return to foreground.
      // The old `await sleep(400)` here added 400ms of dead time to
      // every clipboard read and wasn't load-bearing in practice.
      try {
        await wdaRequest('POST', `/session/${sid}/wda/apps/activate`, {
          bundleId: targetBundleId,
        });
      } catch {
        /* best effort */
      }
    }
    return text;
  });
}

/**
 * Write to the iOS clipboard via WDA. Same foreground dance as
 * readClipboard — iOS blocks pasteboard writes from background apps.
 */
/**
 * Set by writeClipboard, cleared after the next alert/accept succeeds.
 * Tells the fast-path polling to check for the iOS paste dialog.
 */
export let _clipboardWritePending = false;

export async function writeClipboard(
  text: string,
  targetBundleId = 'com.sovranbitcoin.dev'
): Promise<void> {
  await ephemeralSession(async (sid) => {
    const wdaBundle = 'com.kelbie.WebDriverAgentRunner.xctrunner';
    try {
      await wdaRequest('POST', `/session/${sid}/wda/apps/activate`, { bundleId: wdaBundle });
      await sleep(400);
    } catch {
      /* if activation fails, attempt the write anyway */
    }

    try {
      const b64 = Buffer.from(text, 'utf-8').toString('base64');
      await wdaRequest('POST', `/session/${sid}/wda/setPasteboard`, {
        content: b64,
        contentType: 'plaintext',
      });
      _clipboardWritePending = true;
    } finally {
      try {
        await wdaRequest('POST', `/session/${sid}/wda/apps/activate`, {
          bundleId: targetBundleId,
        });
      } catch {
        /* best effort */
      }
    }
  });
}


async function pollFor<T>(
  fn: () => Promise<T | null>,
  timeoutMs: number,
  intervalMs = 400
): Promise<T> {
  const start = Date.now();
  let last: T | null = null;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (last) return last;
    await sleep(intervalMs);
  }
  throw new Error(`timeout after ${timeoutMs}ms`);
}

/**
 * Read an element's label/name via the cached WDA session. Returns the
 * label string or null if not found. Used by capture steps to avoid
 * the full tree fetch (~15-30s) when only one element's text is needed.
 */
export async function captureElementLabel(accessibilityId: string): Promise<string | null> {
  try {
    const sid = await getCachedSession();
    const findRes = await wdaRequest('POST', `/session/${sid}/element`, {
      using: 'accessibility id',
      value: accessibilityId,
    });
    const eid: string | undefined =
      findRes.value?.ELEMENT || findRes.value?.element;
    if (!eid) return null;
    // Try label first, then name.
    for (const attr of ['label', 'name']) {
      const res = await wdaRequest('GET', `/session/${sid}/element/${eid}/attribute/${attr}`);
      if (typeof res.value === 'string' && res.value.length > 0) {
        return res.value;
      }
    }
    return null;
  } catch {
    invalidateCachedSession();
    return null;
  }
}

export async function tapByID(id: string): Promise<void> {
  // ── Fast path: session-based element find + rect ──
  // Avoids the full tree serialisation (seconds on dense screens) by
  // using two lightweight session calls: POST /element → GET /element/{eid}/rect.
  try {
    const sid = await getCachedSession();
    const findRes = await wdaRequest('POST', `/session/${sid}/element`, {
      using: 'accessibility id',
      value: id,
    });
    const eid: string | undefined =
      findRes.value?.ELEMENT || findRes.value?.element;
    if (eid) {
      const rectRes = await wdaRequest('GET', `/session/${sid}/element/${eid}/rect`);
      const r = rectRes.value;
      if (r && typeof r.x === 'number') {
        const cx = Math.round(r.x + r.width / 2);
        const cy = Math.round(r.y + r.height / 2);
        // Off-screen guard (same logic as the full-tree path).
        const { width, height } = await getWindowSize();
        if (cx >= 0 && cx <= width && cy >= 0 && cy <= height) {
          await tapXY(cx, cy);
          return;
        }
        throw new Error(
          `element [${id}] is off-screen (center ${cx},${cy} outside ${width}x${height} viewport). ` +
            `Use \`scroll until #${id} visible\` before tapping.`
        );
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Off-screen errors should propagate, not fall through.
    if (msg.includes('is off-screen')) throw err;
    // "No such element" or session errors → fall through to full-tree path.
    if (!/no such element|NoSuchElement/i.test(msg) && !msg.includes('404')) {
      invalidateCachedSession();
    }
  }

  // ── Full-tree fallback ──
  const tree = await getCurrentTree();
  const flat = flattenAll(tree);
  const node = findByTestID(flat, id);
  if (!node) {
    const visible = flat
      .filter((n) => n.hasIdent)
      .map((n) => `  ${n.identifier}`)
      .slice(0, 20)
      .join('\n');
    throw new Error(
      `no element with testID="${id}" on the current screen.\n` +
        (visible ? `visible testIDs:\n${visible}` : '(no testIDs visible)')
    );
  }
  if (!node.rect) throw new Error(`element [${id}] has no rect`);

  const { width, height } = await getWindowSize();
  if (
    node.centerX < 0 ||
    node.centerX > width ||
    node.centerY < 0 ||
    node.centerY > height
  ) {
    throw new Error(
      `element [${id}] is off-screen (center ${node.centerX},${node.centerY} outside ${width}x${height} viewport). ` +
        `Use \`scroll until #${id} visible\` before tapping — XCUITest will otherwise route the injected touch to whatever's at the visible edge.`
    );
  }

  await tapXY(node.centerX, node.centerY);
}

/**
 * Scroll the screen in `direction` (`up` = swipe finger up = content
 * moves up = later items come into view) until the node identified by
 * `predicate` is FULLY inside the current viewport, or until the
 * timeout expires.
 *
 * "Fully inside" means the whole `rect` — top, bottom, left, right —
 * is within the window bounds, with a small inset so the target isn't
 * flush against the status bar or home-indicator area (both of which
 * absorb taps). Short, repeated flicks (not one big swipe) because
 * iOS's scroll inertia + XCUITest's tree-refresh latency make it
 * trivial to overshoot on a big flick.
 *
 * The predicate is a function that inspects the current tree and
 * returns the target node (or null if it can't be found yet). That
 * way this helper works for both `#foo` exact matches and
 * `#foo-prefix*` wildcards — the executor passes the appropriate
 * lookup function.
 *
 * Returns the final matched node on success; throws on timeout with
 * a message listing what *was* found, to help the user figure out
 * whether they mistyped the selector or whether the list just didn't
 * contain what they expected.
 */
export async function scrollUntilVisible(
  predicate: (flat: FlatNode[]) => FlatNode | null,
  // Direction is a *hint*, used only when the target can't be found in
  // the tree at all. When the target IS found, we compute the direction
  // from its actual rect — scrolling the opposite way wastes iterations
  // and misleads the error message on timeout. `up` = swipe finger up
  // = content moves up = reveal rows below the current viewport.
  hintDirection: 'up' | 'down',
  label: string,
  // Scroll-until gets its own, longer timeout by default because each
  // iteration pulls a full `/source?format=json` tree from WDA, which
  // can take several seconds on a dense screen (e.g. the wallet home
  // with a loaded transaction list). 90s gives enough iterations to
  // scroll a long list without being so permissive that a stuck test
  // hangs the runner indefinitely.
  timeoutMs: number = STEP_TIMEOUT_MS
): Promise<FlatNode> {
  const { width, height } = await getWindowSize();
  // Vertical safe-area insets — the home indicator at the bottom of
  // modern iPhones overlaps the last ~34pt of the window and any tap
  // within it is routed to the system gesture recognizer, not the app.
  // The notch area at the top is less of a concern (most scroll
  // containers start below the nav bar) but we pad both sides for
  // symmetry.
  const SAFE_TOP = 60;
  const SAFE_BOTTOM = 60;
  const viewportTop = SAFE_TOP;
  const viewportBottom = height - SAFE_BOTTOM;

  const isFullyVisible = (node: FlatNode): boolean => {
    if (!node.rect) return false;
    const r = node.rect;
    return (
      r.x >= 0 &&
      r.y >= viewportTop &&
      r.x + r.width <= width &&
      r.y + r.height <= viewportBottom
    );
  };

  // ADAPTIVE flicks anchored in the LOWER half of the screen. The
  // geometry has to respect three simultaneous constraints:
  //
  //   1. **Tree-fetch cost dominates.** Each iteration pulls a full
  //      `/source?format=json` tree from WDA. On a dense wallet home
  //      (~130 transaction rows mounted because `showMore=true` uses
  //      a flat VStack, not a virtualized list), that fetch runs
  //      several seconds. Every wasted iteration blows ~10% of the
  //      60s budget — the loop can't afford to iterate 20 times.
  //
  //   2. **Monotonic convergence, not ping-pong.** A fixed 50%-span
  //      flick that misses the target's viewport gap by even one flick
  //      puts the target ABOVE the viewport the next iteration, then
  //      the direction flips and the next flick overshoots the other
  //      way. A big-enough list + bad-enough timing produces infinite
  //      oscillation. The fix: AIM at the viewport CENTER, not at the
  //      opposite side. On each iteration, compute the delta between
  //      the target's centre-y and the viewport's centre-y, and flick
  //      by exactly that distance (clamped).
  //
  //   3. **Don't land inside the AccountPagerView Swiper.** The
  //      wallet home's top ~36% is a horizontal
  //      react-native-web-infinite-swiper that absorbs vertical
  //      gestures originating inside its hit region. Every flick
  //      must START below it (flickLowY anchored at ~82% of screen),
  //      and the upper end must stay above the bottom home-indicator
  //      region (y ≥ 15% of screen). Since we clamp flickDist at
  //      ≤35% of viewport, the finger never crosses into the Swiper
  //      zone during a flick.
  const flickDurationMs = 300;
  const cx = Math.round(width / 2);
  const flickLowY = Math.round(height * 0.82);
  const viewportCenterY = Math.round(viewportTop + (viewportBottom - viewportTop) / 2);
  // Max usable flick span — stays well above the Swiper region and
  // below the home indicator.
  const flickMax = Math.round(height * 0.35);
  // Min flick span — below this, iOS rubber-band damping eats the
  // gesture and `node.rect.y` moves by sub-pixel amounts that would
  // spuriously trip the stall detector.
  const flickMin = Math.round(height * 0.15);
  // Default push when the target isn't in the tree yet — a medium
  // distance that makes visible progress without overshooting a
  // just-about-to-appear row.
  const flickHint = Math.round(height * 0.3);

  /**
   * Execute a single flick of `flickDist` logical points in `dir`.
   * `up` means "finger moves up, content shifts up, rows below
   * viewport come into view". Finger always originates at flickLowY
   * (below the Swiper) and the other end of the drag is computed
   * from the requested distance so bigger flicks reach higher on the
   * screen but never crest the bottom-of-Swiper line.
   */
  const doFlick = async (dir: 'up' | 'down', flickDist: number): Promise<void> => {
    const span = Math.max(flickMin, Math.min(flickMax, Math.round(flickDist)));
    // The high end of the flick — always above flickLowY by `span` pts.
    const topY = Math.max(Math.round(height * 0.15), flickLowY - span);
    if (dir === 'up') {
      await flickFromTo(cx, flickLowY, cx, topY, flickDurationMs);
    } else {
      await flickFromTo(cx, topY, cx, flickLowY, flickDurationMs);
    }
  };

  /**
   * Cheap fingerprint of the current flat tree used to decide whether
   * the scroll view actually moved / changed between iterations. We
   * only need enough entropy to detect "exact same tree" vs "some
   * change"; full hashing is overkill and the `flat.length` + outer
   * identifiers are stable enough to flag a truly-stuck screen.
   */
  const fingerprint = (flat: FlatNode[]): string =>
    `${flat.length}:${flat[0]?.identifier ?? ''}:${flat[flat.length - 1]?.identifier ?? ''}`;

  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  let iterations = 0;
  // Stall detection: if the node's y stops changing between flicks,
  // we've hit the end of the scroll view and further scrolling won't
  // help — bail out early with a useful message instead of timing out.
  let lastY: number | null = null;
  let stallCount = 0;
  // Null-node stall: when the target selector matches zero nodes AND
  // the tree hasn't changed for several iterations, the list simply
  // doesn't contain the element. Fail fast with a precise error
  // instead of flicking for the full 60s budget.
  let lastFingerprint: string | null = null;
  let nullStreak = 0;

  while (Date.now() < deadline) {
    const tree = await getCurrentTree();
    const flat = flattenAll(tree);
    const node = predicate(flat);

    if (node && isFullyVisible(node)) {
      return node;
    }

    // Obstruction recovery: if the tree now contains a notification
    // banner, app switcher, or dev menu, we've been pushed out of the
    // app mid-scroll. Without this, scroll-until burns its 60s budget
    // flicking a scroll view it can't reach and fails with a confusing
    // "timed out" message. With it, a Signal banner arriving 20s into
    // the scroll is dismissed and the loop continues.
    //
    // Cheap check: we already have the flat tree for this iteration —
    // look for the obstruction markers before issuing another fetch.
    // If found, call preflight (which will do its own fetch + recover)
    // and restart the iteration so the next pass sees the recovered
    // tree.
    const obstructed = flat.some(
      (n) =>
        n.identifier === 'SBSwitcherWindow:Main' ||
        n.identifier === 'NotificationShortLookView' ||
        n.identifier === 'ShortLook.Platter' ||
        n.identifier === 'xmark'
    );
    if (obstructed) {
      await preflightDismissDevMenu();
      // Reset trackers — the obstructed iteration's lastY and tree
      // fingerprint are not meaningful comparisons against post-recovery.
      lastY = null;
      stallCount = 0;
      lastFingerprint = null;
      nullStreak = 0;
      continue;
    }

    // Pick the scroll direction AND distance for THIS iteration.
    let dir: 'up' | 'down' = hintDirection;
    let flickDist = flickHint;

    if (node && node.rect) {
      // Target IS in the tree. Compute the gap between its centre and
      // the viewport centre, and flick exactly that much in the sign
      // direction — clamped so a single flick can't overshoot the
      // opposite edge.
      const nodeCenterY = node.rect.y + node.rect.height / 2;
      const delta = nodeCenterY - viewportCenterY;
      dir = delta > 0 ? 'up' : 'down';
      flickDist = Math.min(flickMax, Math.abs(delta));

      // Stall detection on y — if the rect barely moved between flicks
      // we're pinned against a scroll edge. Bail out cleanly.
      if (lastY !== null && Math.abs(node.rect.y - lastY) < 8) {
        stallCount++;
        if (stallCount >= 3) {
          throw new Error(
            `scroll until ${label} visible: scrolled to the edge of the list but target is still outside the viewport (y=${Math.round(node.rect.y)}, viewport ${viewportTop}..${viewportBottom}). The element may be inside a fixed-height container or overlapped by the home indicator.`
          );
        }
      } else {
        stallCount = 0;
      }
      lastY = node.rect.y;
      // Reset the null-streak tracker — we DID find the node this iter.
      lastFingerprint = null;
      nullStreak = 0;
    } else {
      // Target NOT in the tree. Track how many iterations in a row this
      // persists WITH the tree unchanged — indicates the list simply
      // doesn't contain the selector, not that we're still scrolling
      // toward it. Fail fast after 5 such iterations (at ~8s per fetch
      // on a dense wallet home, that's ~40s, well inside the budget).
      const fp = fingerprint(flat);
      if (fp === lastFingerprint) {
        nullStreak++;
        if (nullStreak >= 5) {
          throw new Error(
            `scroll until ${label} visible: selector matched zero nodes across 5 iterations and the tree is not changing — check the testID or confirm the list actually contains this entry`
          );
        }
      } else {
        nullStreak = 0;
      }
      lastFingerprint = fp;
      // Target-less iterations use the hint direction and a medium
      // flick — enough progress to keep moving, but not so much we
      // blow past a row that's about to mount.
      dir = hintDirection;
      flickDist = flickHint;
    }

    await doFlick(dir, flickDist);
    // Tiny settle after the flick so the next tree-read sees the new
    // scroll offset. 150ms is a compromise between letting iOS's
    // post-drag animation settle and keeping iterations fast.
    await sleep(150);
    iterations++;

    // Safety valve — even without a stall, don't scroll forever.
    // 40 flicks at up to ~35% viewport each is ~14 screens of scroll,
    // comfortably more than any realistic list we target.
    if (iterations > 40) {
      break;
    }
  }

  throw new Error(
    `scroll until ${label} visible: timed out after ${Date.now() - startedAt}ms (${iterations} flicks)`
  );
}

export async function tapByText(text: string): Promise<{ node: FlatNode; nudge: boolean }> {
  // ── Fast path: session-based predicate find + rect ──
  try {
    const sid = await getCachedSession();
    const escaped = text.replace(/'/g, "\\'");
    const findRes = await wdaRequest('POST', `/session/${sid}/element`, {
      using: '-ios predicate string',
      value: `label == '${escaped}' OR name == '${escaped}'`,
    });
    const eid: string | undefined =
      findRes.value?.ELEMENT || findRes.value?.element;
    if (eid) {
      const rectRes = await wdaRequest('GET', `/session/${sid}/element/${eid}/rect`);
      const r = rectRes.value;
      if (r && typeof r.x === 'number') {
        const cx = Math.round(r.x + r.width / 2);
        const cy = Math.round(r.y + r.height / 2);
        await tapXY(cx, cy);
        // Can't determine nudge without the full tree — assume no nudge
        // on the fast path (the element was found by text, so it likely
        // lacks a testID, but we skip the nudge to avoid the tree fetch).
        return { node: { identifier: '', label: text, name: text, type: '', rect: r, centerX: cx, centerY: cy, hasIdent: false }, nudge: true };
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/no such element|NoSuchElement/i.test(msg) && !msg.includes('404')) {
      invalidateCachedSession();
    }
  }

  // ── Full-tree fallback ──
  const tree = await getCurrentTree();
  const flat = flattenAll(tree);
  const match = findByText(flat, text);
  if (!match) throw new Error(`no element matches text "${text}" on the current screen`);
  await tapXY(match.node.centerX, match.node.centerY);
  return { node: match.node, nudge: !match.node.hasIdent };
}

export async function tapKeypadDigit(digit: string): Promise<void> {
  if (!/^[0-9]$/.test(digit)) {
    throw new Error(`keypad arg must be a single digit 0-9, got "${digit}"`);
  }
  // Pre-flight: dismiss any dev menu, notification banner, or app
  // switcher obstruction before looking for the keypad. `execStep`'s
  // `keypad` case calls this helper directly rather than going
  // through `performTap`, so without this call the keypad path
  // bypasses the recovery logic every other tap gets. Cell 1/4 of
  // the send-token coverage matrix failed because of exactly this:
  // a notification banner arrived between `wait for #amount-next`
  // and `keypad 1`, the keypad was still on screen under the banner,
  // but `findByTestID` on the banner-containing tree couldn't see
  // the digit.
  await preflightDismissDevMenu();
  // Small settle: when called immediately after a navigation, the keypad
  // can be in the tree but not yet ready to receive taps (its underlying
  // gesture handler is still attaching). 200ms is enough to clear that
  // race in practice.
  await sleep(200);
  const tree = await getCurrentTree();
  const flat = flattenAll(tree);
  // Keypad digits are sized buttons (~60x60). Filter to nodes whose label/name
  // is exactly the digit AND have a sizeable rect, to avoid hitting a static
  // text "1" elsewhere on screen.
  const candidates = flat.filter(
    (n) =>
      n.rect &&
      (n.label === digit || n.name === digit) &&
      n.rect.width >= 40 &&
      n.rect.height >= 40
  );
  if (candidates.length === 0) {
    throw new Error(
      `no keypad digit "${digit}" visible. ` +
        `Either the keypad isn't on screen, or its digits aren't sized as expected (>=40px).`
    );
  }
  // Pick the largest match (the keypad button, not any incidental text).
  candidates.sort((a, b) => (b.rect!.width * b.rect!.height) - (a.rect!.width * a.rect!.height));
  await tapXY(candidates[0].centerX, candidates[0].centerY);
  // Tiny post-tap settle so subsequent steps see the updated amount/state.
  await sleep(150);
}

/**
 * Detect whether a freshly-flattened tree is showing an obstruction
 * that will prevent the app's own testIDs from ever matching — an
 * iOS notification banner, the app switcher, or the Expo dev menu.
 *
 * Used by the wait/scroll/tap helpers to drive an in-loop call to
 * `preflightDismissDevMenu` when an obstruction is noticed mid-poll.
 * Without this, a banner sliding in during a 10s wait makes the
 * whole poll window useless — none of the app's testIDs are in the
 * Springboard-rooted tree the query returns, and the caller times
 * out on an element that was always there underneath.
 */
function treeHasObstruction(flat: FlatNode[]): boolean {
  return flat.some(
    (n) =>
      n.identifier === 'SBSwitcherWindow:Main' ||
      n.identifier === 'NotificationShortLookView' ||
      n.identifier === 'ShortLook.Platter' ||
      n.identifier === 'xmark' ||
      n.label === 'Allow Paste' || n.name === 'Allow Paste'
  );
}

export async function waitForID(id: string, timeoutMs: number = STEP_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const FAST_POLL_MS = 80;
  const OBSTRUCTION_INTERVAL_MS = 2_000;
  let lastObstructionCheck = Date.now();
  let fastPathFailed = false;

  while (Date.now() < deadline) {
    const now = Date.now();

    // ── Periodic full-tree check for obstructions ──
    // Every ~2s (and on the very first iteration) we fall back to the
    // full tree fetch so we can detect dev-menu overlays, notification
    // banners, and the iOS app switcher. While we have the tree, we
    // also check for the element itself — it's free at that point.
    if (now - lastObstructionCheck >= OBSTRUCTION_INTERVAL_MS) {
      lastObstructionCheck = now;
      try {
        const tree = await getCurrentTree();
        const flat = flattenAll(tree);
        if (findByTestID(flat, id)) return;
        if (treeHasObstruction(flat)) {
          await preflightDismissDevMenu();
          invalidateCachedSession();
          continue;
        }
      } catch {
        // Tree fetch failed — try fast path anyway.
      }
    }

    // ── Fast path: session-based POST /element ──
    if (!fastPathFailed) {
      try {
        const sid = await getCachedSession();
        if (await fastFindByID(sid, id)) return;
        // Check for iOS paste permission dialog. GET /alert/text is fast
        // (~20ms, 404 when no alert). If a paste dialog is showing, find
        // the "Allow Paste" button via session element find and tap it
        // directly — don't use /alert/accept which might hit "Don't Allow".
        try {
          const alertRes = await wdaRequest('GET', `/session/${sid}/alert/text`);
          const alertText: string = alertRes.value || '';
          if (/paste/i.test(alertText)) {
            try {
              const btnRes = await wdaRequest('POST', `/session/${sid}/element`, {
                using: '-ios predicate string',
                value: `label == 'Allow Paste'`,
              });
              const btnEid: string | undefined =
                btnRes.value?.ELEMENT || btnRes.value?.element;
              if (btnEid) {
                const rectRes = await wdaRequest('GET', `/session/${sid}/element/${btnEid}/rect`);
                const r = rectRes.value;
                if (r && typeof r.x === 'number') {
                  await tapXY(
                    Math.round(r.x + r.width / 2),
                    Math.round(r.y + r.height / 2)
                  );
                }
              }
            } catch {
              // Button find failed — do NOT fall back to /alert/accept
              // which taps the default button ("Don't Allow Paste").
            }
            await sleep(500);
            lastObstructionCheck = Date.now();
            continue;
          }
        } catch {
          // "no such alert" — continue polling.
        }
      } catch {
        // Session error — invalidate and fall back to slow path.
        invalidateCachedSession();
        fastPathFailed = true;
        continue;
      }
      await sleep(FAST_POLL_MS);
      continue;
    }

    // ── Slow fallback (only if fast path errored out) ──
    const tree = await getCurrentTree();
    const flat = flattenAll(tree);
    if (findByTestID(flat, id)) return;
    if (treeHasObstruction(flat)) {
      await preflightDismissDevMenu();
      continue;
    }
    await sleep(400);
  }

  throw new Error(
    `timeout after ${timeoutMs}ms\n` +
    `Verify the testID "${id}" exists in the app:\n` +
    `  rg 'testID.*${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\|name=.*${id.replace('screen-', '').split('-').map(w => w[0].toUpperCase() + w.slice(1)).join('')}' --type tsx --type ts`
  );
}

export async function waitForText(text: string, timeoutMs: number = STEP_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const FAST_POLL_MS = 80;
  const OBSTRUCTION_INTERVAL_MS = 2_000;
  let lastObstructionCheck = Date.now();
  let fastPathFailed = false;

  while (Date.now() < deadline) {
    const now = Date.now();

    if (now - lastObstructionCheck >= OBSTRUCTION_INTERVAL_MS) {
      lastObstructionCheck = now;
      try {
        const tree = await getCurrentTree();
        const flat = flattenAll(tree);
        if (findByText(flat, text)) return;
        if (treeHasObstruction(flat)) {
          await preflightDismissDevMenu();
          invalidateCachedSession();
          continue;
        }
      } catch {
        // Tree fetch failed — try fast path anyway.
      }
    }

    if (!fastPathFailed) {
      try {
        const sid = await getCachedSession();
        if (await fastFindByText(sid, text)) return;
        // Fast paste-dialog dismissal (same as waitForID).
        try {
          const alertRes = await wdaRequest('GET', `/session/${sid}/alert/text`);
          if (/paste/i.test(alertRes.value || '')) {
            try {
              const btnRes = await wdaRequest('POST', `/session/${sid}/element`, {
                using: '-ios predicate string',
                value: `label == 'Allow Paste'`,
              });
              const btnEid: string | undefined =
                btnRes.value?.ELEMENT || btnRes.value?.element;
              if (btnEid) {
                const rectRes = await wdaRequest('GET', `/session/${sid}/element/${btnEid}/rect`);
                const r = rectRes.value;
                if (r && typeof r.x === 'number') {
                  await tapXY(
                    Math.round(r.x + r.width / 2),
                    Math.round(r.y + r.height / 2)
                  );
                }
              }
            } catch {
              try { await wdaRequest('POST', `/session/${sid}/alert/accept`); } catch {}
            }
            await sleep(500);
            lastObstructionCheck = Date.now();
            continue;
          }
        } catch {
          // No alert — continue polling.
        }
      } catch {
        invalidateCachedSession();
        fastPathFailed = true;
        continue;
      }
      await sleep(FAST_POLL_MS);
      continue;
    }

    // Slow fallback.
    const tree = await getCurrentTree();
    const flat = flattenAll(tree);
    if (findByText(flat, text)) return;
    if (treeHasObstruction(flat)) {
      await preflightDismissDevMenu();
      continue;
    }
    await sleep(400);
  }

  throw new Error(`timeout after ${timeoutMs}ms`);
}

/**
 * Find the topmost matching node by testID prefix. Prefers in-viewport
 * matches: list-style screens often have testIDs in the AX tree for rows
 * that are scrolled off-screen, and tapping their off-screen coordinates
 * just hits whatever's at the bottom edge of the visible viewport. By
 * filtering to nodes with reasonable on-screen rects we avoid that
 * footgun. Falls back to any match if nothing in-viewport matches.
 */
export function findByTestIDPrefix(nodes: FlatNode[], prefix: string): FlatNode | null {
  const all = nodes.filter((n) => n.identifier.startsWith(prefix));
  if (all.length === 0) return null;
  // Prefer matches that are visible in a reasonable viewport (the iPhone
  // logical screen is ~390×844 on iPhone 12-15, larger on Pro Max). We
  // accept y in [0, 900] as "visible enough" — anything beyond that is
  // almost certainly off-screen in the scroll view.
  const visible = all.filter(
    (n) => n.rect && n.rect.y >= 0 && n.rect.y < 900 && n.rect.height > 0
  );
  if (visible.length > 0) {
    // Return the visually topmost (lowest y) — for date-sorted lists
    // this is the newest entry.
    visible.sort((a, b) => a.rect!.y - b.rect!.y);
    return visible[0];
  }
  return all[0];
}

export function findAllByTestIDPrefix(nodes: FlatNode[], prefix: string): FlatNode[] {
  return nodes.filter((n) => n.identifier.startsWith(prefix));
}

/**
 * Find the first node whose testID starts with `prefix` in tree
 * traversal order, skipping nodes with a zero-sized rect (which are
 * unrenderable and would never be tappable anyway).
 *
 * Contrast with `findByTestIDPrefix`, which filters to in-viewport
 * nodes and then sorts by `y` to pick the visually topmost match.
 * That heuristic is fine for a vertical list like the wallet's
 * transaction rows, where topmost-visible == newest, but it's
 * y-unstable for siblings on the same horizontal row (the amount
 * suggestion chips all sit at identical y values, so the topmost
 * sort collapses to insertion order anyway — and becomes subtly
 * broken any time the sort is unstable or a chip's rect glitches).
 *
 * `first` is the explicit version: the FIRST-mounted matching node
 * in `flattenAll`'s document order. Because `flattenAll` does a
 * pre-order traversal of the WDA `/source` tree and React/Expo
 * renders children in JSX order, that's always the same element
 * the test author would point at when they say "the first chip".
 * The `rect.width > 0 && rect.height > 0` filter drops placeholder
 * / off-screen-but-in-tree siblings that would otherwise win the
 * race for position 0.
 */
export function findByTestIDPrefixFirst(nodes: FlatNode[], prefix: string): FlatNode | null {
  for (const n of nodes) {
    if (
      n.identifier.startsWith(prefix) &&
      n.rect &&
      n.rect.width > 0 &&
      n.rect.height > 0
    ) {
      return n;
    }
  }
  return null;
}

export async function waitForIDPrefix(prefix: string): Promise<FlatNode> {
  return await pollFor(async () => {
    const tree = await getCurrentTree();
    const flat = flattenAll(tree);
    return findByTestIDPrefix(flat, prefix);
  }, STEP_TIMEOUT_MS);
}

export async function assertID(id: string): Promise<void> {
  const tree = await getCurrentTree();
  const flat = flattenAll(tree);
  if (!findByTestID(flat, id)) {
    throw new Error(`assert-id failed: testID="${id}" not on screen`);
  }
}

export async function assertText(text: string): Promise<void> {
  const tree = await getCurrentTree();
  const flat = flattenAll(tree);
  if (!findByText(flat, text)) {
    throw new Error(`assert-text failed: "${text}" not on screen`);
  }
}

export async function assertIDPrefix(prefix: string): Promise<FlatNode> {
  const tree = await getCurrentTree();
  const flat = flattenAll(tree);
  const node = findByTestIDPrefix(flat, prefix);
  if (!node) {
    const visible = flat
      .filter((n) => n.hasIdent)
      .map((n) => `  ${n.identifier}`)
      .slice(0, 30)
      .join('\n');
    throw new Error(
      `assert-id-prefix failed: no element with testID starting "${prefix}" on screen.\n` +
        (visible ? `visible testIDs:\n${visible}` : '(no testIDs visible)')
    );
  }
  return node;
}


export async function detectDeviceLabel(): Promise<string> {
  try {
    const status = await wdaRequest('GET', '/status');
    const os = status.value?.os;
    return os ? `${status.value?.device || 'iphone'} (${os.name} ${os.version})` : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Single-shot health probe for WDA. 2-second timeout so it doesn't block
 * the runner if the daemon is dead but the port is bound by a stale forwarder.
 */
async function isWDAReady(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2000);
    const res = await fetch('http://localhost:8100/status', { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return false;
    const json = (await res.json()) as { value?: { ready?: boolean } };
    return json?.value?.ready === true;
  } catch {
    return false;
  }
}

/**
 * Ensure WDA is up and answering HTTP before the test runner does anything
 * that needs it. The strategy is fail-fast: ONE bring-up attempt, single
 * 90-second budget, every `[wda]`/`[wda:runner]` line streamed live to
 * the user's terminal so they see what's happening as it happens.
 *
 * If the bring-up fails we dump the tail of `wda.log` so the actual
 * underlying error (testmanagerd dropping the connection, signing issue,
 * etc.) is visible without the user having to open the log file. Then we
 * surface the recovery steps — replug, toggle Developer Mode, restart
 * phone. Retrying inside the runner doesn't help when the device-side
 * handshake is dead; the user has to do device-level recovery first.
 *
 * Set `LOG_DOCTOR_SKIP_WDA_BRINGUP=1` to bypass this check (useful when
 * debugging WDA issues by hand or when the daemon is being managed
 * outside the runner).
 */
async function ensureWDAReady(): Promise<void> {
  if (await isWDAReady()) return;

  if (process.env.LOG_DOCTOR_SKIP_WDA_BRINGUP === '1') {
    throw new Error(
      'WDA not reachable at http://localhost:8100 and LOG_DOCTOR_SKIP_WDA_BRINGUP=1 is set.\n' +
        'Bring it up manually with: npm run dev:wda'
    );
  }

  emitRecoveryLine('▸ WDA not reachable. Bringing it up via scripts/start-wda.sh…');

  // Best-effort cleanup of any leaked ios processes from a previous
  // failed bring-up. Otherwise the new tunnel/forwarder collides with
  // the stale one bound to port 8100.
  spawnSync('pkill', ['-9', '-f', 'ios tunnel'], { stdio: 'ignore' });
  spawnSync('pkill', ['-9', '-f', 'ios runwda'], { stdio: 'ignore' });
  spawnSync('pkill', ['-9', '-f', 'ios forward'], { stdio: 'ignore' });
  spawnSync('pkill', ['-9', '-f', 'start-wda'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1000));

  // Spawn start-wda.sh detached so WDA stays alive after the runner
  // exits — subsequent test runs reuse it and skip this whole path.
  // Output goes to wda.log (append); we tail it for live progress.
  const logFd = fs.openSync(nodePath.resolve(process.cwd(), 'wda.log'), 'a');
  const child = spawn('bash', ['scripts/start-wda.sh'], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    cwd: process.cwd(),
  });
  child.unref();
  const startedAt = Date.now();
  let logCursor = fs.fstatSync(logFd).size;
  fs.closeSync(logFd);

  // 180-second budget: 120s WDA-HTTP wait inside the script + ~30s of
  // tunnel/forwarder setup + ~30s slack for forwarder restarts. If it's
  // not up by then it's not coming up without device recovery.
  const BUDGET_MS = 180_000;
  let failureLineSeen = false;
  while (Date.now() - startedAt < BUDGET_MS) {
    if (await isWDAReady()) {
      emitRecoveryLine('▸ WDA READY ✓');
      return;
    }
    try {
      const stat = fs.statSync('wda.log');
      if (stat.size > logCursor) {
        const fd = fs.openSync('wda.log', 'r');
        const buf = Buffer.alloc(stat.size - logCursor);
        fs.readSync(fd, buf, 0, buf.length, logCursor);
        fs.closeSync(fd);
        logCursor = stat.size;
        const chunk = buf.toString('utf-8');
        // Surface every wda log line live — no filtering. Users want to
        // see what's happening, especially when it's not happening.
        for (const line of chunk.split('\n')) {
          if (line.startsWith('[wda]') || line.startsWith('[wda:runner]') || line.startsWith('[wda:tunnel]')) {
            emitRecoveryLine(`  ${line}`);
          }
        }
        if (chunk.includes('did not become ready')) {
          failureLineSeen = true;
          break;
        }
      }
    } catch {
      /* wda.log may not exist yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  // Build the error message — include the tail of wda.log so the user
  // sees the actual underlying cause (e.g. "lost connection to
  // testmanagerd") without having to open the log file.
  let logTail = '';
  try {
    const all = fs.readFileSync('wda.log', 'utf-8').split('\n');
    logTail = all.slice(-30).join('\n');
  } catch {
    /* ignore */
  }

  throw new Error(
    `WDA bring-up ${failureLineSeen ? 'failed' : 'timed out'} after ${Math.floor((Date.now() - startedAt) / 1000)}s.\n` +
      '\n' +
      '──── tail of wda.log ────\n' +
      logTail +
      '\n──── recovery steps ────\n' +
      '\n' +
      "If you see 'lost connection to testmanagerd' or 'conn1 closed unexpectedly'\n" +
      'above, the device side has rejected the test runner. Try in order:\n' +
      '\n' +
      '  1. Replug the iPhone via USB\n' +
      '  2. Settings → Privacy & Security → Developer Mode → toggle off,\n' +
      '     restart phone, on, re-trust the Mac when prompted\n' +
      '  3. Restart the iPhone if (1) and (2) don’t help\n' +
      '  4. Reinstall WebDriverAgent — see docs/device-automation.md\n' +
      '\n' +
      'Set LOG_DOCTOR_SKIP_WDA_BRINGUP=1 to bypass this check while debugging.\n' +
      '\n' +
      'After recovery, re-run: npm run log-doctor -- phone test all'
  );
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
        writeMatrixResultTable(
          foundMatrix.file,
          foundMatrix.matrix,
          matrixResult,
          { label: await detectDeviceLabel() }
        );
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
    throw new Error(
      `no test or matrix named '${name}'.\n\nAvailable:\n${formatTestList(result)}`
    );
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
    writeMatrixResultTable(
      foundMatrix.file,
      foundMatrix.matrix,
      matrixResult,
      { label: await detectDeviceLabel() }
    );
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
      'Modes: stats, timeline, errors, slow, renders, screens, startup, coco, network, full, diff, flows, ws, gc, budget, phone'
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
        'Valid modes: stats, timeline, errors, slow, renders, screens, startup, coco, network, full, diff, flows, ws, gc, budget, crypto, ops, perf, phone'
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
  process.on('exit', () => { invalidateCachedSession(); });
  main().catch((err) => {
    console.error(err instanceof Error ? err.stack || err.message : String(err));
    process.exit(1);
  });
}
