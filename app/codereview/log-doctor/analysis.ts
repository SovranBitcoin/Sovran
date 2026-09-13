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

export interface ReadRun {
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

export interface BlankFlash {
  surface: string;
  keyHash: string;
  /** `_t` of the populated→skeleton dip. */
  t: number;
  /** ms until the same key was populated again. */
  gapMs: number;
}

export interface ReadsAnalysis {
  runs: ReadRun[];
  blankFlashes: BlankFlash[];
}

const READ_EVENT = /^read\.([^.]+)\.(request|done|failed|superseded|partial|merged|applied|render)$/;
const NOSTR_READ_DONE = /^nostr\.read\.[^.]+\.done$/;
/** A dip longer than this is a real reload, not a flash. */
export const BLANK_FLASH_MAX_MS = 2_000;

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
          if (gapMs <= BLANK_FLASH_MAX_MS) blankFlashes.push({ surface, keyHash, t: prev.dippedAt, gapMs });
          lastPhase.set(slot, { phase, dippedAt: null });
        } else {
          lastPhase.set(slot, { phase, dippedAt: phase === 'populated' ? null : (prev?.dippedAt ?? null) });
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
        if (Array.isArray(params.sources)) for (const s of params.sources) run.sources.add(String(s));
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
    if (readId && (entry.event === 'nostr.tier.aggregate.merged' || NOSTR_READ_DONE.test(entry.event))) {
      const run = runs.get(readId);
      if (run && typeof params.tier === 'string') run.sources.add(params.tier);
    }
  }

  return { runs: [...runs.values()], blankFlashes };
}

export interface ReadSurfaceSummary {
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
    if (run.cached && !run.stale && run.action === 'fetch' && run.trigger !== 'user' && run.trigger !== 'poll') {
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
