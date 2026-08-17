/**
 * @fileoverview Content-shift and visual-layout instrumentation for app surfaces.
 *
 * "Content shift" = a visible layout jump: a skeleton swapping to real content,
 * an image resolving its true aspect ratio after a 16:9 placeholder, a note body
 * reflowing when async profiles / quotes / metrics arrive, a sticky reply bar
 * growing on focus. These are the hardest UI bugs to reason about after the fact
 * because the jump is gone by the time you look.
 *
 * `useShiftLogger` gives every instrumented surface one change-gated reporter:
 * it remembers the last measured value per key and only emits when the value
 * actually changes, tagging each entry with `prev`, `delta`, and `firstMeasure`
 * so a log reader can tell a real shift (`firstMeasure: false`, non-zero
 * `delta`) from a harmless initial layout (`firstMeasure: true`).
 *
 * Query the resulting timeline with log-doctor, e.g.
 *   npx tsx codereview/log-doctor/index.ts timeline --event 'visual\\.layout|\\.shift\\.' --latest
 * Shift and visual events live under the existing `feed` logger module so one
 * filter catches the historical feed/thread traces plus newer shared probes.
 *
 * Dev-only: `feedLog` (like every Sovran logger) short-circuits in production.
 */
import { useCallback, useEffect, useRef } from 'react';
import {
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  useWindowDimensions,
} from 'react-native';

import { feedLog, monotonicNow } from '@/shared/lib/logger';

/** Sub-pixel layout deltas are noise from rounding, not a visible shift. */
const SHIFT_EPSILON = 0.5;

interface ShiftReporter {
  /**
   * Report a measured numeric value (height, aspect ratio, padding, …) for
   * `key`. Logs `event` only when the value changed from the last one seen for
   * that key. `extra` is merged into the log params for surface-specific
   * context (event id, url host, focused state, …).
   */
  report(event: string, key: string, value: number, extra?: Record<string, unknown>): void;
}

/**
 * Returns a stable {@link ShiftReporter} for a component. Keep one per mounted
 * component (the per-key last-value memory lives in a ref, so a recycled list
 * row keeps comparing against the value it last rendered for that key).
 */
export function useShiftLogger(component: string): ShiftReporter {
  const lastRef = useRef<Map<string, number>>(new Map());

  const report = useCallback<ShiftReporter['report']>(
    (event, key, value, extra) => {
      if (!Number.isFinite(value)) return;
      const prev = lastRef.current.get(key);
      const firstMeasure = prev === undefined;
      if (!firstMeasure && Math.abs((prev as number) - value) < SHIFT_EPSILON) return;
      lastRef.current.set(key, value);
      feedLog.info(event, {
        component,
        key: safeLogKey(key),
        value: round(value),
        prev: firstMeasure ? null : round(prev as number),
        delta: firstMeasure ? null : round(value - (prev as number)),
        firstMeasure,
        ...extra,
      });
    },
    [component]
  );

  return { report };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** The host of a media URL, for log context without leaking the full URL. */
export function urlHost(url: string): string {
  const match = url.match(/^[a-z]+:\/\/([^/]+)/i);
  return match ? match[1] : 'unknown';
}

export function visualLayoutScopePart(value: string | undefined): string {
  const normalized = (value ?? 'default').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 48);
  return normalized || 'default';
}

type LayoutRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type MeasureableNode = {
  measureInWindow?: (cb: (x: number, y: number, width: number, height: number) => void) => void;
};

type VisualExtra = Record<string, unknown> | (() => Record<string, unknown>);

export type VisualLayoutConfig = {
  /** Set false when a caller wants the hook shape without emitting layout logs. */
  enabled?: boolean;
  /** Marks this measured node as a containing boundary for child/row probes in the same scope. */
  isContainer?: boolean;
  /** Stable scope for overlap checks, e.g. `feed.home.list` or `thread.<id>.list`. */
  scope: string;
  surface: string;
  component: string;
  itemKey: string;
  itemType?: string;
  index?: number;
  phase?: string;
  extra?: VisualExtra;
};

type VisualLayoutReporter = {
  ref: (node: MeasureableNode | null) => void;
  onLayout: (event: LayoutChangeEvent) => void;
  measureNow: (reason: string, extra?: Record<string, unknown>) => void;
};

type VisualListItemContext = Record<string, unknown>;

type VisualListItemSizeInfo<ItemT> = {
  size: number;
  previous: number;
  index: number;
  itemKey: string;
  itemData: ItemT;
};

type VisualListLoadInfo = {
  elapsedTimeInMs: number;
};

type VisualListMetrics = object;

type VisualListState<ItemT> = {
  activeStickyIndex?: number;
  contentLength?: number;
  data?: readonly ItemT[];
  end?: number;
  endBuffered?: number;
  positionAtIndex?: (index: number) => number;
  positionByKey?: (key: string) => number | undefined;
  scroll?: number;
  scrollLength?: number;
  scrollVelocity?: number;
  sizeAtIndex?: (index: number) => number;
  sizes?: Map<string, number>;
  start?: number;
  startBuffered?: number;
};

type VisualViewToken<ItemT> = {
  index: number | null;
  key: string;
  isViewable: boolean;
  item: ItemT;
  percentVisible?: number;
  size?: number;
  sizeVisible?: number;
};

type VisualViewabilityInfo<ItemT> = {
  changed: VisualViewToken<ItemT>[];
  end: number;
  endBuffered: number;
  start: number;
  startBuffered: number;
  viewableItems: VisualViewToken<ItemT>[];
};

type VisualStickyHeaderInfo<ItemT> = {
  index: number;
  item: ItemT;
};

type VisualListConfig<ItemT> = {
  enabled?: boolean;
  scope: string;
  surface: string;
  component: string;
  phase?: string;
  extra?: VisualExtra;
  getItemKey?: (item: ItemT, index: number, fallbackKey: string) => string;
  getItemContext?: (item: ItemT, index: number) => VisualListItemContext;
  getListState?: () => VisualListState<ItemT> | null | undefined;
};

type VisualListReporter<ItemT> = {
  onItemSizeChanged: (info: VisualListItemSizeInfo<ItemT>) => void;
  onLoad: (info: VisualListLoadInfo) => void;
  onMetricsChange: (metrics: VisualListMetrics) => void;
  onStickyHeaderChange: (info: VisualStickyHeaderInfo<ItemT>) => void;
  onViewableItemsChanged: (info: VisualViewabilityInfo<ItemT>) => void;
};

type VisualVirtualPositionChunk = {
  chunkIndex: number;
  chunkCount: number;
  summary: VisualVirtualPositionSummary;
  rows: Record<string, unknown>[];
  totalRows: number;
};

type VisualVirtualPositionSummary = {
  duplicateKeyCount: number;
  farVirtualCount: number;
  invalidSizeCount: number;
  missingSizeCount: number;
  missingVirtualPositionCount: number;
  outsideContentLengthCount: number;
  virtualAnomaly: boolean;
  virtualOverlapCount: number;
  virtualOrderBreakCount: number;
};

type VisualScrollAxis = 'x' | 'y';

type VisualScrollMetricsConfig = {
  enabled?: boolean;
  scope: string;
  surface: string;
  component: string;
  phase?: string;
  axis?: VisualScrollAxis;
  extra?: VisualExtra;
};

type VisualScrollMetricsReporter = {
  onContentSizeChange: (width: number, height: number) => void;
  onLayout: (event: LayoutChangeEvent) => void;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  reportNow: (reason: string) => void;
};

type VisualStateRemeasureOptions = {
  enabled?: boolean;
  minIntervalMs?: number;
  maxItems?: number;
  reason?: string;
};

type VisualStateConfig = {
  enabled?: boolean;
  scope: string;
  surface: string;
  component: string;
  stateKey: string;
  phase?: string;
  state: Record<string, unknown>;
  extra?: VisualExtra;
  remeasure?: boolean | VisualStateRemeasureOptions;
};

type VisualScrollMetricsSnapshot = {
  contentHeight: number | null;
  contentWidth: number | null;
  offsetX: number;
  offsetY: number;
  viewportHeight: number | null;
  viewportWidth: number | null;
};

type VisualRecord = {
  scope: string;
  itemKey: string;
  getConfig: () => VisualLayoutConfig;
  getNode: () => MeasureableNode | null;
  mountOrder: number;
  isContainer: boolean;
  measure: (reason: string, extra?: Record<string, unknown>) => void;
  lastRect: LayoutRect | null;
  lastMeasuredAt: number;
  lastViewport: { width: number; height: number } | null;
};

const VISUAL_LAYOUT_TTL_MS = 1_500;
const VISUAL_LAYOUT_JUMP_WARN_PX = 80;
const VISUAL_LAYOUT_OVERLAP_WARN_PX = 4;
const VISUAL_LAYOUT_CONTAINER_WARN_PX = 4;
const VISUAL_LIST_SIZE_JUMP_WARN_PX = 80;
const VISUAL_LIST_METRIC_JUMP_WARN_PX = 80;
const VISUAL_LIST_VIEWABILITY_LOG_INTERVAL_MS = 300;
const VISUAL_LIST_VIRTUAL_POSITION_CHUNK_SIZE = 50;
const VISUAL_LIST_VIRTUAL_POSITION_FAR_MULTIPLIER = 3;
const VISUAL_SCOPE_SNAPSHOT_CHUNK_SIZE = 40;
const VISUAL_SCOPE_REGISTRY = new Map<string, Map<string, VisualRecord>>();
const VISUAL_SCOPE_LAST_REMEASURE_AT = new Map<string, number>();
let visualLayoutMountSequence = 0;

export const VISUAL_LIST_VIEWABILITY_CONFIG = {
  itemVisiblePercentThreshold: 1,
  minimumViewTime: 0,
};

/**
 * Collapse a viewability token batch into the {start,end} range the visual-list
 * logger reports. Buffered bounds mirror the raw ones — FlashList already
 * windows for us, so there is no extra buffer to account for.
 */
export function visualViewabilityRange(tokens: { index: number | null }[]): {
  start: number;
  end: number;
  startBuffered: number;
  endBuffered: number;
} {
  const indexes = tokens
    .map((token) => token.index)
    .filter((index): index is number => typeof index === 'number');
  const start = indexes.length > 0 ? Math.min(...indexes) : 0;
  const end = indexes.length > 0 ? Math.max(...indexes) : -1;
  return { start, end, startBuffered: start, endBuffered: end };
}

function visualLoggingEnabled(enabled = true): boolean {
  if (!enabled) return false;
  const isLevelEnabled = feedLog.isLevelEnabled;
  if (typeof isLevelEnabled !== 'function') return true;
  return isLevelEnabled('info') || isLevelEnabled('warn');
}

function visualRecordKey(scope: string, itemKey: string): string {
  return `${scope}:${itemKey}`;
}

// A bare 64-hex Nostr id used as a row key is rewritten by the logger's secret
// redactor (`loggerCore` `hex32` rule) to `{ _kind: 'hex32', len: 64 }`, which
// renders as `[object Object]` and destroys per-row measured↔virtual correlation
// in log-doctor (you can no longer match a measured row to its virtual slot).
// Emit a stable, non-secret short token instead. Keep using the RAW key for
// internal lookups/correlation (registry, `positionByKey`); only the value
// written into log params goes through here. Non-hex keys (`reply-sort-tabs`,
// `t_<id>`, image urls) pass through unchanged.
function safeLogKey(key: string): string {
  return /^(0x)?[0-9a-fA-F]{64}$/.test(key) ? `h_${key.replace(/^0x/i, '').slice(0, 16)}` : key;
}

// Item contexts may carry a `rowKey` (the same bare-hex id). Sanitize it so the
// redactor doesn't strip it, keeping it correlatable alongside the `key` field.
function safeContextKeys(context: Record<string, unknown>): Record<string, unknown> {
  return typeof context.rowKey === 'string'
    ? { ...context, rowKey: safeLogKey(context.rowKey) }
    : context;
}

function isContainerLikeConfig(config: VisualLayoutConfig): boolean {
  if (config.isContainer === true) return true;

  const itemType = (config.itemType ?? '').toLowerCase();
  const component = config.component.toLowerCase();

  return (
    itemType.includes('container') ||
    itemType.includes('viewport') ||
    itemType.includes('screen') ||
    itemType.includes('scroll') ||
    itemType.includes('list') ||
    itemType.includes('flatlist') ||
    component.endsWith('list') ||
    component.endsWith('flatlist') ||
    component.endsWith('scrollview') ||
    component.endsWith('body') ||
    component.includes('viewport')
  );
}

function resolveExtra(extra: VisualExtra | undefined): Record<string, unknown> {
  if (!extra) return {};
  if (typeof extra === 'function') return extra();
  return extra;
}

function validRect(rect: LayoutRect): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height)
  );
}

function rectBottom(rect: LayoutRect): number {
  return rect.y + rect.height;
}

function rectRight(rect: LayoutRect): number {
  return rect.x + rect.width;
}

function verticalOverlap(a: LayoutRect, b: LayoutRect): number {
  return Math.min(rectBottom(a), rectBottom(b)) - Math.max(a.y, b.y);
}

function horizontalOverlap(a: LayoutRect, b: LayoutRect): number {
  return Math.min(rectRight(a), rectRight(b)) - Math.max(a.x, b.x);
}

function rectOverlap(a: LayoutRect, b: LayoutRect): { x: number; y: number; area: number } {
  const x = horizontalOverlap(a, b);
  const y = verticalOverlap(a, b);
  return { x, y, area: x > 0 && y > 0 ? x * y : 0 };
}

function findOverlaps(
  scope: string,
  itemKey: string,
  rect: LayoutRect,
  currentIsContainer: boolean,
  currentIndex: number | null
): Record<string, unknown>[] {
  if (currentIsContainer) return [];
  const records = VISUAL_SCOPE_REGISTRY.get(scope);
  if (!records) return [];
  const nowMs = monotonicNow();
  const overlaps: Record<string, unknown>[] = [];

  for (const record of records.values()) {
    if (record.itemKey === itemKey || !record.lastRect || record.isContainer) continue;
    if (nowMs - record.lastMeasuredAt > VISUAL_LAYOUT_TTL_MS) continue;
    const otherConfig = record.getConfig();
    const otherIndex = otherConfig.index ?? null;
    // Two records at the same list index are a row-identity transition (e.g. a
    // recycled `reply-skeleton` slot becoming a real `reply`), not a real visual
    // stack: the stale record lingers in the registry within TTL while the new
    // one is measured at the same position. Skip so the swap isn't reported as
    // an overlap — these false positives were drowning out genuine overlaps.
    if (currentIndex != null && otherIndex != null && otherIndex === currentIndex) continue;
    const overlap = rectOverlap(rect, record.lastRect);
    if (overlap.x <= VISUAL_LAYOUT_OVERLAP_WARN_PX || overlap.y <= VISUAL_LAYOUT_OVERLAP_WARN_PX) {
      continue;
    }
    overlaps.push({
      key: safeLogKey(record.itemKey),
      component: otherConfig.component,
      itemType: otherConfig.itemType ?? null,
      mountOrder: record.mountOrder,
      x: round(record.lastRect.x),
      y: round(record.lastRect.y),
      width: round(record.lastRect.width),
      height: round(record.lastRect.height),
      overlapX: round(overlap.x),
      overlapY: round(overlap.y),
      overlapArea: round(overlap.area),
    });
    if (overlaps.length >= 5) break;
  }

  return overlaps;
}

function findContainerViolations(
  scope: string,
  itemKey: string,
  rect: LayoutRect
): Record<string, unknown>[] {
  const records = VISUAL_SCOPE_REGISTRY.get(scope);
  if (!records) return [];
  const nowMs = monotonicNow();
  const violations: Record<string, unknown>[] = [];

  for (const record of records.values()) {
    if (record.itemKey === itemKey || !record.lastRect || !record.isContainer) continue;
    if (nowMs - record.lastMeasuredAt > VISUAL_LAYOUT_TTL_MS) continue;

    const container = record.lastRect;
    const overflowTop = Math.max(0, container.y - rect.y);
    const overflowLeft = Math.max(0, container.x - rect.x);
    const overflowBottom = Math.max(0, rectBottom(rect) - rectBottom(container));
    const overflowRight = Math.max(0, rectRight(rect) - rectRight(container));
    const overflowX = Math.max(overflowLeft, overflowRight);
    const overflowY = Math.max(overflowTop, overflowBottom);
    if (
      overflowX <= VISUAL_LAYOUT_CONTAINER_WARN_PX &&
      overflowY <= VISUAL_LAYOUT_CONTAINER_WARN_PX
    ) {
      continue;
    }

    const containerConfig = record.getConfig();
    violations.push({
      key: safeLogKey(record.itemKey),
      component: containerConfig.component,
      itemType: containerConfig.itemType ?? null,
      mountOrder: record.mountOrder,
      x: round(container.x),
      y: round(container.y),
      width: round(container.width),
      height: round(container.height),
      overflowTop: round(overflowTop),
      overflowLeft: round(overflowLeft),
      overflowBottom: round(overflowBottom),
      overflowRight: round(overflowRight),
      overflowX: round(overflowX),
      overflowY: round(overflowY),
    });
    if (violations.length >= 5) break;
  }

  return violations;
}

function viewportFlags(rect: LayoutRect, viewport: { width: number; height: number }) {
  const bottom = rectBottom(rect);
  const right = rectRight(rect);
  const visible =
    rect.width > 0 &&
    rect.height > 0 &&
    bottom >= 0 &&
    rect.y <= viewport.height &&
    right >= 0 &&
    rect.x <= viewport.width;
  const farOutsideY = rect.y < -viewport.height * 2 || rect.y > viewport.height * 3;
  const farOutsideX = rect.x < -viewport.width * 2 || rect.x > viewport.width * 3;
  const absurdHeight = rect.height > viewport.height * 3;
  const absurdWidth = rect.width > viewport.width * 3;
  const zeroArea = rect.width <= 0 || rect.height <= 0;
  return {
    visible,
    offscreenTop: bottom < 0,
    offscreenBottom: rect.y > viewport.height,
    offscreenLeft: right < 0,
    offscreenRight: rect.x > viewport.width,
    farOutsideY,
    farOutsideX,
    absurdHeight,
    absurdWidth,
    zeroArea,
  };
}

function scopeRecords(scope: string): Map<string, VisualRecord> {
  let records = VISUAL_SCOPE_REGISTRY.get(scope);
  if (!records) {
    records = new Map();
    VISUAL_SCOPE_REGISTRY.set(scope, records);
  }
  return records;
}

function pruneScope(scope: string): void {
  const records = VISUAL_SCOPE_REGISTRY.get(scope);
  if (!records || records.size > 0) return;
  VISUAL_SCOPE_REGISTRY.delete(scope);
}

function numericMetric(metrics: VisualListMetrics, key: string): number | null {
  const value = (metrics as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function roundOrNull(value: unknown): number | null {
  const number = finiteNumber(value);
  return number == null ? null : round(number);
}

function invokeNumber(fn: (() => number | undefined) | undefined): number | null {
  if (!fn) return null;
  try {
    return finiteNumber(fn());
  } catch {
    return null;
  }
}

function visualListStateSnapshot<ItemT>(
  state: VisualListState<ItemT> | null | undefined
): Record<string, unknown> {
  if (!state) return { hasListState: false };
  return {
    hasListState: true,
    dataLength: Array.isArray(state.data) ? state.data.length : null,
    scroll: roundOrNull(state.scroll),
    scrollLength: roundOrNull(state.scrollLength),
    scrollVelocity: roundOrNull(state.scrollVelocity),
    contentLength: roundOrNull(state.contentLength),
    start: roundOrNull(state.start),
    end: roundOrNull(state.end),
    startBuffered: roundOrNull(state.startBuffered),
    endBuffered: roundOrNull(state.endBuffered),
    activeStickyIndex: roundOrNull(state.activeStickyIndex),
  };
}

function visualVirtualMetrics<ItemT>(
  state: VisualListState<ItemT> | null | undefined,
  key: string | null,
  index: number | null
): Record<string, unknown> {
  if (!state) {
    return {
      virtualY: null,
      virtualH: null,
      virtualBottom: null,
      virtualSource: null,
    };
  }

  const byKey = key == null ? null : invokeNumber(() => state.positionByKey?.(key));
  const byIndex = index == null ? null : invokeNumber(() => state.positionAtIndex?.(index));
  const virtualY = byKey ?? byIndex;
  const sizeByKey = key == null ? null : finiteNumber(state.sizes?.get(key));
  const sizeByIndex = index == null ? null : invokeNumber(() => state.sizeAtIndex?.(index));
  const virtualH = sizeByKey ?? sizeByIndex;

  return {
    virtualY: virtualY == null ? null : round(virtualY),
    virtualH: virtualH == null ? null : round(virtualH),
    virtualBottom: virtualY == null || virtualH == null ? null : round(virtualY + virtualH),
    virtualSource: byKey != null ? 'key' : byIndex != null ? 'index' : null,
  };
}

function viewTokenSummary<ItemT>(
  tokens: VisualViewToken<ItemT>[],
  config: Pick<VisualListConfig<ItemT>, 'getItemContext' | 'getItemKey'>,
  state?: VisualListState<ItemT> | null
): Record<string, unknown>[] {
  return tokens.slice(0, 12).map((token) => {
    const key =
      token.index == null
        ? token.key
        : (config.getItemKey?.(token.item, token.index, token.key) ?? token.key);
    return {
      key: safeLogKey(key),
      index: token.index,
      isViewable: token.isViewable,
      percentVisible:
        typeof token.percentVisible === 'number' ? round(token.percentVisible) : undefined,
      size: typeof token.size === 'number' ? round(token.size) : undefined,
      sizeVisible: typeof token.sizeVisible === 'number' ? round(token.sizeVisible) : undefined,
      ...visualVirtualMetrics(state, key, token.index),
      ...(token.index == null
        ? {}
        : safeContextKeys(config.getItemContext?.(token.item, token.index) ?? {})),
    };
  });
}

function contextRowKey(context: VisualListItemContext): string | null {
  return typeof context.rowKey === 'string' && context.rowKey.length > 0 ? context.rowKey : null;
}

function visualBufferedRangeSummary<ItemT>(
  state: VisualListState<ItemT> | null | undefined,
  config: Pick<VisualListConfig<ItemT>, 'getItemContext' | 'getItemKey'>,
  fallbackKeyPrefix: string
): Record<string, unknown>[] {
  if (!state || !Array.isArray(state.data)) return [];
  const dataLength = state.data.length;
  if (dataLength === 0) return [];
  const start = Math.max(0, Math.floor(finiteNumber(state.startBuffered) ?? 0) - 2);
  const rawEnd = Math.ceil(finiteNumber(state.endBuffered) ?? finiteNumber(state.end) ?? start);
  const end = Math.min(dataLength - 1, rawEnd + 2);
  const rows: Record<string, unknown>[] = [];
  for (let index = start; index <= end && rows.length < 40; index += 1) {
    const item = state.data[index];
    if (item === undefined) continue;
    const fallbackKey = `${fallbackKeyPrefix}:${index}`;
    const context = config.getItemContext?.(item, index) ?? {};
    const key =
      config.getItemKey?.(item, index, fallbackKey) ?? contextRowKey(context) ?? fallbackKey;
    rows.push({
      key: safeLogKey(key),
      index,
      ...visualVirtualMetrics(state, key, index),
      ...safeContextKeys(context),
    });
  }
  return rows;
}

function visualVirtualPositionChunks<ItemT>(
  state: VisualListState<ItemT> | null | undefined,
  config: Pick<VisualListConfig<ItemT>, 'getItemContext' | 'getItemKey'>,
  fallbackKeyPrefix: string
): VisualVirtualPositionChunk[] {
  if (!state || !Array.isArray(state.data) || state.data.length === 0) return [];

  const rows: Record<string, unknown>[] = [];
  for (let index = 0; index < state.data.length; index += 1) {
    const item = state.data[index];
    if (item === undefined) continue;
    const fallbackKey = `${fallbackKeyPrefix}:${index}`;
    const context = config.getItemContext?.(item, index) ?? {};
    const key =
      config.getItemKey?.(item, index, fallbackKey) ?? contextRowKey(context) ?? fallbackKey;
    rows.push({
      key: safeLogKey(key),
      index,
      ...visualVirtualMetrics(state, key, index),
      ...safeContextKeys(context),
    });
  }
  const summary = visualVirtualPositionSummary(rows, state);

  const chunkCount = Math.ceil(rows.length / VISUAL_LIST_VIRTUAL_POSITION_CHUNK_SIZE);
  return Array.from({ length: chunkCount }, (_, chunkIndex) => {
    const start = chunkIndex * VISUAL_LIST_VIRTUAL_POSITION_CHUNK_SIZE;
    return {
      chunkIndex,
      chunkCount,
      summary,
      rows: rows.slice(start, start + VISUAL_LIST_VIRTUAL_POSITION_CHUNK_SIZE),
      totalRows: rows.length,
    };
  });
}

function visualVirtualPositionSummary(
  rows: Record<string, unknown>[],
  state: VisualListState<unknown>
): VisualVirtualPositionSummary {
  const seenKeys = new Set<string>();
  let duplicateKeyCount = 0;
  let farVirtualCount = 0;
  let invalidSizeCount = 0;
  let missingSizeCount = 0;
  let missingVirtualPositionCount = 0;
  let outsideContentLengthCount = 0;
  let virtualOverlapCount = 0;
  let virtualOrderBreakCount = 0;
  let previousVirtualBottom: number | null = null;
  let previousVirtualY: number | null = null;
  const viewportLength = finiteNumber(state.scrollLength) ?? 0;
  const contentLength = finiteNumber(state.contentLength);
  const farLimit = Math.max(viewportLength * VISUAL_LIST_VIRTUAL_POSITION_FAR_MULTIPLIER, 1);

  for (const row of rows.slice().sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0))) {
    const key = typeof row.key === 'string' ? row.key : null;
    if (key) {
      if (seenKeys.has(key)) duplicateKeyCount += 1;
      seenKeys.add(key);
    }

    const virtualY = finiteNumber(row.virtualY);
    const virtualH = finiteNumber(row.virtualH);
    const virtualBottom = virtualY == null || virtualH == null ? null : virtualY + virtualH;

    if (virtualY == null) {
      missingVirtualPositionCount += 1;
    } else if (contentLength != null) {
      if (virtualY < -farLimit || virtualY > contentLength + farLimit) farVirtualCount += 1;
    }

    if (virtualH == null) {
      missingSizeCount += 1;
    } else if (virtualH <= 0) {
      invalidSizeCount += 1;
    }

    if (
      contentLength != null &&
      virtualBottom != null &&
      virtualBottom > contentLength + Math.max(viewportLength, VISUAL_LIST_METRIC_JUMP_WARN_PX)
    ) {
      outsideContentLengthCount += 1;
    }

    if (
      virtualY != null &&
      previousVirtualBottom != null &&
      virtualY < previousVirtualBottom - VISUAL_LAYOUT_OVERLAP_WARN_PX
    ) {
      virtualOverlapCount += 1;
    }
    if (
      virtualY != null &&
      previousVirtualY != null &&
      virtualY < previousVirtualY - VISUAL_LAYOUT_OVERLAP_WARN_PX
    ) {
      virtualOrderBreakCount += 1;
    }

    previousVirtualY = virtualY ?? previousVirtualY;
    previousVirtualBottom = virtualBottom ?? previousVirtualBottom;
  }

  const virtualAnomaly =
    duplicateKeyCount > 0 ||
    farVirtualCount > 0 ||
    invalidSizeCount > 0 ||
    missingSizeCount > 0 ||
    missingVirtualPositionCount > 0 ||
    outsideContentLengthCount > 0 ||
    virtualOverlapCount > 0 ||
    virtualOrderBreakCount > 0;

  return {
    duplicateKeyCount,
    farVirtualCount,
    invalidSizeCount,
    missingSizeCount,
    missingVirtualPositionCount,
    outsideContentLengthCount,
    virtualAnomaly,
    virtualOverlapCount,
    virtualOrderBreakCount,
  };
}

function appendVisualFlag(row: Record<string, unknown>, flag: string): void {
  const flags = Array.isArray(row.flags) ? (row.flags as string[]) : [];
  flags.push(flag);
  row.flags = flags;
}

function incrementVisualCount(row: Record<string, unknown>, key: string): void {
  row[key] = (finiteNumber(row[key]) ?? 0) + 1;
}

function visualScopeSnapshotRows(
  scope: string,
  nowMs: number
): { rows: Record<string, unknown>[]; summary: Record<string, unknown> } | null {
  const records = VISUAL_SCOPE_REGISTRY.get(scope);
  if (!records) return null;

  const rows: Record<string, unknown>[] = Array.from(records.values()).map((record) => {
    const config = record.getConfig();
    const rect = record.lastRect;
    const measuredAgeMs = record.lastMeasuredAt > 0 ? nowMs - record.lastMeasuredAt : null;
    const stale = rect == null || measuredAgeMs == null || measuredAgeMs > VISUAL_LAYOUT_TTL_MS;
    const flags = stale ? ['stale'] : [];
    const viewport = record.lastViewport;
    const viewportState = rect && viewport ? viewportFlags(rect, viewport) : null;

    if (viewportState?.zeroArea === true) flags.push('zeroArea');
    if (viewportState?.farOutsideX === true) flags.push('farOutsideX');
    if (viewportState?.farOutsideY === true) flags.push('farOutsideY');
    if (viewportState?.absurdWidth === true) flags.push('absurdWidth');
    if (viewportState?.absurdHeight === true) flags.push('absurdHeight');

    return {
      ...resolveExtra(config.extra),
      scope,
      key: safeLogKey(record.itemKey),
      component: config.component,
      itemType: config.itemType ?? null,
      index: config.index ?? null,
      phase: config.phase ?? null,
      isContainer: record.isContainer,
      mountOrder: record.mountOrder,
      measuredAgeMs: measuredAgeMs == null ? null : round(measuredAgeMs),
      x: rect ? round(rect.x) : null,
      y: rect ? round(rect.y) : null,
      width: rect ? round(rect.width) : null,
      height: rect ? round(rect.height) : null,
      bottom: rect ? round(rectBottom(rect)) : null,
      right: rect ? round(rectRight(rect)) : null,
      visible: viewportState?.visible ?? null,
      farOutsideX: viewportState?.farOutsideX ?? false,
      farOutsideY: viewportState?.farOutsideY ?? false,
      absurdWidth: viewportState?.absurdWidth ?? false,
      absurdHeight: viewportState?.absurdHeight ?? false,
      zeroArea: viewportState?.zeroArea ?? false,
      overlapCount: 0,
      containerViolationCount: 0,
      flags,
    };
  });

  const rowsByKey = new Map(
    rows.map((row) => [typeof row.key === 'string' ? row.key : String(row.key ?? '?'), row])
  );
  const measuredRows = Array.from(records.values()).filter(
    (record) => record.lastRect && !record.isContainer
  );

  let measuredOverlapCount = 0;
  for (let i = 0; i < measuredRows.length; i += 1) {
    const a = measuredRows[i];
    const aRect = a.lastRect;
    if (!aRect) continue;
    for (let j = i + 1; j < measuredRows.length; j += 1) {
      const b = measuredRows[j];
      const bRect = b.lastRect;
      if (!bRect) continue;
      const overlap = rectOverlap(aRect, bRect);
      if (
        overlap.x <= VISUAL_LAYOUT_OVERLAP_WARN_PX ||
        overlap.y <= VISUAL_LAYOUT_OVERLAP_WARN_PX
      ) {
        continue;
      }
      measuredOverlapCount += 1;
      const aRow = rowsByKey.get(a.itemKey);
      const bRow = rowsByKey.get(b.itemKey);
      if (aRow) {
        incrementVisualCount(aRow, 'overlapCount');
        appendVisualFlag(aRow, `overlap:${b.itemKey.slice(0, 18)}`);
      }
      if (bRow) {
        incrementVisualCount(bRow, 'overlapCount');
        appendVisualFlag(bRow, `overlap:${a.itemKey.slice(0, 18)}`);
      }
    }
  }

  let measuredOrderBreakCount = 0;
  const indexedMeasuredRows = measuredRows
    .filter((record) => record.lastRect && Number.isFinite(record.getConfig().index))
    .sort((a, b) => Number(a.getConfig().index ?? 0) - Number(b.getConfig().index ?? 0));
  let previousIndexed: VisualRecord | null = null;
  for (const record of indexedMeasuredRows) {
    const rect = record.lastRect;
    const previousRect = previousIndexed?.lastRect ?? null;
    if (rect && previousRect && rect.y < previousRect.y - VISUAL_LAYOUT_OVERLAP_WARN_PX) {
      measuredOrderBreakCount += 1;
      const row = rowsByKey.get(record.itemKey);
      if (row) appendVisualFlag(row, `orderBreak:${round(rect.y - previousRect.y)}`);
    }
    previousIndexed = record;
  }

  let containerViolationCount = 0;
  for (const record of measuredRows) {
    if (!record.lastRect) continue;
    const violations = findContainerViolations(scope, record.itemKey, record.lastRect);
    if (violations.length === 0) continue;
    containerViolationCount += violations.length;
    const row = rowsByKey.get(record.itemKey);
    if (!row) continue;
    row.outsideContainer = true;
    row.containerViolationCount = violations.length;
    appendVisualFlag(row, `outsideContainer:${violations.length}`);
  }

  const zeroAreaCount = rows.filter((row) => row.zeroArea === true).length;
  const farOutsideXCount = rows.filter((row) => row.farOutsideX === true).length;
  const farOutsideYCount = rows.filter((row) => row.farOutsideY === true).length;
  const absurdWidthCount = rows.filter((row) => row.absurdWidth === true).length;
  const absurdHeightCount = rows.filter((row) => row.absurdHeight === true).length;
  const unmeasuredRows = rows.filter((row) => row.x == null || row.y == null).length;
  const staleRows = rows.filter((row) => {
    const flags = Array.isArray(row.flags) ? row.flags : [];
    return flags.includes('stale');
  }).length;
  const visibleRows = rows.filter((row) => row.visible === true).length;
  const containerRows = rows.filter((row) => row.isContainer === true).length;
  const snapshotAnomaly =
    measuredOverlapCount > 0 ||
    measuredOrderBreakCount > 0 ||
    containerViolationCount > 0 ||
    zeroAreaCount > 0 ||
    farOutsideXCount > 0 ||
    farOutsideYCount > 0 ||
    absurdWidthCount > 0 ||
    absurdHeightCount > 0;

  return {
    rows: rows.sort((a, b) => {
      const aIndex = finiteNumber(a.index);
      const bIndex = finiteNumber(b.index);
      if (aIndex != null && bIndex != null && aIndex !== bIndex) return aIndex - bIndex;
      if (aIndex != null && bIndex == null) return -1;
      if (aIndex == null && bIndex != null) return 1;
      return (finiteNumber(a.y) ?? 0) - (finiteNumber(b.y) ?? 0);
    }),
    summary: {
      totalRows: rows.length,
      measuredRows: rows.length - unmeasuredRows,
      unmeasuredRows,
      staleRows,
      visibleRows,
      containerRows,
      measuredOverlapCount,
      measuredOrderBreakCount,
      containerViolationCount,
      zeroAreaCount,
      farOutsideXCount,
      farOutsideYCount,
      absurdWidthCount,
      absurdHeightCount,
      snapshotAnomaly,
    },
  };
}

function emitVisualLayoutScopeSnapshot(
  scope: string,
  reason: string,
  measuredRequested: number,
  extra?: Record<string, unknown>
): void {
  const nowMs = monotonicNow();
  const snapshot = visualScopeSnapshotRows(scope, nowMs);
  if (!snapshot) return;
  const chunkCount = Math.max(
    1,
    Math.ceil(snapshot.rows.length / VISUAL_SCOPE_SNAPSHOT_CHUNK_SIZE)
  );

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const start = chunkIndex * VISUAL_SCOPE_SNAPSHOT_CHUNK_SIZE;
    const rows = snapshot.rows.slice(start, start + VISUAL_SCOPE_SNAPSHOT_CHUNK_SIZE);
    feedLog[snapshot.summary.snapshotAnomaly === true ? 'warn' : 'info'](
      'visual.layout.scope_snapshot',
      {
        scope,
        reason,
        measuredRequested,
        chunkIndex,
        chunkCount,
        rowCount: rows.length,
        ...snapshot.summary,
        rows,
        ...extra,
      }
    );
  }
}

function visualStateSignature(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'number') return Number.isFinite(value) ? String(round(value)) : 'NaN';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(visualStateSignature).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${key}:${visualStateSignature(record[key])}`)
      .join(',')}}`;
  }
  return String(value);
}

function visualStateRemeasureOptions(
  remeasure: VisualStateConfig['remeasure']
): VisualStateRemeasureOptions | null {
  if (!remeasure) return null;
  if (remeasure === true) return { enabled: true };
  if (remeasure.enabled === false) return null;
  return remeasure;
}

export function useVisualStateLogger(config: VisualStateConfig): void {
  const configRef = useRef(config);
  const lastSignatureRef = useRef<string | null>(null);
  configRef.current = config;

  const signature = visualStateSignature(config.state);

  useEffect(() => {
    const current = configRef.current;
    if (!visualLoggingEnabled(current.enabled)) return;

    const previousSignature = lastSignatureRef.current;
    if (previousSignature === signature) return;
    lastSignatureRef.current = signature;

    const extra = resolveExtra(current.extra);
    feedLog.info('visual.layout.state_change', {
      scope: current.scope,
      surface: current.surface,
      component: current.component,
      stateKey: current.stateKey,
      phase: current.phase ?? null,
      signature,
      previousSignature,
      firstMeasure: previousSignature == null,
      state: current.state,
      ...extra,
    });

    const remeasureOptions = visualStateRemeasureOptions(current.remeasure);
    if (!remeasureOptions) return;
    requestAnimationFrame(() => {
      remeasureVisualLayoutScope(
        current.scope,
        remeasureOptions.reason ?? `state:${current.stateKey}`,
        {
          minIntervalMs: remeasureOptions.minIntervalMs ?? 200,
          maxItems: remeasureOptions.maxItems ?? 40,
          extra: {
            stateKey: current.stateKey,
            phase: current.phase ?? null,
            stateSignature: signature,
            ...extra,
          },
        }
      );
    });
  }, [signature]);
}

export function useVisualListLogger<ItemT>(
  config: VisualListConfig<ItemT>
): VisualListReporter<ItemT> {
  const configRef = useRef(config);
  const lastMetricsRef = useRef<VisualListMetrics | null>(null);
  const lastViewabilityLogAtRef = useRef(0);
  configRef.current = config;

  const baseParams = useCallback(() => {
    const current = configRef.current;
    return {
      scope: current.scope,
      surface: current.surface,
      component: current.component,
      phase: current.phase ?? null,
      ...resolveExtra(current.extra),
    };
  }, []);

  const onItemSizeChanged = useCallback(
    (info: VisualListItemSizeInfo<ItemT>) => {
      const current = configRef.current;
      if (!visualLoggingEnabled(current.enabled)) return;
      const itemKey = current.getItemKey?.(info.itemData, info.index, info.itemKey) ?? info.itemKey;
      const state = current.getListState?.() ?? null;
      const delta = info.size - info.previous;
      const firstMeasure = info.previous <= 0;
      const sizeJump = !firstMeasure && Math.abs(delta) >= VISUAL_LIST_SIZE_JUMP_WARN_PX;
      const invalidSize = !Number.isFinite(info.size) || info.size <= 0;
      const params = {
        ...baseParams(),
        key: safeLogKey(itemKey),
        index: info.index,
        itemSize: round(info.size),
        previousItemSize: firstMeasure ? null : round(info.previous),
        deltaItemSize: firstMeasure ? null : round(delta),
        firstMeasure,
        sizeJump,
        invalidSize,
        ...visualVirtualMetrics(state, itemKey, info.index),
        ...current.getItemContext?.(info.itemData, info.index),
      };
      feedLog[sizeJump || invalidSize ? 'warn' : 'info']('visual.layout.item_size_changed', params);
    },
    [baseParams]
  );

  const onLoad = useCallback(
    (info: VisualListLoadInfo) => {
      if (!visualLoggingEnabled(configRef.current.enabled)) return;
      feedLog.info('visual.layout.list_load', {
        ...baseParams(),
        elapsedMs: round(info.elapsedTimeInMs),
      });
    },
    [baseParams]
  );

  const onMetricsChange = useCallback(
    (metrics: VisualListMetrics) => {
      const current = configRef.current;
      if (!visualLoggingEnabled(current.enabled)) return;
      const state = current.getListState?.() ?? null;
      const previous = lastMetricsRef.current;
      lastMetricsRef.current = metrics;
      const size = numericMetric(metrics, 'size');
      const scroll = numericMetric(metrics, 'scroll');
      const scrollLength = numericMetric(metrics, 'scrollLength');
      const contentLength = numericMetric(metrics, 'contentLength');
      const previousSize = previous ? numericMetric(previous, 'size') : null;
      const previousScroll = previous ? numericMetric(previous, 'scroll') : null;
      const previousScrollLength = previous ? numericMetric(previous, 'scrollLength') : null;
      const previousContentLength = previous ? numericMetric(previous, 'contentLength') : null;
      const deltaSize = size != null && previousSize != null ? size - previousSize : null;
      const deltaScroll = scroll != null && previousScroll != null ? scroll - previousScroll : null;
      const deltaScrollLength =
        scrollLength != null && previousScrollLength != null
          ? scrollLength - previousScrollLength
          : null;
      const deltaContentLength =
        contentLength != null && previousContentLength != null
          ? contentLength - previousContentLength
          : null;
      const metricJump =
        (deltaSize != null && Math.abs(deltaSize) >= VISUAL_LIST_METRIC_JUMP_WARN_PX) ||
        (deltaScrollLength != null &&
          Math.abs(deltaScrollLength) >= VISUAL_LIST_METRIC_JUMP_WARN_PX) ||
        (deltaContentLength != null &&
          Math.abs(deltaContentLength) >= VISUAL_LIST_METRIC_JUMP_WARN_PX);

      feedLog[metricJump ? 'warn' : 'info']('visual.layout.list_metrics', {
        ...baseParams(),
        size: size == null ? null : round(size),
        scroll: scroll == null ? null : round(scroll),
        scrollLength: scrollLength == null ? null : round(scrollLength),
        contentLength: contentLength == null ? null : round(contentLength),
        deltaSize: deltaSize == null ? null : round(deltaSize),
        deltaScroll: deltaScroll == null ? null : round(deltaScroll),
        deltaScrollLength: deltaScrollLength == null ? null : round(deltaScrollLength),
        deltaContentLength: deltaContentLength == null ? null : round(deltaContentLength),
        firstMeasure: previous == null,
        metricJump,
        ...visualListStateSnapshot(state),
      });
    },
    [baseParams]
  );

  const onStickyHeaderChange = useCallback(
    (info: VisualStickyHeaderInfo<ItemT>) => {
      const current = configRef.current;
      if (!visualLoggingEnabled(current.enabled)) return;
      const fallbackKey = `sticky:${info.index}`;
      const itemContext = current.getItemContext?.(info.item, info.index) ?? {};
      const itemKey =
        current.getItemKey?.(info.item, info.index, fallbackKey) ??
        contextRowKey(itemContext) ??
        fallbackKey;
      const state = current.getListState?.() ?? null;
      const params = {
        ...baseParams(),
        index: info.index,
        key: safeLogKey(itemKey),
        ...visualListStateSnapshot(state),
        ...visualVirtualMetrics(state, itemKey, info.index),
        ...safeContextKeys(itemContext),
      };
      feedLog.info('visual.layout.sticky_header', params);
      requestAnimationFrame(() => {
        remeasureVisualLayoutScope(current.scope, 'sticky-header', {
          minIntervalMs: 200,
          maxItems: 40,
          extra: {
            stickyIndex: info.index,
            stickyKey: itemKey,
            stickyItemType: itemContext.itemType ?? null,
          },
        });
      });
    },
    [baseParams]
  );

  const onViewableItemsChanged = useCallback(
    (info: VisualViewabilityInfo<ItemT>) => {
      const nowMs = monotonicNow();
      if (nowMs - lastViewabilityLogAtRef.current < VISUAL_LIST_VIEWABILITY_LOG_INTERVAL_MS) return;
      lastViewabilityLogAtRef.current = nowMs;
      const current = configRef.current;
      if (!visualLoggingEnabled(current.enabled)) return;
      const state = current.getListState?.() ?? null;
      const buffered = visualBufferedRangeSummary(state, current, current.scope);
      const virtualPositionChunks = visualVirtualPositionChunks(state, current, current.scope);
      feedLog.info('visual.layout.viewability', {
        ...baseParams(),
        ...visualListStateSnapshot(state),
        start: info.start,
        end: info.end,
        startBuffered: info.startBuffered,
        endBuffered: info.endBuffered,
        viewableCount: info.viewableItems.length,
        changedCount: info.changed.length,
        bufferedCount: buffered.length,
        viewable: viewTokenSummary(info.viewableItems, current, state),
        changed: viewTokenSummary(info.changed, current, state),
        buffered,
      });
      for (const chunk of virtualPositionChunks) {
        feedLog[chunk.summary.virtualAnomaly ? 'warn' : 'info']('visual.layout.virtual_positions', {
          ...baseParams(),
          ...visualListStateSnapshot(state),
          totalRows: chunk.totalRows,
          chunkIndex: chunk.chunkIndex,
          chunkCount: chunk.chunkCount,
          rowCount: chunk.rows.length,
          ...chunk.summary,
          rows: chunk.rows,
        });
      }
    },
    [baseParams]
  );

  return {
    onItemSizeChanged,
    onLoad,
    onMetricsChange,
    onStickyHeaderChange,
    onViewableItemsChanged,
  };
}

export function useVisualScrollMetricsLogger(
  config: VisualScrollMetricsConfig
): VisualScrollMetricsReporter {
  const configRef = useRef(config);
  const reasonRef = useRef('init');
  const metricsRef = useRef<VisualScrollMetricsSnapshot>({
    contentHeight: null,
    contentWidth: null,
    offsetX: 0,
    offsetY: 0,
    viewportHeight: null,
    viewportWidth: null,
  });
  configRef.current = config;

  const { onMetricsChange } = useVisualListLogger<never>({
    enabled: config.enabled,
    scope: config.scope,
    surface: config.surface,
    component: config.component,
    phase: config.phase,
    extra: () => {
      const current = configRef.current;
      const metrics = metricsRef.current;
      return {
        axis: current.axis ?? 'y',
        scrollReason: reasonRef.current,
        contentWidth: metrics.contentWidth == null ? null : round(metrics.contentWidth),
        contentHeight: metrics.contentHeight == null ? null : round(metrics.contentHeight),
        viewportWidth: metrics.viewportWidth == null ? null : round(metrics.viewportWidth),
        viewportHeight: metrics.viewportHeight == null ? null : round(metrics.viewportHeight),
        ...resolveExtra(current.extra),
      };
    },
  });

  const reportNow = useCallback(
    (reason: string) => {
      reasonRef.current = reason;
      const metrics = metricsRef.current;
      const axis = configRef.current.axis ?? 'y';
      const viewportLength = axis === 'x' ? metrics.viewportWidth : metrics.viewportHeight;
      const contentLength = axis === 'x' ? metrics.contentWidth : metrics.contentHeight;
      const scroll = axis === 'x' ? metrics.offsetX : metrics.offsetY;
      onMetricsChange({
        size: viewportLength,
        scroll,
        scrollLength: viewportLength,
        contentLength,
      });
    },
    [onMetricsChange]
  );

  const onContentSizeChange = useCallback(
    (width: number, height: number) => {
      metricsRef.current.contentWidth = width;
      metricsRef.current.contentHeight = height;
      reportNow('content-size');
    },
    [reportNow]
  );

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      metricsRef.current.viewportWidth = event.nativeEvent.layout.width;
      metricsRef.current.viewportHeight = event.nativeEvent.layout.height;
      reportNow('layout');
    },
    [reportNow]
  );

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      metricsRef.current = {
        contentHeight: contentSize.height,
        contentWidth: contentSize.width,
        offsetX: contentOffset.x,
        offsetY: contentOffset.y,
        viewportHeight: layoutMeasurement.height,
        viewportWidth: layoutMeasurement.width,
      };
      reportNow('scroll');
    },
    [reportNow]
  );

  return { onContentSizeChange, onLayout, onScroll, reportNow };
}

export function useVisualLayoutLogger(config: VisualLayoutConfig): VisualLayoutReporter {
  const viewport = useWindowDimensions();
  const viewportRef = useRef(viewport);
  const nodeRef = useRef<MeasureableNode | null>(null);
  const localRectRef = useRef<LayoutRect | null>(null);
  const lastRectRef = useRef<LayoutRect | null>(null);
  const mountOrderRef = useRef<number | null>(null);
  if (mountOrderRef.current === null) {
    visualLayoutMountSequence += 1;
    mountOrderRef.current = visualLayoutMountSequence;
  }
  const configRef = useRef(config);
  configRef.current = config;
  viewportRef.current = viewport;

  const setRef = useCallback((node: MeasureableNode | null) => {
    nodeRef.current = node;
  }, []);

  const measureNow = useCallback((reason: string, extraOverride?: Record<string, unknown>) => {
    const node = nodeRef.current;
    const current = configRef.current;
    const localRect = localRectRef.current;

    if (!visualLoggingEnabled(current.enabled)) return;

    if (!node?.measureInWindow) {
      const isContainer = isContainerLikeConfig(current);
      feedLog.warn('visual.layout.unmeasurable', {
        scope: current.scope,
        surface: current.surface,
        component: current.component,
        key: safeLogKey(current.itemKey),
        itemType: current.itemType ?? null,
        isContainer,
        index: current.index ?? null,
        reason,
        mountOrder: mountOrderRef.current,
        hasNode: !!node,
      });
      return;
    }

    requestAnimationFrame(() => {
      node.measureInWindow?.((x, y, width, height) => {
        const windowRect = { x, y, width, height };
        const measuredAt = monotonicNow();
        if (!validRect(windowRect)) {
          feedLog.warn('visual.layout.invalid', {
            scope: current.scope,
            surface: current.surface,
            component: current.component,
            key: safeLogKey(current.itemKey),
            itemType: current.itemType ?? null,
            index: current.index ?? null,
            reason,
            x,
            y,
            width,
            height,
          });
          return;
        }

        const prev = lastRectRef.current;
        lastRectRef.current = windowRect;
        const registryKey = visualRecordKey(current.scope, current.itemKey);
        const record = VISUAL_SCOPE_REGISTRY.get(current.scope)?.get(registryKey);
        const isContainer = isContainerLikeConfig(current);
        const viewport = viewportRef.current;
        if (record) {
          record.isContainer = isContainer;
          record.lastRect = windowRect;
          record.lastMeasuredAt = measuredAt;
          record.lastViewport = { width: viewport.width, height: viewport.height };
        }

        const flags = viewportFlags(windowRect, viewport);
        const deltaX = prev ? windowRect.x - prev.x : null;
        const deltaY = prev ? windowRect.y - prev.y : null;
        const deltaWidth = prev ? windowRect.width - prev.width : null;
        const deltaHeight = prev ? windowRect.height - prev.height : null;
        const overlaps = findOverlaps(
          current.scope,
          current.itemKey,
          windowRect,
          isContainer,
          current.index ?? null
        );
        const containerViolations = findContainerViolations(
          current.scope,
          current.itemKey,
          windowRect
        );
        const jumpX = typeof deltaX === 'number' && Math.abs(deltaX) >= VISUAL_LAYOUT_JUMP_WARN_PX;
        const jumpY = typeof deltaY === 'number' && Math.abs(deltaY) >= VISUAL_LAYOUT_JUMP_WARN_PX;
        const anomalous =
          flags.zeroArea ||
          flags.farOutsideX ||
          flags.farOutsideY ||
          flags.absurdWidth ||
          flags.absurdHeight ||
          jumpX ||
          jumpY ||
          overlaps.length > 0 ||
          containerViolations.length > 0;

        const params = {
          scope: current.scope,
          surface: current.surface,
          component: current.component,
          key: safeLogKey(current.itemKey),
          itemType: current.itemType ?? null,
          isContainer,
          index: current.index ?? null,
          phase: current.phase ?? null,
          reason,
          mountOrder: mountOrderRef.current,
          localX: localRect ? round(localRect.x) : null,
          localY: localRect ? round(localRect.y) : null,
          localW: localRect ? round(localRect.width) : null,
          localH: localRect ? round(localRect.height) : null,
          pageX: round(windowRect.x),
          pageY: round(windowRect.y),
          width: round(windowRect.width),
          height: round(windowRect.height),
          bottom: round(rectBottom(windowRect)),
          right: round(rectRight(windowRect)),
          viewportW: round(viewport.width),
          viewportH: round(viewport.height),
          visible: flags.visible,
          offscreenTop: flags.offscreenTop,
          offscreenBottom: flags.offscreenBottom,
          offscreenLeft: flags.offscreenLeft,
          offscreenRight: flags.offscreenRight,
          deltaX: deltaX == null ? null : round(deltaX),
          deltaY: deltaY == null ? null : round(deltaY),
          deltaWidth: deltaWidth == null ? null : round(deltaWidth),
          deltaHeight: deltaHeight == null ? null : round(deltaHeight),
          firstMeasure: prev == null,
          farOutsideX: flags.farOutsideX,
          farOutsideY: flags.farOutsideY,
          absurdWidth: flags.absurdWidth,
          absurdHeight: flags.absurdHeight,
          zeroArea: flags.zeroArea,
          jumpX,
          jumpY,
          overlaps,
          overlapCount: overlaps.length,
          outsideContainer: containerViolations.length > 0,
          containerViolations,
          containerViolationCount: containerViolations.length,
          ...resolveExtra(current.extra),
          ...extraOverride,
        };

        feedLog[anomalous ? 'warn' : 'info']('visual.layout.measure', params);
      });
    });
  }, []);

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      if (!visualLoggingEnabled(configRef.current.enabled)) return;
      const { x, y, width, height } = event.nativeEvent.layout;
      localRectRef.current = { x, y, width, height };
      measureNow('layout');
    },
    [measureNow]
  );

  useEffect(() => {
    const current = configRef.current;
    if (!visualLoggingEnabled(current.enabled)) return;
    const registryKey = visualRecordKey(current.scope, current.itemKey);
    const record: VisualRecord = {
      scope: current.scope,
      itemKey: current.itemKey,
      getConfig: () => configRef.current,
      getNode: () => nodeRef.current,
      mountOrder: mountOrderRef.current ?? 0,
      isContainer: isContainerLikeConfig(current),
      measure: measureNow,
      lastRect: null,
      lastMeasuredAt: 0,
      lastViewport: null,
    };
    scopeRecords(current.scope).set(registryKey, record);
    return () => {
      VISUAL_SCOPE_REGISTRY.get(current.scope)?.delete(registryKey);
      pruneScope(current.scope);
    };
  }, [config.enabled, config.itemKey, config.scope, measureNow]);

  return { ref: setRef, onLayout, measureNow };
}

export function remeasureVisualLayoutScope(
  scope: string,
  reason: string,
  options: { minIntervalMs?: number; maxItems?: number; extra?: Record<string, unknown> } = {}
): void {
  const nowMs = monotonicNow();
  const minIntervalMs = options.minIntervalMs ?? 350;
  const last = VISUAL_SCOPE_LAST_REMEASURE_AT.get(scope) ?? 0;
  if (nowMs - last < minIntervalMs) return;
  VISUAL_SCOPE_LAST_REMEASURE_AT.set(scope, nowMs);

  const records = VISUAL_SCOPE_REGISTRY.get(scope);
  if (!records) return;
  const maxItems = options.maxItems ?? 40;
  let measured = 0;
  for (const record of records.values()) {
    if (!record.getNode()) continue;
    record.measure(reason, options.extra);
    measured += 1;
    if (measured >= maxItems) break;
  }

  feedLog.info('visual.layout.scope_remeasure', {
    scope,
    reason,
    mounted: records.size,
    measured,
    ...options.extra,
  });
  requestAnimationFrame(() => {
    emitVisualLayoutScopeSnapshot(scope, reason, measured, options.extra);
  });
}
