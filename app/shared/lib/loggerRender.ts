// ═══════════════════════════════════════════════════════════════════════════════
// RENDER DIAGNOSTICS — why a component re-rendered, and what churned
// ═══════════════════════════════════════════════════════════════════════════════
//
// `loggerHooks` answers "how many times did this render". These answer the next
// three questions, which is what log-doctor's `renders` mode already reports on
// and which nothing in the app emitted:
//
//   render.why    which named input changed identity, and how (useWhyDidRender)
//   state.change  which piece of local state churned (useStateChangeLogger)
//   query.result  what a data hook handed the tree, and how it moved
//   query.diff      (useQueryResultLogger)
//
// A fourth emitter, `useRowRenderLogger`, reports list-ROW renders. A feed of
// fifty notes re-rendering costs fifty renders but must not cost fifty log
// entries, so rows accumulate into a one-second window and flush as a single
// `render.count` carrying the distribution — including `wasted`, the renders
// beyond the first for each row in that window.
//
// PRIVACY: these hooks receive props and hook results, which routinely hold
// pubkeys, note ids, mint URLs, DM text and profile fields. They therefore log
// only the SHAPE of a value — its type, length, key count and identity
// stability — never the value itself. Numbers and booleans are the one
// exception (counts and flags, per contributor-conventions' logging rule).
//
// Dev-only: every export below resolves to a no-op at module init in a build
// where `SHOW_LOGS` is false, so a release build pays nothing — not even the
// effect that would otherwise run on every commit.

import { useEffect, useRef } from 'react';

import { log, monotonicNow, SHOW_LOGS, type Logger } from './loggerCore';

/**
 * A value, or a function producing it.
 *
 * The no-op these hooks become in a release build still lets the CALLER
 * evaluate its arguments — an object literal is nothing, but
 * `rows.filter(…).length` three times over, or `Object.keys(map).length` on a
 * hundred-entry cache, is real work on every render of a shipped app. Passing a
 * thunk moves that behind the gate: production allocates one closure and never
 * calls it.
 */
type Lazy<T> = T | (() => T);

function resolveLazy<T>(value: Lazy<T>): T {
  return typeof value === 'function' ? (value as () => T)() : value;
}

// ─── Value description (shape only, never the value) ─────────────────────────

/** How a value changed, in words a log reader can act on. Never includes strings or object contents. */
function describeChange(before: unknown, after: unknown): string {
  if (before === undefined) return 'became defined';
  if (after === undefined) return 'became undefined';
  if (before === null) return 'null → value';
  if (after === null) return 'value → null';

  const beforeType = typeof before;
  const afterType = typeof after;
  if (beforeType !== afterType) return `${beforeType} → ${afterType}`;

  switch (beforeType) {
    case 'number':
      return `${before as number} → ${after as number}`;
    case 'boolean':
      return `${before as boolean} → ${after as boolean}`;
    case 'string': {
      const from = (before as string).length;
      const to = (after as string).length;
      return from === to ? `string changed, len ${to}` : `string len ${from} → ${to}`;
    }
    case 'function':
      return 'new function identity';
    case 'object':
      break;
    default:
      return 'value changed';
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    return before.length === after.length
      ? `new array identity, len ${after.length}`
      : `array len ${before.length} → ${after.length}`;
  }
  if (Array.isArray(before) !== Array.isArray(after)) return 'array ⇄ object';

  // A Map/Set has NO own enumerable keys, so the key count below would read
  // `0 keys` for a cache of two hundred profiles — the single most misleading
  // thing this module could say about the app's hottest inputs.
  const beforeSize = collectionSize(before);
  const afterSize = collectionSize(after);
  if (beforeSize !== null && afterSize !== null) {
    const kind = before instanceof Map ? 'map' : 'set';
    return beforeSize === afterSize
      ? `new ${kind} identity, ${afterSize} entries`
      : `${kind} ${beforeSize} → ${afterSize} entries`;
  }

  // `new String(…)` is typeof 'object' and its own keys are the CHARACTER
  // INDICES, so a 24-character mint URL boxed in a `FormattedString` reported
  // as "24 keys". Name the box instead: a String object reaching a render input
  // is itself worth seeing (it breaks `===` and crashes the RN bridge).
  const beforeBoxed = boxedPrimitive(before);
  const afterBoxed = boxedPrimitive(after);
  if (beforeBoxed && afterBoxed) {
    return beforeBoxed === afterBoxed
      ? `new ${beforeBoxed} object identity`
      : `${beforeBoxed} object → ${afterBoxed} object`;
  }

  const beforeKeys = Object.keys(before as object).length;
  const afterKeys = Object.keys(after as object).length;
  return beforeKeys === afterKeys
    ? `new object identity, ${afterKeys} keys`
    : `object keys ${beforeKeys} → ${afterKeys}`;
}

/** Entry count for a Map/Set, or null for anything else. */
function collectionSize(value: unknown): number | null {
  if (value instanceof Map || value instanceof Set) return value.size;
  return null;
}

/** `'String'` / `'Number'` / `'Boolean'` for a boxed primitive, else null. */
function boxedPrimitive(value: unknown): string | null {
  if (value instanceof String) return 'String';
  if (value instanceof Number) return 'Number';
  if (value instanceof Boolean) return 'Boolean';
  return null;
}

/** A value's shape, for the first sighting where there is nothing to compare against. */
function describeValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array(${value.length})`;
  switch (typeof value) {
    case 'number':
    case 'boolean':
      return String(value);
    case 'string':
      return `string(${value.length})`;
    case 'function':
      return 'function';
    case 'object': {
      const size = collectionSize(value);
      if (size !== null) return `${value instanceof Map ? 'map' : 'set'}(${size})`;
      const boxed = boxedPrimitive(value);
      if (boxed) return `${boxed}(${String(value).length})`;
      return `object(${Object.keys(value as object).length})`;
    }
    default:
      return typeof value;
  }
}

// ─── render.why ──────────────────────────────────────────────────────────────

/** `{ [inputName]: { hint } }` — the shape log-doctor's `renders` mode reads. */
type RenderChanges = Record<string, { hint: string }>;

function diffInputs(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): RenderChanges {
  const changes: RenderChanges = {};
  for (const key of Object.keys(after)) {
    if (Object.is(before[key], after[key])) continue;
    changes[key] = { hint: describeChange(before[key], after[key]) };
  }
  for (const key of Object.keys(before)) {
    if (key in after) continue;
    changes[key] = { hint: 'input removed' };
  }
  return changes;
}

function useWhyDidRenderLive(
  component: string,
  lazyInputs: Lazy<Record<string, unknown>>,
  logger: Logger = log
): void {
  const previous = useRef<Record<string, unknown> | null>(null);
  const renders = useRef(0);

  // No dep array on purpose: this must observe every commit. Comparison
  // happens here rather than during render so the hook never writes a ref
  // mid-render and every caller stays compilable by the React Compiler.
  useEffect(() => {
    renders.current += 1;
    const inputs = resolveLazy(lazyInputs);
    const before = previous.current;
    previous.current = inputs;
    if (!before) return;
    const changes = diffInputs(before, inputs);
    const changed = Object.keys(changes);
    if (changed.length === 0) {
      // A commit with no changed input is the interesting case: something
      // above re-rendered this subtree for nothing.
      logger.debug('render.why', {
        component,
        renders: renders.current,
        changes: {},
        unexplained: true,
      });
      return;
    }
    logger.debug('render.why', {
      component,
      renders: renders.current,
      changes,
      changedCount: changed.length,
      inputCount: Object.keys(inputs).length,
    });
  });
}

/**
 * Report WHICH named input changed on each re-render, and how.
 *
 * Pass the values that actually feed the render — props, hook results, store
 * slices — under the names you would use when reasoning about them:
 *
 *   useWhyDidRender('MintInfoScreen', { mintUrl, detail, cachedMeta, profile });
 *
 * A commit where nothing changed is reported too, tagged `unexplained: true`:
 * that is a parent re-rendering this subtree for no reason, which is the
 * cheapest re-render to delete. Read it with
 * `npx tsx codereview/log-doctor/index.ts renders --latest`.
 */
export const useWhyDidRender: (
  component: string,
  inputs: Lazy<Record<string, unknown>>,
  logger?: Logger
) => void = SHOW_LOGS ? useWhyDidRenderLive : () => {};

// ─── state.change ────────────────────────────────────────────────────────────

function useStateChangeLoggerLive(
  component: string,
  lazyStates: Lazy<Record<string, unknown>>,
  logger: Logger = log
): void {
  const previous = useRef<Record<string, unknown> | null>(null);

  useEffect(() => {
    const states = resolveLazy(lazyStates);
    const before = previous.current;
    previous.current = states;
    if (!before) return;
    for (const key of Object.keys(states)) {
      if (Object.is(before[key], states[key])) continue;
      logger.debug('state.change', {
        component,
        state: key,
        from: describeValue(before[key]),
        to: describeValue(states[key]),
        hint: describeChange(before[key], states[key]),
      });
    }
  });
}

/**
 * Report each named piece of local state that changed on a commit, one event
 * per state. log-doctor's `renders` mode aggregates these into STATE CHURN, so
 * a `useState` that flips forty times while a screen settles is visible without
 * reading the timeline. Pass the state this component OWNS, not values derived
 * from it:
 *
 *   useStateChangeLogger('MintReviewsScreen', { sort, expandedCount, refreshing });
 */
export const useStateChangeLogger: (
  component: string,
  states: Lazy<Record<string, unknown>>,
  logger?: Logger
) => void = SHOW_LOGS ? useStateChangeLoggerLive : () => {};

// ─── query.result / query.diff ───────────────────────────────────────────────

interface QuerySnapshot {
  /** Which data hook this is — the grouping key in log-doctor's DATA HOOK UPDATES. */
  source: string;
  /** The hook's own status word (`'loading'`, `'ready'`, `'revalidating'`, …). */
  status?: string;
  /** Usable items on hand. */
  count?: number;
  /** The read that produced this value, joining `query.*` to `read.<surface>.*`. */
  readId?: string | null;
  /** Where the visible value came from (`'cache'`, `'network'`, `'seed'`, …). */
  source_kind?: string;
  /** Anything else worth a column: `stale`, `partial`, `hasError`, … Shapes only. */
  extra?: Record<string, string | number | boolean | null | undefined>;
}

function useQueryResultLoggerLive(lazySnapshot: Lazy<QuerySnapshot>, logger: Logger = log): void {
  const previous = useRef<QuerySnapshot | null>(null);
  const emits = useRef(0);

  useEffect(() => {
    const snapshot = resolveLazy(lazySnapshot);
    const before = previous.current;
    previous.current = snapshot;
    const { source, status, count, readId, source_kind, extra } = snapshot;

    if (!before) {
      emits.current += 1;
      logger.debug('query.result', {
        source,
        status,
        count,
        readId,
        source_kind,
        ...extra,
      });
      return;
    }

    const statusChanged = before.status !== status;
    const countChanged = before.count !== count;
    const kindChanged = before.source_kind !== source_kind;
    const extraChanged = extraDiffers(before.extra, extra);
    if (!statusChanged && !countChanged && !kindChanged && !extraChanged) return;

    emits.current += 1;
    logger.debug('query.diff', {
      source,
      status,
      from_status: before.status,
      count,
      prev_count: before.count,
      delta:
        typeof count === 'number' && typeof before.count === 'number'
          ? count - before.count
          : undefined,
      readId,
      source_kind,
      from_source_kind: kindChanged ? before.source_kind : undefined,
      updates: emits.current,
      ...extra,
    });
  });
}

function extraDiffers(before: QuerySnapshot['extra'], after: QuerySnapshot['extra']): boolean {
  if (!before && !after) return false;
  if (!before || !after) return true;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) if (before[key] !== after[key]) return true;
  return false;
}

/**
 * Report what a data hook is handing the tree, and every time that moves.
 *
 * First commit emits `query.result`; each change emits `query.diff` with the
 * previous status and count beside the new ones. Pair it with the read
 * lifecycle by passing the hook's `readId` — the same id appears on
 * `read.<surface>.*`, so one filter shows the fetch and every render it caused:
 *
 *   useQueryResultLogger({
 *     source: 'useMintDetailRead',
 *     status: detail.status,
 *     count: detail.reviews.length,
 *     readId: detail.readId,
 *     extra: { auditKnown: !!detail.audit },
 *   });
 */
export const useQueryResultLogger: (snapshot: Lazy<QuerySnapshot>, logger?: Logger) => void =
  SHOW_LOGS ? useQueryResultLoggerLive : () => {};

// ─── Aggregated row renders ──────────────────────────────────────────────────

/** A list's renders inside the current flush window. */
interface RowWindow {
  startedAt: number;
  renders: number;
  /** rowKey → renders in this window. Keys are never logged, only counted. */
  rows: Map<string, number>;
  timer: ReturnType<typeof setTimeout> | null;
  logger: Logger;
  warnAfter: number;
}

const ROW_FLUSH_MS = 1_000;
const rowWindows = new Map<string, RowWindow>();

function flushRowWindow(list: string): void {
  const window = rowWindows.get(list);
  if (!window) return;
  rowWindows.delete(list);
  if (window.timer) clearTimeout(window.timer);

  const aliveMs = Math.round((monotonicNow() - window.startedAt) * 100) / 100;
  const uniqueRows = window.rows.size;
  let maxRowRenders = 0;
  for (const count of window.rows.values()) {
    if (count > maxRowRenders) maxRowRenders = count;
  }
  // Every render past the first for a given row is a render that produced the
  // same row twice in one second. That is the number to drive to zero.
  const wasted = window.renders - uniqueRows;
  const level = maxRowRenders > window.warnAfter ? 'warn' : 'debug';

  window.logger[level]('render.count', {
    component: `${list}/row`,
    renders: window.renders,
    aliveMs,
    rendersPerSec: aliveMs > 0 ? Math.round((window.renders / aliveMs) * 1000 * 100) / 100 : 0,
    rows: uniqueRows,
    maxRowRenders,
    avgRowRenders: uniqueRows > 0 ? Math.round((window.renders / uniqueRows) * 100) / 100 : 0,
    wasted,
  });
}

function bumpRow(list: string, rowKey: string, logger: Logger, warnAfter: number): void {
  let window = rowWindows.get(list);
  if (!window) {
    window = {
      startedAt: monotonicNow(),
      renders: 0,
      rows: new Map(),
      timer: null,
      logger,
      warnAfter,
    };
    rowWindows.set(list, window);
    window.timer = setTimeout(() => flushRowWindow(list), ROW_FLUSH_MS);
  }
  window.renders += 1;
  window.rows.set(rowKey, (window.rows.get(rowKey) ?? 0) + 1);
}

function countRowRenderLive(
  list: string,
  rowKey: string,
  options?: { logger?: Logger; warnAfter?: number }
): void {
  bumpRow(list, rowKey, options?.logger ?? log, options?.warnAfter ?? 4);
}

/**
 * The imperative form of {@link useRowRenderLogger}, for the dominant pattern
 * in this app: a `renderItem` callback that builds a row inline rather than
 * mounting a row component, where there is no place to hang a hook.
 *
 * Safe to call during render — it only touches a module-level counter and
 * schedules the flush timer; it never reads or writes React state.
 *
 *   const renderRow = ({ item }) => {
 *     countRowRender('MintListScreen', item.mintUrl);
 *     return <ContactRow … />;
 *   };
 */
export const countRowRender: (
  list: string,
  rowKey: string,
  options?: { logger?: Logger; warnAfter?: number }
) => void = SHOW_LOGS ? countRowRenderLive : () => {};

function useRowRenderLoggerLive(
  list: string,
  rowKey: string,
  options?: { logger?: Logger; warnAfter?: number }
): void {
  const logger = options?.logger ?? log;
  const warnAfter = options?.warnAfter ?? 4;
  // Every commit, including recycled rows: the aggregate is the point.
  useEffect(() => {
    bumpRow(list, rowKey, logger, warnAfter);
  });
}

/**
 * Count row renders for a virtualised list WITHOUT one log entry per row.
 *
 * Renders accumulate per list for one second and flush as a single
 * `render.count` under `"<list>/row"`, carrying `rows` (distinct rows drawn),
 * `maxRowRenders`, `avgRowRenders` and `wasted` — the renders beyond the first
 * for each row in that second. A healthy scroll shows `wasted` near zero; a
 * feed re-rendering every visible row because one note's stats landed shows
 * `wasted` climbing with `rows`.
 *
 * `rowKey` identifies the row for counting only. It is used as a Map key and
 * never logged, so a note id or pubkey is a safe value to pass.
 */
export const useRowRenderLogger: (
  list: string,
  rowKey: string,
  options?: { logger?: Logger; warnAfter?: number }
) => void = SHOW_LOGS ? useRowRenderLoggerLive : () => {};

/** Flush any open row window immediately — for tests and for a screen teardown that wants the tail. */
export function flushRowRenderWindows(): void {
  if (!SHOW_LOGS) return;
  for (const list of [...rowWindows.keys()]) flushRowWindow(list);
}
