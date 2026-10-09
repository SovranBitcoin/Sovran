// Pure, dependency-free deterministic log analysis for log-doctor.
//
// Kept separate from index.ts (the CLI entrypoint, which pulls in WDA +
// test-dsl) so these functions can be unit-tested in isolation without loading
// the whole tool. The index.ts modes consume them. Everything here is a pure
// function of its inputs — no I/O, no globals — which is what makes
// __tests__/analysis.test.ts cheap and deterministic.

/** The structural subset of a log entry the analysis needs. index.ts's
 *  richer LogEntry is assignable to this. */
export interface AnalyzableEntry {
  level: string;
  event: string;
  _t?: number;
  params?: Record<string, unknown>;
  ctx?: Record<string, unknown>;
  error?: { name: string; message: string; stack: string[] };
}

// ─── Percentiles, distribution summary, sparkline ────────────────────────────

function percentileSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (p <= 0) return sorted[0];
  if (p >= 100) return sorted[sorted.length - 1];
  // Nearest-rank: simple, exact, no interpolation surprises.
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

/** Nearest-rank percentile over an unsorted sample. */
export function percentile(samples: number[], p: number): number {
  return percentileSorted(
    [...samples].sort((a, b) => a - b),
    p
  );
}

interface DurationSummary {
  count: number;
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
}

export function summarizeDurations(samples: number[]): DurationSummary {
  if (samples.length === 0) return { count: 0, min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: sum / sorted.length,
    p50: percentileSorted(sorted, 50),
    p95: percentileSorted(sorted, 95),
    p99: percentileSorted(sorted, 99),
  };
}

const SPARK_BLOCKS = '▁▂▃▄▅▆▇█';

/** Compact, token-cheap distribution of `samples` across `buckets` linear bins,
 *  with a min–max legend. Returns '' for an empty sample. */
export function sparkline(samples: number[], buckets = 8): string {
  if (samples.length === 0) return '';
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  if (max === min) return `${SPARK_BLOCKS[0].repeat(buckets)} (all ${min.toFixed(0)}ms)`;
  const counts = new Array<number>(buckets).fill(0);
  for (const s of samples) {
    const idx = Math.min(buckets - 1, Math.floor(((s - min) / (max - min)) * buckets));
    counts[idx]++;
  }
  const maxCount = Math.max(...counts);
  const spark = counts
    .map((c) => SPARK_BLOCKS[Math.round((c / maxCount) * (SPARK_BLOCKS.length - 1))])
    .join('');
  return `${spark} (${min.toFixed(0)}–${max.toFixed(0)}ms)`;
}

// ─── Error clustering ────────────────────────────────────────────────────────

const URL_RE = /\bhttps?:\/\/[^\s"]+/gi;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const HEX_RE = /\b[0-9a-f]{8,}\b/gi;
const NUM_RE = /\b\d[\d.,_]*\b/g;

/** Collapse the varying parts of a string (urls, uuids, long hex, numbers) so
 *  that two errors differing only by ids/amounts share a normalized form. */
export function normalizeErrorText(value: unknown): string {
  let s = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  // Order matters: url, then uuid (before bare hex eats its segments), then hex, then numbers.
  s = s
    .replace(URL_RE, '<url>')
    .replace(UUID_RE, '<uuid>')
    .replace(HEX_RE, '<hex>')
    .replace(NUM_RE, '<n>');
  return s.slice(0, 200);
}

/** Normalize params into a deterministic template: sorted keys (so serialization
 *  order can't split a cluster), underscore-prefixed keys dropped, values
 *  collapsed via normalizeErrorText. */
function normalizeParams(params: Record<string, unknown> | undefined): string {
  if (!params) return '';
  return Object.keys(params)
    .filter((k) => !k.startsWith('_'))
    .sort()
    .map((k) => `${k}=${normalizeErrorText(params[k])}`)
    .join('&');
}

function topStackFrame(entry: AnalyzableEntry): string {
  const frame = entry.error?.stack?.[0];
  return frame ? normalizeErrorText(frame) : '';
}

/** The stable identity an error clusters by: level + event + error name +
 *  normalized message + normalized params + normalized top stack frame. */
export function errorClusterKey(entry: AnalyzableEntry): string {
  return [
    entry.level,
    entry.event,
    entry.error?.name ?? '',
    normalizeErrorText(entry.error?.message ?? ''),
    normalizeParams(entry.params),
    topStackFrame(entry),
  ].join('|');
}

interface ErrorCluster<T> {
  key: string;
  count: number;
  exemplar: T;
  exemplarIndex: number;
  firstT: number;
  lastT: number;
}

/** Group error entries by errorClusterKey, keeping the first-seen entry as the
 *  exemplar. Sorted by count desc, then earliest occurrence. */
export function clusterErrorEntries<T extends AnalyzableEntry>(
  items: Array<{ entry: T; index: number }>
): ErrorCluster<T>[] {
  const map = new Map<string, ErrorCluster<T>>();
  for (const { entry, index } of items) {
    const key = errorClusterKey(entry);
    const t = entry._t ?? 0;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { key, count: 1, exemplar: entry, exemplarIndex: index, firstT: t, lastT: t });
    } else {
      existing.count++;
      existing.firstT = Math.min(existing.firstT, t);
      existing.lastT = Math.max(existing.lastT, t);
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.firstT - b.firstT);
}

// ─── Redaction audit (read-side) ─────────────────────────────────────────────

interface SuspiciousPattern {
  category: string;
  re: RegExp;
  /** true = almost certainly a secret/PII that should have been redacted;
   *  false = usually a PUBLIC id (npub/event/pubkey hash) — low signal. */
  highSignal: boolean;
}

const SUSPICIOUS_PATTERNS: SuspiciousPattern[] = [
  { category: 'nsec', re: /\bnsec1[0-9a-z]{20,}\b/i, highSignal: true },
  { category: 'xprv', re: /\bxprv[0-9a-zA-Z]{20,}\b/, highSignal: true },
  { category: 'cashu-token', re: /\bcashu[AB][A-Za-z0-9_-]{20,}\b/, highSignal: true },
  {
    category: 'jwt',
    re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
    highSignal: true,
  },
  {
    category: 'email',
    re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
    highSignal: true,
  },
  { category: 'npub', re: /\bnpub1[0-9a-z]{20,}\b/i, highSignal: false },
  { category: 'note', re: /\bnote1[0-9a-z]{20,}\b/i, highSignal: false },
  { category: 'hex64', re: /\b[0-9a-f]{64}\b/i, highSignal: false },
];

const REDACTED_SUBSTR_RE = /<REDACTED:([^>]+)>/g;
const MAX_DEPTH = 8;

interface SuspiciousFinding {
  category: string;
  count: number;
  highSignal: boolean;
  sampleEvents: string[];
}

export interface RedactionAudit {
  /** {_kind} brand objects the logger emits for stripped secrets, by kind. */
  brandCounts: Record<string, number>;
  /** Inline <REDACTED:label> substrings, by label. */
  redactedSubstrCounts: Record<string, number>;
  /** brandCounts + redactedSubstrCounts totals — confirmed redactions. */
  totalRedactions: number;
  /** Raw values that look UN-redacted (heuristic). Never includes the values. */
  suspicious: SuspiciousFinding[];
}

/** Scan already-parsed (already-redacted) entries: count confirmed redactions
 *  and heuristically flag any raw values that look like un-redacted secrets/PII.
 *  Pure and read-only — it changes nothing about how the app logs. */
export function scanRedactionAudit(entries: AnalyzableEntry[]): RedactionAudit {
  const brandCounts: Record<string, number> = {};
  const redactedSubstrCounts: Record<string, number> = {};
  const suspMap = new Map<string, { count: number; events: Set<string>; highSignal: boolean }>();

  const note = (pattern: SuspiciousPattern, event: string): void => {
    let s = suspMap.get(pattern.category);
    if (!s) {
      s = { count: 0, events: new Set(), highSignal: pattern.highSignal };
      suspMap.set(pattern.category, s);
    }
    s.count++;
    if (s.events.size < 5) s.events.add(event);
  };

  const walk = (value: unknown, event: string, depth: number): void => {
    if (value == null || depth > MAX_DEPTH) return;
    if (typeof value === 'string') {
      let m: RegExpExecArray | null;
      REDACTED_SUBSTR_RE.lastIndex = 0;
      while ((m = REDACTED_SUBSTR_RE.exec(value)) !== null) {
        redactedSubstrCounts[m[1]] = (redactedSubstrCounts[m[1]] ?? 0) + 1;
      }
      for (const pattern of SUSPICIOUS_PATTERNS) {
        if (pattern.re.test(value)) note(pattern, event);
      }
      return;
    }
    if (typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const v of value) walk(v, event, depth + 1);
      return;
    }
    const obj = value as Record<string, unknown>;
    // A {_kind: ...} brand means the logger already stripped the value — count
    // it and stop; the raw secret is gone, so don't recurse or flag.
    if (typeof obj._kind === 'string') {
      brandCounts[obj._kind] = (brandCounts[obj._kind] ?? 0) + 1;
      return;
    }
    for (const v of Object.values(obj)) walk(v, event, depth + 1);
  };

  for (const e of entries) {
    walk(e.params, e.event, 0);
    walk(e.ctx, e.event, 0);
    if (e.error) {
      walk(e.error.message, e.event, 0);
      walk(e.error.stack, e.event, 0);
    }
  }

  const totalBrands = Object.values(brandCounts).reduce((a, b) => a + b, 0);
  const totalSubstr = Object.values(redactedSubstrCounts).reduce((a, b) => a + b, 0);
  const suspicious: SuspiciousFinding[] = [...suspMap.entries()]
    .map(([category, s]) => ({
      category,
      count: s.count,
      highSignal: s.highSignal,
      sampleEvents: [...s.events],
    }))
    .sort((a, b) => Number(b.highSignal) - Number(a.highSignal) || b.count - a.count);

  return {
    brandCounts,
    redactedSubstrCounts,
    totalRedactions: totalBrands + totalSubstr,
    suspicious,
  };
}

// ─── Read lifecycle (reads mode) ─────────────────────────────────────────────
// Joins `read.<surface>.*` (hook/screen), `query_cache.run.*` (store) and
// `nostr.read.<surface>.done` / `nostr.tier.aggregate.merged` (facade) on
// `params.readId`. Per surface: cache-hit rate, refetch-while-fresh, TTFUD,
// superseded writes, blank flashes, and which tiers filled the data.

interface ReadRun {
  readId: string;
  surface: string;
  keyHash: string;
  tRequest: number;
  action: string | null;
  trigger: string | null;
  cached: boolean;
  stale: boolean;
  tDone: number | null;
  ok: boolean | null;
  superseded: boolean;
  partial: boolean;
  degraded: boolean;
  /** `read.request` → first `read.render{phase:'populated'}` with the same readId. */
  firstPopulatedT: number | null;
  sources: Set<string>;
}

interface BlankFlash {
  surface: string;
  keyHash: string;
  /** `_t` of the populated→skeleton dip. */
  t: number;
  /** ms until the same key was populated again. */
  gapMs: number;
}

interface ReadsAnalysis {
  runs: ReadRun[];
  blankFlashes: BlankFlash[];
}

const READ_EVENT =
  /^read\.([^.]+)\.(request|done|failed|superseded|partial|merged|applied|render)$/;
const NOSTR_READ_DONE = /^nostr\.read\.[^.]+\.done$/;
/** A dip longer than this is a real reload, not a flash. */
const BLANK_FLASH_MAX_MS = 2_000;

export function analyzeReads(entries: AnalyzableEntry[]): ReadsAnalysis {
  const runs = new Map<string, ReadRun>();
  // Per (surface|keyHash): last render phase, for populated→skeleton→populated.
  const lastPhase = new Map<string, { phase: string; dippedAt: number | null }>();
  const blankFlashes: BlankFlash[] = [];

  for (const entry of entries) {
    if (typeof entry._t !== 'number') continue;
    const params = entry.params ?? {};
    const readId = typeof params.readId === 'string' ? params.readId : null;

    const m = READ_EVENT.exec(entry.event);
    if (m) {
      const surface = m[1]!;
      const kind = m[2]!;
      const keyHash = typeof params.keyHash === 'string' ? params.keyHash : '?';
      if (kind === 'render') {
        const phase = String(params.phase);
        const slot = `${surface}|${keyHash}`;
        const prev = lastPhase.get(slot);
        if (prev?.phase === 'populated' && phase === 'skeleton') {
          lastPhase.set(slot, { phase, dippedAt: entry._t });
        } else if (prev?.dippedAt != null && phase === 'populated') {
          const gapMs = entry._t - prev.dippedAt;
          if (gapMs <= BLANK_FLASH_MAX_MS)
            blankFlashes.push({ surface, keyHash, t: prev.dippedAt, gapMs });
          lastPhase.set(slot, { phase, dippedAt: null });
        } else {
          lastPhase.set(slot, {
            phase,
            dippedAt: phase === 'populated' ? null : (prev?.dippedAt ?? null),
          });
        }
        if (phase === 'populated' && readId) {
          const run = runs.get(readId);
          if (run && run.firstPopulatedT === null) run.firstPopulatedT = entry._t;
        }
        continue;
      }
      if (!readId) continue;
      if (kind === 'request') {
        runs.set(readId, {
          readId,
          surface,
          keyHash,
          tRequest: entry._t,
          action: typeof params.action === 'string' ? params.action : null,
          trigger: typeof params.trigger === 'string' ? params.trigger : null,
          cached: params.cached === true,
          stale: params.stale === true,
          tDone: null,
          ok: null,
          superseded: false,
          partial: false,
          degraded: false,
          firstPopulatedT: null,
          sources: new Set(),
        });
        continue;
      }
      const run = runs.get(readId);
      if (!run) continue;
      if (kind === 'done') {
        run.tDone = entry._t;
        run.ok = true;
        run.degraded = params.degraded === true;
        if (Array.isArray(params.sources))
          for (const s of params.sources) run.sources.add(String(s));
        if (typeof params.tier === 'string') run.sources.add(params.tier);
      } else if (kind === 'failed') {
        run.tDone = entry._t;
        run.ok = false;
      } else if (kind === 'superseded') {
        run.superseded = true;
        run.tDone = entry._t;
      } else if (kind === 'partial') {
        run.partial = true;
      } else if (kind === 'merged' && typeof params.tier === 'string') {
        run.sources.add(params.tier);
      }
      continue;
    }

    // Facade-side fills carry the same readId.
    if (
      readId &&
      (entry.event === 'nostr.tier.aggregate.merged' || NOSTR_READ_DONE.test(entry.event))
    ) {
      const run = runs.get(readId);
      if (run && typeof params.tier === 'string') run.sources.add(params.tier);
    }
  }

  return { runs: [...runs.values()], blankFlashes };
}

interface ReadSurfaceSummary {
  surface: string;
  reads: number;
  cacheHit: number;
  serveFresh: number;
  staleRevalidate: number;
  /** A fetch issued while a fresh entry existed without a user/poll trigger — the unnecessary refetch. */
  refetchFresh: number;
  failed: number;
  superseded: number;
  partial: number;
  degraded: number;
  ttfudMs: number[];
  sources: Map<string, number>;
}

export function summarizeReads(runs: ReadRun[]): ReadSurfaceSummary[] {
  const bySurface = new Map<string, ReadSurfaceSummary>();
  for (const run of runs) {
    let s = bySurface.get(run.surface);
    if (!s) {
      s = {
        surface: run.surface,
        reads: 0,
        cacheHit: 0,
        serveFresh: 0,
        staleRevalidate: 0,
        refetchFresh: 0,
        failed: 0,
        superseded: 0,
        partial: 0,
        degraded: 0,
        ttfudMs: [],
        sources: new Map(),
      };
      bySurface.set(run.surface, s);
    }
    s.reads += 1;
    if (run.cached) s.cacheHit += 1;
    if (run.action === 'serve-fresh') s.serveFresh += 1;
    if (run.action === 'serve-stale-revalidate') s.staleRevalidate += 1;
    if (
      run.cached &&
      !run.stale &&
      run.action === 'fetch' &&
      run.trigger !== 'user' &&
      run.trigger !== 'poll'
    ) {
      s.refetchFresh += 1;
    }
    if (run.ok === false) s.failed += 1;
    if (run.superseded) s.superseded += 1;
    if (run.partial) s.partial += 1;
    if (run.degraded) s.degraded += 1;
    if (run.firstPopulatedT !== null) s.ttfudMs.push(run.firstPopulatedT - run.tRequest);
    for (const source of run.sources) s.sources.set(source, (s.sources.get(source) ?? 0) + 1);
  }
  return [...bySurface.values()].sort((a, b) => b.reads - a.reads);
}

function numberParam(params: Record<string, unknown>, key: string): number {
  const value = params[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// ─── Ingest fan-out (`ingest` mode) ──────────────────────────────────────────
// One `cache.store.write` per entity-cache write batch (nostr/src/facade/cache/
// store.ts): keys written, keys whose record actually changed, and how many
// listeners that woke. Rolled up per store.

interface IngestStoreSummary {
  store: string;
  /** Write batches seen. */
  batches: number;
  /** Batches that changed nothing — every key was an idempotent re-write. */
  noopBatches: number;
  written: number;
  changed: number;
  /** `written - changed`: keys ingested again with nothing new. */
  wasted: number;
  keyListenersNotified: number;
  globalListenersNotified: number;
  /** Listeners woken per changed key (key + global), 0 when nothing changed. */
  fanOut: number;
}

interface IngestAnalysis {
  stores: IngestStoreSummary[];
  /** The same stores, most wasted writes first. */
  byWasted: IngestStoreSummary[];
  /** The same stores, highest fan-out first. */
  byFanOut: IngestStoreSummary[];
}

export function analyzeIngest(entries: AnalyzableEntry[]): IngestAnalysis {
  const byStore = new Map<string, IngestStoreSummary>();
  for (const entry of entries) {
    if (entry.event !== 'cache.store.write') continue;
    const params = entry.params ?? {};
    const store = typeof params.store === 'string' ? params.store : '?';
    let summary = byStore.get(store);
    if (!summary) {
      summary = {
        store,
        batches: 0,
        noopBatches: 0,
        written: 0,
        changed: 0,
        wasted: 0,
        keyListenersNotified: 0,
        globalListenersNotified: 0,
        fanOut: 0,
      };
      byStore.set(store, summary);
    }
    const written = numberParam(params, 'written');
    const changed = numberParam(params, 'changed');
    summary.batches += 1;
    if (changed === 0) summary.noopBatches += 1;
    summary.written += written;
    summary.changed += changed;
    summary.wasted += Math.max(0, written - changed);
    summary.keyListenersNotified += numberParam(params, 'keyListenersNotified');
    summary.globalListenersNotified += numberParam(params, 'globalListenersNotified');
  }
  const stores = [...byStore.values()];
  for (const summary of stores) {
    const notified = summary.keyListenersNotified + summary.globalListenersNotified;
    summary.fanOut = summary.changed > 0 ? notified / summary.changed : 0;
  }
  // Ties fall back to the store name so the ranking is stable across runs.
  const byName = (a: IngestStoreSummary, b: IngestStoreSummary) => a.store.localeCompare(b.store);
  return {
    stores,
    byWasted: [...stores].sort((a, b) => b.wasted - a.wasted || byName(a, b)),
    byFanOut: [...stores].sort((a, b) => b.fanOut - a.fanOut || byName(a, b)),
  };
}

// ─── Zustand store writes (`stores` mode) ────────────────────────────────────
// One `store.set` per write to a store declared through defineStore
// (app/shared/lib/persist/defineStore.ts): the top-level keys whose value
// changed and how many subscribers zustand notified. Rolled up per store.

interface StoreWriteSummary {
  store: string;
  scope: string;
  writes: number;
  /** Writes that changed no top-level key. */
  noopWrites: number;
  /** No-op writes that still notified subscribers, because the state object was new. */
  noopNotifying: number;
  /** Sum of subscribers notified across all writes. */
  subscribersNotified: number;
  /** Most-written top-level keys, most frequent first. */
  topKeys: { key: string; writes: number }[];
}

interface StoreWriteAnalysis {
  stores: StoreWriteSummary[];
  /** The same stores, most writes first. */
  byWrites: StoreWriteSummary[];
  /** Only stores with a no-op write, most no-op writes first. */
  byNoop: StoreWriteSummary[];
}

/** The logger truncates long arrays with a trailing `…N more` marker. */
const TRUNCATION_MARKER = /^…\d+ more$/;

/** `changed` from a `store.set` entry, or null when the entry carries none. */
function changedKeysParam(params: Record<string, unknown>): string[] | null {
  if (!Array.isArray(params.changed)) return null;
  return params.changed.filter(
    (key): key is string => typeof key === 'string' && !TRUNCATION_MARKER.test(key)
  );
}

export function analyzeStoreWrites(entries: AnalyzableEntry[]): StoreWriteAnalysis {
  const byStore = new Map<string, StoreWriteSummary>();
  const keyCounts = new Map<string, Map<string, number>>();
  for (const entry of entries) {
    if (entry.event !== 'store.set') continue;
    const params = entry.params ?? {};
    const store = typeof params.store === 'string' ? params.store : '?';
    let summary = byStore.get(store);
    if (!summary) {
      summary = {
        store,
        scope: typeof params.scope === 'string' ? params.scope : '?',
        writes: 0,
        noopWrites: 0,
        noopNotifying: 0,
        subscribersNotified: 0,
        topKeys: [],
      };
      byStore.set(store, summary);
      keyCounts.set(store, new Map());
    }
    const changed = changedKeysParam(params);
    const subscribers = numberParam(params, 'subscribers');
    summary.writes += 1;
    summary.subscribersNotified += subscribers;
    if (changed?.length === 0) {
      summary.noopWrites += 1;
      if (subscribers > 0) summary.noopNotifying += 1;
    }
    const counts = keyCounts.get(store)!;
    for (const key of changed ?? []) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const stores = [...byStore.values()];
  for (const summary of stores) {
    summary.topKeys = [...keyCounts.get(summary.store)!]
      .map(([key, writes]) => ({ key, writes }))
      .sort((a, b) => b.writes - a.writes || a.key.localeCompare(b.key))
      .slice(0, 3);
  }
  // Ties fall back to the store name so the ranking is stable across runs.
  const byName = (a: StoreWriteSummary, b: StoreWriteSummary) => a.store.localeCompare(b.store);
  return {
    stores,
    byWrites: [...stores].sort((a, b) => b.writes - a.writes || byName(a, b)),
    byNoop: stores
      .filter((summary) => summary.noopWrites > 0)
      .sort((a, b) => b.noopWrites - a.noopWrites || byName(a, b)),
  };
}

// ─── Per-page scorecard (`pages` mode) ───────────────────────────────────────
// Keyed by the `Screen` name (app/shared/lib/loggerScreen.ts). A page becomes
// current when its Screen logs `nav.transition` or `screen.mount`, and stays
// current until another does; frame drops, coco calls and store writes are
// charged to it.
// A back or pop mounts nothing, so time on a revealed page is charged to the
// page that was left — read those two columns as "since this page mounted".

interface PageSummary {
  screen: string;
  mounts: number;
  /** `screen.mount` `content_ms`: first render → deferred content committed. */
  mountMs: number[];
  /** `screen.mount` `shell_ms`: first render → first commit. */
  shellMs: number[];
  /** `nav.transition` `duration_ms`: route change dispatched → first commit. */
  navMs: number[];
  /** `render.why` entries for `Screen(<name>)` or a hook keyed by the bare name. */
  renderWhy: number;
  frameDropReports: number;
  droppedFrames: number;
  cocoCalls: number;
  cocoMs: number;
  /** `store.set` entries logged while this page was current. */
  storeWrites: number;
  /** Of those, the writes that changed no top-level key. */
  storeNoopWrites: number;
}

const SCREEN_RENDER_KEY = /^Screen\((.+)\)$/;

export function analyzePages(entries: AnalyzableEntry[]): PageSummary[] {
  const byScreen = new Map<string, PageSummary>();
  const page = (screen: string): PageSummary => {
    let summary = byScreen.get(screen);
    if (!summary) {
      summary = {
        screen,
        mounts: 0,
        mountMs: [],
        shellMs: [],
        navMs: [],
        renderWhy: 0,
        frameDropReports: 0,
        droppedFrames: 0,
        cocoCalls: 0,
        cocoMs: 0,
        storeWrites: 0,
        storeNoopWrites: 0,
      };
      byScreen.set(screen, summary);
    }
    return summary;
  };

  // render.why is keyed by component, so it can arrive before the screen's own
  // mount event names it; hold those counts until the screen is known.
  const renderWhyByComponent = new Map<string, number>();
  let current: string | null = null;

  for (const entry of entries) {
    const params = entry.params ?? {};
    const screen = typeof params.screen === 'string' ? params.screen : null;
    if (entry.event === 'nav.transition' && screen) {
      current = screen;
      const summary = page(screen);
      if (typeof params.duration_ms === 'number') summary.navMs.push(params.duration_ms);
    } else if (entry.event === 'screen.mount' && screen) {
      current = screen;
      const summary = page(screen);
      summary.mounts += 1;
      if (typeof params.content_ms === 'number') summary.mountMs.push(params.content_ms);
      if (typeof params.shell_ms === 'number') summary.shellMs.push(params.shell_ms);
    } else if (entry.event === 'render.why' && typeof params.component === 'string') {
      const name = SCREEN_RENDER_KEY.exec(params.component)?.[1] ?? params.component;
      renderWhyByComponent.set(name, (renderWhyByComponent.get(name) ?? 0) + 1);
    } else if (entry.event === 'perf.frame_drop' && current) {
      const summary = page(current);
      summary.frameDropReports += 1;
      summary.droppedFrames += numberParam(params, 'dropped');
    } else if (entry.event === 'coco.call' && current) {
      const summary = page(current);
      summary.cocoCalls += 1;
      summary.cocoMs += numberParam(params, 'duration_ms');
    } else if (entry.event === 'store.set' && current) {
      const summary = page(current);
      summary.storeWrites += 1;
      if (changedKeysParam(params)?.length === 0) summary.storeNoopWrites += 1;
    }
  }

  for (const summary of byScreen.values()) {
    summary.renderWhy = renderWhyByComponent.get(summary.screen) ?? 0;
  }
  return [...byScreen.values()].sort((a, b) => a.screen.localeCompare(b.screen));
}

// ─── Avatar flicker guard (`avatars` mode) ───────────────────────────────────
// `visual.avatar.sequence` (app/shared/ui/primitives/Avatar.tsx) logs each
// branch an avatar instance shows for a seed. loading → fallback → image is the
// flicker: the placeholder gave way to the seeded gradient, and only then to
// the picture that was coming all along.

interface AvatarFlicker {
  seed: string;
  instance: string;
  /** `_t` of the entry that completed the sequence, when the log carries one. */
  t: number | null;
}

interface AvatarAnalysis {
  /** Distinct seeds seen. */
  seeds: number;
  /** Distinct avatar instance + seed pairs seen. */
  sequences: number;
  /** Entries with no readable seed or branch, which cannot be checked. */
  unreadable: number;
  flickers: AvatarFlicker[];
}

const AVATAR_FLICKER = ['loading', 'fallback', 'image'] as const;

export function analyzeAvatarSequences(entries: AnalyzableEntry[]): AvatarAnalysis {
  // Per instance + seed: the last branches shown, newest last.
  const recent = new Map<string, string[]>();
  const seeds = new Set<string>();
  const flickers: AvatarFlicker[] = [];
  let unreadable = 0;

  for (const entry of entries) {
    if (entry.event !== 'visual.avatar.sequence') continue;
    const params = entry.params ?? {};
    if (typeof params.subject !== 'string' || typeof params.branch !== 'string') {
      unreadable += 1;
      continue;
    }
    const seed = params.subject;
    const instance = typeof params.instance === 'string' ? params.instance : '';
    seeds.add(seed);
    // A recycled cell reuses its instance for another seed; that is a new sequence.
    const slot = `${instance}\u0000${seed}`;
    const branches = recent.get(slot) ?? [];
    if (branches[branches.length - 1] === params.branch) continue;
    branches.push(params.branch);
    if (branches.length > AVATAR_FLICKER.length) branches.shift();
    recent.set(slot, branches);
    if (AVATAR_FLICKER.every((branch, index) => branches[index] === branch)) {
      flickers.push({ seed, instance, t: typeof entry._t === 'number' ? entry._t : null });
    }
  }

  return { seeds: seeds.size, sequences: recent.size, unreadable, flickers };
}
