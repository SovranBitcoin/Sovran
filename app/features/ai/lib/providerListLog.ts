import { aiLog } from '@/shared/lib/logger';

/**
 * @fileoverview What the AI provider list is actually showing, pass by pass.
 *
 * The list is fed by three sources that arrive at three different times — the
 * persisted nagg directory (frame one), this device's own probe sweep and
 * relay discovery (seconds), and each row's Nostr profile (its own request per
 * row) — and every one of them writes into the same two zustand stores that
 * the list re-derives itself from. So "the rows keep changing" is a claim
 * about a sequence, and no single render can be inspected to settle it.
 *
 * This records the sequence. Each row paints ONE LINE describing what the user
 * can see plus where each field came from, the lines are coalesced per render
 * burst, and a burst is logged only as its diff against the previous one. What
 * that buys:
 *
 *   - A burst that changes nothing prints `changed: 0` with a non-zero
 *     `paints` — which is the definition of a wasted re-render, stated rather
 *     than inferred from a flicker.
 *   - A field that arrives late prints exactly once, in the burst it arrived
 *     in, with `sinceOpenMs` saying how long the user looked at the old value.
 *   - A name replaced by a hostname is `tSrc` flipping `name` → `host`, which
 *     distinguishes it from the same row merely MOVING under a reorder — the
 *     two are indistinguishable on screen and have unrelated causes.
 *
 * Diagnostic only: nothing here is read back by the app, and every entry is
 * dropped when the logger's level would drop it.
 *
 * ## Why lines and not objects
 *
 * The shared logger compacts arrays to 5 items, objects to 15 keys and strings
 * to 120 characters. A list of 30 rows logged the obvious way loses 25 of them
 * silently. So a row is one short string inside a nested bucket of 15, which
 * is the largest faithful shape that fits — and `fmt` ships with the first
 * pass so the line format is readable without this file.
 */

/** The logger's own per-string budget, minus room for the ellipsis. */
const MAX_LINE = 118;
/** The logger's `maxObjectKeys`. Buckets are sized to it exactly. */
const BUCKET = 15;
/** 15 x 12 = 180 rows, comfortably past nagg's 256-row cap after the store's
 *  own 160-row bound has taken its cut. */
const MAX_BUCKETS = 12;

/** Long enough to swallow a render plus the row paints it causes, short enough
 *  that two genuinely separate arrivals do not merge into one entry. */
const BURST_MS = 150;
/** A list that re-renders continuously would otherwise never flush. */
const MAX_BURST_MS = 800;

/** Where a row's displayed status came from, in the order the row hook asks. */
export type StatusSource = 'probe' | 'cache' | 'directory' | 'none';

interface RowPaint {
  baseUrl: string;
  /** The title as rendered. */
  title: string;
  /** True when that title is the provider's own hostname rather than a name it
   *  published. The store manufactures a hostname when it has no name, so this
   *  cannot be recovered downstream by testing the title for emptiness. */
  titleIsHost: boolean;
  /** The operator name under "Run by", or `null` when the row has no pubkey. */
  runBy: string | null;
  /** True when `runBy` came from a loaded profile rather than the deterministic
   *  word pair every pubkey has before its profile lands. */
  runByFromProfile: boolean;
  profileLoading: boolean;
  status: 'online' | 'offline' | 'unknown';
  statusSource: StatusSource;
  followers: number | null;
  /** True when the count is the row's own profile rather than nagg's stand-in. */
  followersFromProfile: boolean;
  modelCount: number | null;
  encryptedModelCount: number | null;
  spendableSats: number;
  /** The row's disabled reason, or `null` when it can be chosen. */
  blocked: string | null;
}

interface ListRender {
  /** Row order as rendered, top to bottom. */
  order: readonly string[];
  /**
   * Identities of the inputs this render read. Any value works — they are
   * compared with `Object.is` and never inspected — so passing the actual
   * object a selector returned is what makes a reference-identity change
   * visible. That is the failure mode being hunted: a store that hands back a
   * new object for an unchanged fact re-renders every row for nothing.
   */
  inputs: Record<string, unknown>;
}

interface Viewing {
  openedAt: number;
  pass: number;
  /** Lines from the last flushed pass, keyed by provider. */
  lines: Map<string, string>;
  order: string[];
  /** Lines painted since the last flush. */
  pending: Map<string, string>;
  pendingOrder: string[] | null;
  renders: number;
  paints: number;
  causes: Set<string>;
  inputs: Record<string, unknown>;
  firstUnflushedAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

let viewing: Viewing | null = null;

function enabled(): boolean {
  return aiLog.isLevelEnabled('info');
}

/** Start recording. Called when the list mounts; safe to call again. */
export function openProviderListLog(): void {
  if (!enabled()) return;
  viewing = {
    openedAt: Date.now(),
    pass: 0,
    lines: new Map(),
    order: [],
    pending: new Map(),
    pendingOrder: null,
    renders: 0,
    paints: 0,
    causes: new Set(),
    inputs: {},
    firstUnflushedAt: 0,
    timer: null,
  };
}

/** Stop recording and emit whatever the last burst had. */
export function closeProviderListLog(): void {
  if (!viewing) return;
  if (viewing.timer) clearTimeout(viewing.timer);
  viewing.timer = null;
  if (viewing.pending.size > 0 || viewing.renders > 0) flush(viewing, 'close');
  viewing = null;
}

const host = (baseUrl: string) => baseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');

/** Cap a field so one long name cannot push the rest of the line off the end. */
function cap(value: string, max: number): string {
  const flat = value.replace(/[|\n\r]/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

const num = (value: number | null) => (value == null ? '?' : String(value));

/**
 * One row, one line.
 *
 * Positional rather than `key=value` because 14 fields of provenance do not
 * fit in 118 characters twice over, and `fmt` names the columns in the log
 * itself so the order never has to be remembered.
 */
function rowLine(paint: RowPaint): string {
  const line = [
    cap(host(paint.baseUrl), 30),
    cap(paint.title, 22),
    paint.titleIsHost ? 'host' : 'name',
    paint.runBy == null ? '-' : cap(paint.runBy, 18),
    paint.runBy == null
      ? '-'
      : paint.runByFromProfile
        ? 'prof'
        : paint.profileLoading
          ? '…'
          : 'npub',
    paint.status === 'online' ? 'up' : paint.status === 'offline' ? 'down' : '?',
    paint.statusSource,
    num(paint.followers),
    paint.followers == null ? '-' : paint.followersFromProfile ? 'prof' : 'nagg',
    num(paint.modelCount),
    num(paint.encryptedModelCount),
    String(paint.spendableSats),
    paint.blocked == null ? '-' : cap(paint.blocked, 14),
  ].join('|');
  return line.length <= MAX_LINE ? line : `${line.slice(0, MAX_LINE - 1)}…`;
}

const FMT =
  'host|title|tSrc|by|bySrc|status|stSrc|followers|folSrc|models|sealed|spendable|blocked';

/** Record one row's painted state. Called from the row's render. */
export function recordRowPaint(paint: RowPaint): void {
  const current = viewing;
  if (!current) return;
  current.paints++;
  current.pending.set(paint.baseUrl, rowLine(paint));
  schedule(current);
}

/** Record one render of the list itself, with the inputs that produced it. */
export function recordListRender(render: ListRender): void {
  // Opens on demand. The screen opens the recording from its own state
  // initializer, but an initializer is not a commit — Fast Refresh and a
  // discarded concurrent render both run it without one — and a diagnostic
  // that silently records nothing is worse than no diagnostic at all. A row
  // paint deliberately does NOT reopen, so nothing resurrects after unmount.
  if (!viewing) openProviderListLog();
  const current = viewing;
  if (!current) return;
  current.renders++;
  current.pendingOrder = [...render.order];
  for (const [key, value] of Object.entries(render.inputs)) {
    if (key in current.inputs && !Object.is(current.inputs[key], value)) current.causes.add(key);
  }
  current.inputs = render.inputs;
  schedule(current);
}

function schedule(current: Viewing): void {
  const now = Date.now();
  if (current.firstUnflushedAt === 0) current.firstUnflushedAt = now;
  if (current.timer) clearTimeout(current.timer);
  // A continuously re-rendering list never goes quiet for `BURST_MS`, and that
  // is precisely the case worth seeing, so the debounce has a ceiling.
  const wait = Math.max(0, Math.min(BURST_MS, current.firstUnflushedAt + MAX_BURST_MS - now));
  current.timer = setTimeout(() => {
    if (viewing === current) flush(current, 'burst');
  }, wait);
}

/** Pack lines into nested buckets of 15, the largest shape the logger keeps. */
function buckets(entries: [number, string][]): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  const kept = entries.slice(0, BUCKET * MAX_BUCKETS);
  for (let i = 0; i < kept.length; i += BUCKET) {
    const bucket: Record<string, string> = {};
    for (const [index, line] of kept.slice(i, i + BUCKET)) {
      bucket[`r${String(index).padStart(2, '0')}`] = line;
    }
    out[`g${i / BUCKET}`] = bucket;
  }
  return out;
}

function flush(current: Viewing, reason: 'burst' | 'close'): void {
  current.timer = null;
  current.firstUnflushedAt = 0;

  const order = current.pendingOrder ?? current.order;
  const previousOrder = current.order;
  const previousLines = current.lines;

  const changed: [number, string][] = [];
  let firstSeen = 0;
  for (const [baseUrl, line] of current.pending) {
    const before = previousLines.get(baseUrl);
    if (before === line) continue;
    if (before === undefined) firstSeen++;
    const index = order.indexOf(baseUrl);
    changed.push([index === -1 ? order.length : index, line]);
    previousLines.set(baseUrl, line);
  }
  changed.sort((a, b) => a[0] - b[0]);

  const removed = previousOrder.filter((baseUrl) => !order.includes(baseUrl));
  for (const baseUrl of removed) previousLines.delete(baseUrl);

  // A row that merely MOVED looks identical to one whose fields changed if all
  // you have is a screenshot, so the two are counted apart. `moved` is the
  // number of providers present in both passes at a different index.
  const before = new Map(previousOrder.map((baseUrl, index) => [baseUrl, index]));
  const moved = order.filter(
    (baseUrl, index) => before.has(baseUrl) && before.get(baseUrl) !== index
  ).length;

  current.pass++;
  const first = current.pass === 1;
  aiLog.info('ai.provider.list_paint', {
    pass: current.pass,
    reason,
    sinceOpenMs: Date.now() - current.openedAt,
    // Renders of the screen vs paints of rows. `changed: 0` with a non-zero
    // `paints` is a burst that cost every row a render and showed the user
    // nothing new.
    renders: current.renders,
    paints: current.paints,
    rows: order.length,
    // The list is virtualized, so only rows on screen paint. `painted` is how
    // many of `rows` reported this burst; a `changed` count is always a claim
    // about those, never about the ones below the fold.
    painted: current.pending.size,
    changed: changed.length,
    // Rows whose line had never been recorded. Scrolling produces these too —
    // a row coming into view for the first time is first-seen, not new.
    firstSeen,
    removed: removed.length,
    moved,
    // Which inputs changed IDENTITY since the previous render. An input that
    // appears here on a pass with `changed: 0` handed back a new object for a
    // fact that did not change.
    cause: [...current.causes].join(',') || '-',
    ...(first ? { fmt: FMT } : {}),
    ...(changed.length > 0 ? { lines: buckets(changed) } : {}),
  });

  current.order = [...order];
  current.pending.clear();
  current.pendingOrder = null;
  current.renders = 0;
  current.paints = 0;
  current.causes.clear();
}
