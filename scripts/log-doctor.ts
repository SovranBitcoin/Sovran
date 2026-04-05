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
 *   npx ts-node scripts/log-doctor.ts <mode> [options] < log.txt
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
const fs = require('fs') as typeof import('fs');
const nodePath = require('path') as typeof import('path');

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
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--') && i === 0) {
      opts.mode = arg;
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
    if (!trimmed || trimmed.startsWith('===') || trimmed.startsWith('Entries:') || trimmed.startsWith('Time range:') || trimmed.startsWith('Device:')) continue;
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
        } catch { /* skip */ }
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
    console.error(`[--latest] Skipped ${dropped} entries from older sessions (keeping ${session.length} of ${total})`);
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
  'render.count', 'render.why', 'component.mount', 'component.unmount',
  'state.change', 'query.result', 'query.diff',
  'ui.screen', 'ui.screen.diff',
  'lifecycle.mount', 'lifecycle.unmount',
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
    case 'fatal': return 'FATAL';
    case 'error': return 'ERROR';
    case 'warn': return 'WARN ';
    case 'info': return 'INFO ';
    case 'debug': return 'DEBUG';
    default: return '     ';
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
  let minT = Infinity, maxT = -Infinity;
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
  lines.push(`Time span: ${((maxT - minT) / 1000).toFixed(1)}s (${minT.toFixed(0)}ms -> ${maxT.toFixed(0)}ms)`);
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
      if (event.startsWith('render.') || event.startsWith('component.')) category = 'render tracking';
      else if (event.startsWith('state.')) category = 'state tracking';
      else if (event.startsWith('query.')) category = 'data hook tracking';
      else if (event.startsWith('ui.screen') || event.startsWith('lifecycle.')) category = 'screen tracking';
      else category = event;
      instrumentationBreakdown.set(category, (instrumentationBreakdown.get(category) ?? 0) + count);
    } else {
      appEventCounts.push([event, count]);
    }
  }

  if (instrumentationTotal > 0) {
    const pct = ((instrumentationTotal / entries.length) * 100).toFixed(0);
    lines.push(`INSTRUMENTATION: ${instrumentationTotal} entries (${pct}% of total) — use "renders" or "screens" mode for details`);
    for (const [cat, count] of [...instrumentationBreakdown.entries()].sort((a, b) => b[1] - a[1])) {
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
    lines.push(`  Top 5 gaps: ${gaps.slice(0, 5).map((g) => Math.round(g) + 'ms').join(', ')}`);
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
  const dedupedEntries = entries.filter((e) => e.params && typeof (e.params as any)._dedup === 'number' && (e.params as any)._dedup > 1);
  if (dedupedEntries.length > 0) {
    const totalSuppressed = dedupedEntries.reduce((s, e) => s + ((e.params as any)._dedup as number) - 1, 0);
    lines.push(`DEDUPED BY LOGGER: ${totalSuppressed} entries collapsed into ${dedupedEntries.length} (${totalSuppressed} suppressed)`);
    const byEvent = new Map<string, number>();
    for (const e of dedupedEntries) byEvent.set(e.event, (byEvent.get(e.event) ?? 0) + ((e.params as any)._dedup as number) - 1);
    for (const [event, count] of [...byEvent.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
      lines.push(`  ${String(count).padStart(5)}x  ${event}`);
    }
  }

  // Template-based dedup: group by event name, show which params vary.
  // Simplified Drain algorithm — for structured logs the event name IS the template,
  // and the varying parts are the param values.
  lines.push('');
  lines.push('EVENT TEMPLATES (param variability):');
  const templateGroups = new Map<string, { count: number; paramKeys: Set<string>; varyingKeys: Set<string>; tFirst: number; tLast: number }>();
  for (const e of entries) {
    const existing = templateGroups.get(e.event);
    const t = e._t ?? 0;
    const keys = e.params ? Object.keys(e.params).filter(k => k !== '_dedup') : [];
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
      lines.push(`  ${String(g.count).padStart(5)}x  ${event} (${spanStr}) [${keys || 'no params'}]`);
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
  let prevT: number | null = opts.offset > 0 && entries[opts.offset - 1]
    ? (entries[opts.offset - 1]._t ?? null)
    : null;

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
    for (let i = Math.max(0, idx - opts.context); i <= Math.min(entries.length - 1, idx + opts.context); i++) {
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
  const gaps: Array<{ from: LogEntry; to: LogEntry; gap: number; fromIdx: number; toIdx: number }> = [];

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
  const renderEvents = entries.filter((e) =>
    INSTRUMENTATION_EVENTS.has(e.event) || e.event.includes('render') || e.event.includes('.mount') ||
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
    const sorted = [...componentRenders.entries()].sort((a, b) => b[1].maxRenders - a[1].maxRenders);
    for (const [name, stats] of sorted) {
      const flag = stats.warned ? 'EXCESSIVE' : stats.maxRenders > 10 ? 'HIGH' : 'ok';
      const rps = stats.maxRendersPerSec > 0 ? ` ${stats.maxRendersPerSec.toFixed(1)}/s` : '';
      lines.push(`  [${flag.padEnd(9)}] ${name}: ${stats.maxRenders} renders${rps} (alive ${formatDelta(stats.aliveMs).trim()})`);
    }
    lines.push('');
  }

  // ── Section 2: Why-did-update summary (from render.why) ──
  // Aggregate by component → prop → hint, showing only unique causes
  interface PropChangeInfo { hint: string; count: number }
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
  const legacyEvents = renderEvents.filter((e) =>
    !INSTRUMENTATION_EVENTS.has(e.event) && (e.event.includes('render') || e.event.includes('scroll.offset.init'))
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
    for (const [event, data] of [...eventCounts.entries()].sort((a, b) => b[1].count - a[1].count)) {
      const flag = data.count > 10 ? 'EXCESSIVE' : data.count > 5 ? 'HIGH' : 'ok';
      const span = data.timestamps.length > 1
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
  const screenEvents = entries.filter((e) =>
    e.event === 'ui.screen' || e.event === 'ui.screen.diff' ||
    e.event === 'lifecycle.mount' || e.event === 'lifecycle.unmount'
  );

  if (screenEvents.length === 0) return 'No screen events found. Ensure <Screen> and useLifecycleLogger kill switches are removed.';

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
      const dur = m.action === 'unmount'
        ? (() => { const d = durations.find((d) => d.component === m.component); return d ? ` (visible ${formatDelta(d.duration).trim()})` : ''; })()
        : '';
      lines.push(`${formatDelta(delta)} ${icon} ${m.component}${dur}`);
    }
    lines.push(mountFooter);
    lines.push('');
  }

  // ── Section 2: Screen content snapshots ──
  const contentEvents = screenEvents.filter((e) => e.event === 'ui.screen' || e.event === 'ui.screen.diff');
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
    const durStr = duration < 1 ? '<1ms' : duration < 1000 ? `${Math.round(duration)}ms` : `${(duration / 1000).toFixed(1)}s`;
    const bar = duration > 0 ? '█'.repeat(Math.max(1, Math.round((duration / (maxEnd - minStart)) * 40))) : '·';
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

  if (cocoEntries.length === 0) return 'No coco events found. Ensure CocoLogger is wired into Manager (replaces ConsoleLogger).';

  const lines: string[] = [];

  // ── Section 1: Module breakdown ──
  const moduleCounts = new Map<string, { debug: number; info: number; warn: number; error: number }>();
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
    const byMsg = new Map<string, { count: number; level: string; event: string; params: Record<string, unknown> | undefined }>();
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
    for (const [endpoint, count] of [...byEndpoint.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
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
      lines.push(`${formatDelta(delta)} ${levelIcon(e.level)} ${e.event.padEnd(40).slice(0, 40)} ${shortMsg}`);
    }
    lines.push(footer);
  }

  return lines.join('\n');
}

// ─── Mode: network ───────────────────────────────────────────────────────────

function modeNetwork(entries: LogEntry[], opts: Options): string {
  const netEntries = entries.filter((e) =>
    e.event.startsWith('net.') || e.event.startsWith('api.') ||
    e.event.includes('fetch') || e.event.includes('.ws.')
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
    if (prev && prev.event === e.event && JSON.stringify(prev.params) === JSON.stringify(e.params) && prev.level === e.level) {
      prev._count = (prev._count ?? 1) + 1;
    } else {
      deduped.push({ ...e, _count: 1 });
    }
  }

  const saved = entries.length - deduped.length;
  const { page, footer } = paginate(deduped, opts);

  const lines: string[] = [];
  if (saved > 0) {
    lines.push(`// Deduplicated: ${entries.length} entries -> ${deduped.length} (${saved} duplicates removed)`);
  }

  // ── Pipe-delimited markdown format (~40% fewer tokens than JSON) ──
  if (opts.format === 'md') {
    lines.push('_t|Δ|lvl|event|src|params|err');
    let prevT: number | null = null;
    for (const e of page) {
      const t = e._t ?? 0;
      const delta = prevT !== null ? Math.round(t - prevT) : 0;
      prevT = t;
      const lvl = e.level === 'debug' ? 'DBG' : e.level === 'info' ? 'INF' : e.level.slice(0, 3).toUpperCase();
      const deltaStr = delta > 0 ? `+${delta}` : '';
      const params = shortParams(e.params);
      const rep = (e._count ?? 1) > 1 ? ` x${e._count}` : '';
      const err = e.error ? `${e.error.name}:${e.error.message}` : '';
      lines.push(`${Math.round(t)}|${deltaStr}|${lvl}|${e.event}|${shortSrc(e.src)}|${params}${rep}|${err}`);
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
      const sample = currSession.find(e => templateOf(e) === t)!;
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
    countDiffs.sort((a, b) => (b.curr - b.prev) - (a.curr - a.prev));
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
    const hasError = events.some(e => e.level === 'error' || e.level === 'fatal');
    const hasEnd = events.some(e => e.event === 'flow.end');
    const outcome = hasError ? 'ERROR' : hasEnd ? 'COMPLETED' : 'IN-PROGRESS';

    lines.push(`  ${flowId} (${duration}ms, ${outcome})`);

    const startT = first._t ?? 0;
    for (const e of events) {
      const rel = Math.round(((e._t ?? 0) - startT) * 100) / 100;
      const params = shortParams(e.params);
      const err = e.error ? ` ERR:${e.error.name}:${e.error.message}` : '';
      lines.push(`    +${rel}ms  ${levelIcon(e.level)} ${e.event.padEnd(35).slice(0, 35)} ${params}${err}`);
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
  const wsEntries = entries.filter(e =>
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
  const connections = new Map<string, { opens: number; closes: number; errors: number; reconnects: number; lastCode?: number; lastReason?: string }>();
  for (const e of wsEntries) {
    // Match both our ws.* events and coco's ws_error/ws_* events
    const isWsLifecycle = e.event.startsWith('ws.') || e.event.includes('ws_error');
    if (!isWsLifecycle) continue;
    const url = (e.params?.url as string) ?? (e.params?.mintUrl as string) ?? 'unknown';
    const host = extractHost(url);
    if (!connections.has(host)) connections.set(host, { opens: 0, closes: 0, errors: 0, reconnects: 0 });
    const conn = connections.get(host)!;
    if (e.event === 'ws.open') conn.opens++;
    else if (e.event === 'ws.close') { conn.closes++; conn.lastCode = e.params?.code as number; conn.lastReason = e.params?.reason as string; }
    else if (e.event === 'ws.error' || e.event.includes('ws_error')) conn.errors++;
    else if (e.event === 'ws.reconnect') conn.reconnects++;
  }

  if (connections.size > 0) {
    lines.push('WEBSOCKET CONNECTIONS:');
    lines.push('');
    for (const [host, c] of [...connections.entries()].sort((a, b) => b[1].errors - a[1].errors)) {
      const status = c.opens > c.closes ? 'OPEN' : 'CLOSED';
      lines.push(`  ${host}  [${status}]`);
      lines.push(`    opens=${c.opens} closes=${c.closes} errors=${c.errors} reconnects=${c.reconnects}`);
      if (c.lastCode) lines.push(`    last close: code=${c.lastCode} reason="${c.lastReason ?? ''}"`);
    }
    lines.push('');
  }

  // ── Subscription health ──
  const subRequests = wsEntries.filter(e => e.event.includes('subscribe') && !e.event.includes('unsubscribe'));
  const subAccepted = wsEntries.filter(e => e.event.includes('subscribe_request_accepted') || e.event.includes('subscribed_to'));
  const unmatched = wsEntries.filter(e => e.event.includes('unmatched'));
  const queued = wsEntries.filter(e => e.event.includes('queued_message'));

  lines.push('SUBSCRIPTION HEALTH:');
  lines.push(`  Requests:  ${subRequests.length}`);
  lines.push(`  Accepted:  ${subAccepted.length}`);
  if (unmatched.length > 0) lines.push(`  Unmatched: ${unmatched.length}  <- investigate`);
  if (queued.length > 0) lines.push(`  Queued:    ${queued.length} (socket not open at time of send)`);
  lines.push('');

  // ── Message rate by host ──
  const msgByHost = new Map<string, { count: number; firstT: number; lastT: number }>();
  for (const e of wsEntries) {
    if (!e.event.includes('ws_message') && !e.event.includes('ws.rate')) continue;
    const url = (e.params?.mintUrl as string) ?? (e.params?.url as string) ?? 'unknown';
    const host = extractHost(url);
    const t = e._t ?? 0;
    const existing = msgByHost.get(host);
    if (existing) { existing.count++; existing.lastT = t; }
    else msgByHost.set(host, { count: 1, firstT: t, lastT: t });
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
  const hermesEntries = entries.filter(e => e.event === 'perf.hermes');
  const threadEntries = entries.filter(e => e.event === 'perf.js_thread.blocked');

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
      lines.push(`  T+${(t / 1000).toFixed(0)}s  ${heapMB} MB  (${sign}${deltaMB} MB)  GC: ${gcDelta}${alert}`);

      prevHeap = heap;
      prevGCs = gcs;
    }
    lines.push('');

    // Leak detection: check if heap is monotonically increasing
    const heapValues = hermesEntries.map(e => (e.params?.heapSize as number) ?? 0);
    let monotonic = true;
    for (let i = 1; i < heapValues.length; i++) {
      if (heapValues[i] < heapValues[i - 1] * 0.95) { monotonic = false; break; }
    }
    if (monotonic && heapValues.length >= 3) {
      const growth = heapValues[heapValues.length - 1] - heapValues[0];
      lines.push(`LEAK DETECTED: heap grew monotonically by ${(growth / (1024 * 1024)).toFixed(1)} MB over ${hermesEntries.length} samples`);
      lines.push('');
    }
  }

  if (threadEntries.length > 0) {
    lines.push(`JS THREAD BLOCKS (${threadEntries.length} detected):`);
    lines.push('');
    threadEntries.sort((a, b) => ((b.params?.drift_ms as number) ?? 0) - ((a.params?.drift_ms as number) ?? 0));
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
      const nearby = entries.filter(e => {
        const t = e._t ?? 0;
        return t >= worstT - 500 && t <= worstT + 100 && e !== worst;
      }).slice(0, 5);
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
    if (r.tokens < 0) { lines.push(`  ${r.name.padEnd(18)} ERROR`); continue; }
    const bar = '█'.repeat(Math.max(1, Math.round((r.tokens / Math.max(...results.map(x => x.tokens))) * 40)));
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
    const fits = results.filter(r => r.tokens > 0 && r.tokens <= budget).map(r => r.name);
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

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
  const opts = parseArgs(process.argv);

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
    console.error('Modes: stats, timeline, errors, slow, renders, screens, startup, coco, network, full, diff, flows, ws, gc, budget');
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
    case 'stats': output = modeStats(entries, opts); break;
    case 'timeline': output = modeTimeline(entries, opts); break;
    case 'errors': output = modeErrors(entries, opts); break;
    case 'slow': output = modeSlow(entries, opts); break;
    case 'renders': output = modeRenders(entries, opts); break;
    case 'screens': output = modeScreens(entries, opts); break;
    case 'startup': output = modeStartup(entries, opts); break;
    case 'coco': output = modeCoco(entries, opts); break;
    case 'network': output = modeNetwork(entries, opts); break;
    case 'full': output = modeFull(entries, opts); break;
    case 'flows': output = modeFlows(entries, opts); break;
    case 'ws': output = modeWS(entries, opts); break;
    case 'gc': output = modeGC(entries, opts); break;
    case 'budget': output = modeBudget(entries, opts); break;
    default:
      console.error(`Unknown mode: ${opts.mode}`);
      console.error('Valid modes: stats, timeline, errors, slow, renders, screens, startup, coco, network, full, diff, flows, ws, gc, budget');
      process.exit(1);
  }

  // Apply token budget if specified
  if (opts.tokenBudget !== null) {
    output = applyTokenBudget(output, opts.tokenBudget);
  }

  console.log(output);
}

main();
