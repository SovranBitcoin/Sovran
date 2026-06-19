/**
 * @jest-environment node
 *
 * `useShiftLogger` is the change-gated reporter behind every `*.shift.*`
 * content-shift log (feed rows, images, thread phases, reply bar, composer).
 * Its whole value is that it only emits on a *real* change and tags each entry
 * with prev/delta/firstMeasure — so these tests lock that contract.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import {
  remeasureVisualLayoutScope,
  useShiftLogger,
  useVisualLayoutLogger,
  useVisualListLogger,
  useVisualScrollMetricsLogger,
  useVisualStateLogger,
  visualLayoutScopePart,
  urlHost,
} from '@/shared/lib/contentShiftLog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const rafQueue: FrameRequestCallback[] = [];
(
  globalThis as { requestAnimationFrame?: (cb: FrameRequestCallback) => number }
).requestAnimationFrame = (cb) => {
  rafQueue.push(cb);
  return rafQueue.length;
};

function flushRaf(): void {
  while (rafQueue.length > 0) {
    rafQueue.shift()?.(0);
  }
}

const mockInfo = jest.fn();
const mockWarn = jest.fn();
const mockIsLevelEnabled = jest.fn((_level: string) => true);
jest.mock('@/shared/lib/logger', () => ({
  monotonicNow: jest.fn(() => Date.now()),
  feedLog: {
    info: (event: string, params?: Record<string, unknown>) => mockInfo(event, params),
    warn: (event: string, params?: Record<string, unknown>) => mockWarn(event, params),
    isLevelEnabled: (level: string) => mockIsLevelEnabled(level),
  },
}));

/** Drives a reporter from outside React so a test can fire reports in order. */
function harness(): { report: ReturnType<typeof useShiftLogger>['report'] } {
  const ref: { report: ReturnType<typeof useShiftLogger>['report'] } = {
    report: () => undefined,
  };
  function Probe() {
    const logger = useShiftLogger('Probe');
    ref.report = logger.report;
    return null;
  }
  act(() => {
    TestRenderer.create(<Probe />);
  });
  return ref;
}

type VisualHarness = ReturnType<typeof useVisualLayoutLogger>;
type VisualListHarness = ReturnType<typeof useVisualListLogger<{ id: string; type: string }>>;
type VisualScrollHarness = ReturnType<typeof useVisualScrollMetricsLogger>;
// Test-only host target for NativeSyntheticEvent; the hook only reads nativeEvent.layout.
// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
const EVENT_TARGET = {} as Parameters<VisualHarness['onLayout']>[0]['target'];

function visualHarness(input: {
  itemKey: string;
  scope?: string;
  component?: string;
  enabled?: boolean;
  index?: number;
  isContainer?: boolean;
  itemType?: string;
}): {
  visual: VisualHarness;
  setRect: (rect: { x: number; y: number; w: number; h: number }) => void;
} {
  let rect = { x: 0, y: 0, w: 100, h: 40 };
  const node = {
    measureInWindow: (cb: (x: number, y: number, width: number, height: number) => void) => {
      cb(rect.x, rect.y, rect.w, rect.h);
    },
  };
  const ref: { visual: VisualHarness | null } = { visual: null };
  function Probe() {
    const visual = useVisualLayoutLogger({
      enabled: input.enabled,
      scope: input.scope ?? 'test.scope',
      surface: 'test',
      component: input.component ?? 'Probe',
      itemKey: input.itemKey,
      itemType: input.itemType ?? 'row',
      isContainer: input.isContainer,
      index: input.index ?? 0,
    });
    ref.visual = visual;
    return null;
  }
  act(() => {
    TestRenderer.create(<Probe />);
  });
  act(() => {
    ref.visual?.ref(node);
  });
  return {
    visual: ref.visual as VisualHarness,
    setRect: (next) => {
      rect = next;
    },
  };
}

function layoutEvent(width: number, height: number): Parameters<VisualHarness['onLayout']>[0] {
  const event: Parameters<VisualHarness['onLayout']>[0] = {
    nativeEvent: {
      layout: { x: 0, y: 0, width, height },
    },
    currentTarget: EVENT_TARGET,
    target: EVENT_TARGET,
    bubbles: false,
    cancelable: false,
    defaultPrevented: false,
    eventPhase: 0,
    isTrusted: false,
    preventDefault: jest.fn(),
    isDefaultPrevented: () => false,
    stopPropagation: jest.fn(),
    isPropagationStopped: () => false,
    persist: jest.fn(),
    timeStamp: 0,
    type: 'layout',
  };
  return event;
}

function visualListHarness(
  input: {
    safeKeys?: boolean;
    listState?: {
      activeStickyIndex?: number;
      contentLength?: number;
      data?: readonly { id: string; type: string }[];
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
  } = {}
): VisualListHarness {
  const ref: { visual: VisualListHarness | null } = { visual: null };
  function Probe() {
    const visual = useVisualListLogger<{ id: string; type: string }>({
      scope: 'test.list',
      surface: 'test',
      component: 'TestLegendList',
      phase: 'ready',
      extra: { rows: 2 },
      getItemKey: input.safeKeys ? (item, index) => `safe:${item.type}:${index}` : undefined,
      getItemContext: (item) => ({ rowKey: item.id, itemType: item.type }),
      ...(input.listState ? { getListState: () => input.listState } : {}),
    });
    ref.visual = visual;
    return null;
  }
  act(() => {
    TestRenderer.create(<Probe />);
  });
  return ref.visual as VisualListHarness;
}

function visualScrollHarness(axis: 'x' | 'y' = 'y'): VisualScrollHarness {
  const ref: { visual: VisualScrollHarness | null } = { visual: null };
  function Probe() {
    const visual = useVisualScrollMetricsLogger({
      scope: 'test.scroll',
      surface: 'test',
      component: 'TestScrollView',
      axis,
      phase: 'ready',
      extra: { rows: 0 },
    });
    ref.visual = visual;
    return null;
  }
  act(() => {
    TestRenderer.create(<Probe />);
  });
  return ref.visual as VisualScrollHarness;
}

function scrollEvent(input: {
  contentHeight: number;
  contentWidth: number;
  height: number;
  width: number;
  x: number;
  y: number;
}): Parameters<VisualScrollHarness['onScroll']>[0] {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return {
    nativeEvent: {
      contentInset: { bottom: 0, left: 0, right: 0, top: 0 },
      contentOffset: { x: input.x, y: input.y },
      contentSize: { height: input.contentHeight, width: input.contentWidth },
      layoutMeasurement: { height: input.height, width: input.width },
      responderIgnoreScroll: false,
      velocity: { x: 0, y: 0 },
      zoomScale: 1,
    },
    currentTarget: EVENT_TARGET,
    target: EVENT_TARGET,
    bubbles: false,
    cancelable: false,
    defaultPrevented: false,
    eventPhase: 0,
    isTrusted: false,
    preventDefault: jest.fn(),
    isDefaultPrevented: () => false,
    stopPropagation: jest.fn(),
    isPropagationStopped: () => false,
    persist: jest.fn(),
    timeStamp: 0,
    type: 'scroll',
  } as Parameters<VisualScrollHarness['onScroll']>[0];
}

beforeEach(() => {
  rafQueue.length = 0;
  mockInfo.mockClear();
  mockWarn.mockClear();
  mockIsLevelEnabled.mockReset();
  mockIsLevelEnabled.mockReturnValue(true);
});

describe('useShiftLogger.report', () => {
  it('logs the first measurement with firstMeasure and null prev/delta', () => {
    const { report } = harness();
    act(() => report('feed.shift.note.height', 'evt1', 120));

    expect(mockInfo).toHaveBeenCalledTimes(1);
    const [event, params] = mockInfo.mock.calls[0];
    expect(event).toBe('feed.shift.note.height');
    expect(params).toMatchObject({
      component: 'Probe',
      key: 'evt1',
      value: 120,
      prev: null,
      delta: null,
      firstMeasure: true,
    });
  });

  it('does not log when the value is unchanged (sub-pixel)', () => {
    const { report } = harness();
    act(() => report('e', 'k', 100));
    act(() => report('e', 'k', 100.2)); // within epsilon
    expect(mockInfo).toHaveBeenCalledTimes(1);
  });

  it('logs a real shift with prev and signed delta', () => {
    const { report } = harness();
    act(() => report('e', 'k', 100));
    act(() => report('e', 'k', 160));
    act(() => report('e', 'k', 140));

    expect(mockInfo).toHaveBeenCalledTimes(3);
    expect(mockInfo.mock.calls[1][1]).toMatchObject({
      prev: 100,
      value: 160,
      delta: 60,
      firstMeasure: false,
    });
    expect(mockInfo.mock.calls[2][1]).toMatchObject({
      prev: 160,
      value: 140,
      delta: -20,
      firstMeasure: false,
    });
  });

  it('tracks each key independently', () => {
    const { report } = harness();
    act(() => report('e', 'a', 10));
    act(() => report('e', 'b', 20));
    act(() => report('e', 'a', 10)); // unchanged for a
    expect(mockInfo).toHaveBeenCalledTimes(2);
  });

  it('merges surface-specific extra params and ignores non-finite values', () => {
    const { report } = harness();
    act(() => report('feed.shift.image.aspect', 'url', 1.5, { host: 'i.example' }));
    act(() => report('e', 'k', Number.NaN));
    expect(mockInfo).toHaveBeenCalledTimes(1);
    expect(mockInfo.mock.calls[0][1]).toMatchObject({ host: 'i.example', value: 1.5 });
  });
});

describe('useVisualLayoutLogger', () => {
  it('logs measured viewport geometry for a layout pass', () => {
    const { visual, setRect } = visualHarness({ itemKey: 'row-1' });
    setRect({ x: 8, y: 120, w: 320, h: 72 });

    act(() => visual.onLayout(layoutEvent(320, 72)));
    act(() => flushRaf());

    expect([...mockInfo.mock.calls, ...mockWarn.mock.calls]).toEqual(
      expect.arrayContaining([
        [
          'visual.layout.measure',
          expect.objectContaining({
            scope: 'test.scope',
            surface: 'test',
            component: 'Probe',
            key: 'row-1',
            mountOrder: expect.any(Number),
            pageX: 8,
            pageY: 120,
            width: 320,
            height: 72,
            firstMeasure: true,
          }),
        ],
      ])
    );
  });

  // Regression: a bare 64-hex Nostr id used as a row key (HomeFeedRow,
  // composer ReplyOriginalPost) is rewritten by the logger's `hex32` redactor to
  // `{ _kind: 'hex32' }` (renders as `[object Object]`), which destroys
  // measured↔virtual correlation in log-doctor. The emitted key must be a stable
  // short string instead.
  it('shortens a bare-hex row key so the secret redactor cannot strip it', () => {
    const hexId = 'abcdef0123456789'.repeat(4); // 64 hex chars
    const { visual, setRect } = visualHarness({ itemKey: hexId, component: 'HomeFeedRow' });
    setRect({ x: 0, y: 0, w: 320, h: 200 });

    act(() => visual.onLayout(layoutEvent(320, 200)));
    act(() => flushRaf());

    const measure = [...mockInfo.mock.calls, ...mockWarn.mock.calls].find(
      ([event]) => event === 'visual.layout.measure'
    );
    expect(measure?.[1]).toEqual(expect.objectContaining({ key: `h_${hexId.slice(0, 16)}` }));
    expect(typeof (measure?.[1] as { key: unknown }).key).toBe('string');
  });

  it('can disable layout measurement without changing hook shape', () => {
    const { visual, setRect } = visualHarness({ itemKey: 'row-disabled', enabled: false });
    setRect({ x: 8, y: 120, w: 320, h: 72 });

    act(() => visual.onLayout(layoutEvent(320, 72)));
    act(() => flushRaf());
    act(() => visual.measureNow('manual'));
    act(() => flushRaf());

    expect(mockInfo).not.toHaveBeenCalledWith('visual.layout.measure', expect.anything());
    expect(mockWarn).not.toHaveBeenCalledWith('visual.layout.measure', expect.anything());
    expect(mockWarn).not.toHaveBeenCalledWith('visual.layout.unmeasurable', expect.anything());
  });

  it('skips native measurement when visual logging is disabled', () => {
    mockIsLevelEnabled.mockReturnValue(false);
    const { visual, setRect } = visualHarness({ itemKey: 'row-logger-disabled' });
    setRect({ x: 8, y: 120, w: 320, h: 72 });

    act(() => visual.onLayout(layoutEvent(320, 72)));
    act(() => flushRaf());
    act(() => visual.measureNow('manual'));
    act(() => flushRaf());

    expect(mockInfo).not.toHaveBeenCalled();
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('warns when two rows in the same scope overlap', () => {
    const first = visualHarness({
      itemKey: 'row-a',
      scope: 'overlap.scope',
      component: 'RowA',
      index: 0,
    });
    const second = visualHarness({
      itemKey: 'row-b',
      scope: 'overlap.scope',
      component: 'RowB',
      index: 1,
    });
    first.setRect({ x: 0, y: 100, w: 320, h: 80 });
    second.setRect({ x: 0, y: 140, w: 320, h: 80 });

    act(() => first.visual.onLayout(layoutEvent(320, 80)));
    act(() => flushRaf());
    act(() => second.visual.onLayout(layoutEvent(320, 80)));
    act(() => flushRaf());

    expect(mockWarn).toHaveBeenCalledWith(
      'visual.layout.measure',
      expect.objectContaining({
        scope: 'overlap.scope',
        key: 'row-b',
        overlapCount: 1,
        overlaps: expect.arrayContaining([
          expect.objectContaining({
            key: 'row-a',
            component: 'RowA',
            mountOrder: expect.any(Number),
          }),
        ]),
      })
    );
  });

  // Regression: a recycled `reply-skeleton` slot becoming a real `reply` leaves
  // a stale record at the SAME list index within TTL. That row-identity
  // transition is not a visual stack and must not be reported as an overlap, or
  // it drowns out genuine overlaps in log-doctor.
  it('does not report an overlap between two records at the same list index', () => {
    const skeleton = visualHarness({
      itemKey: 'reply-skeleton-0',
      scope: 'sameindex.scope',
      component: 'ThreadRow',
      itemType: 'reply-skeleton',
      index: 3,
    });
    const reply = visualHarness({
      itemKey: 'r_0e34269dbf1f7533',
      scope: 'sameindex.scope',
      component: 'ThreadRow',
      itemType: 'reply',
      index: 3,
    });
    skeleton.setRect({ x: 0, y: 420, w: 320, h: 110 });
    reply.setRect({ x: 0, y: 420, w: 320, h: 110 });

    act(() => skeleton.visual.onLayout(layoutEvent(320, 110)));
    act(() => flushRaf());
    mockWarn.mockClear();
    act(() => reply.visual.onLayout(layoutEvent(320, 110)));
    act(() => flushRaf());

    const overlapWarn = mockWarn.mock.calls.find(
      ([event, params]) =>
        event === 'visual.layout.measure' && (params as { overlapCount?: number }).overlapCount! > 0
    );
    expect(overlapWarn).toBeUndefined();
  });

  it('warns when a measured row sits outside an instrumented container', () => {
    const container = visualHarness({
      itemKey: 'container',
      scope: 'container.scope',
      component: 'TestContainer',
      itemType: 'container',
      isContainer: true,
    });
    const child = visualHarness({
      itemKey: 'child-row',
      scope: 'container.scope',
      component: 'ChildRow',
      itemType: 'row',
    });
    container.setRect({ x: 0, y: 100, w: 320, h: 100 });
    child.setRect({ x: 0, y: 80, w: 320, h: 50 });

    act(() => container.visual.onLayout(layoutEvent(320, 100)));
    act(() => flushRaf());
    act(() => child.visual.onLayout(layoutEvent(320, 50)));
    act(() => flushRaf());

    expect(mockWarn).toHaveBeenCalledWith(
      'visual.layout.measure',
      expect.objectContaining({
        scope: 'container.scope',
        key: 'child-row',
        outsideContainer: true,
        overlapCount: 0,
        containerViolationCount: 1,
        containerViolations: expect.arrayContaining([
          expect.objectContaining({
            key: 'container',
            component: 'TestContainer',
            itemType: 'container',
            overflowTop: 20,
            overflowX: 0,
            overflowY: 20,
          }),
        ]),
      })
    );
  });

  it('emits a measured scope snapshot after an explicit scope remeasure', () => {
    const first = visualHarness({
      itemKey: 'row-a',
      scope: 'snapshot.scope',
      component: 'RowA',
      index: 0,
    });
    const second = visualHarness({
      itemKey: 'row-b',
      scope: 'snapshot.scope',
      component: 'RowB',
      index: 1,
    });
    first.setRect({ x: 0, y: 120, w: 320, h: 90 });
    second.setRect({ x: 0, y: 80, w: 320, h: 80 });

    act(() =>
      remeasureVisualLayoutScope('snapshot.scope', 'test-remeasure', {
        minIntervalMs: 0,
        extra: { trigger: 'unit-test' },
      })
    );
    act(() => flushRaf());

    expect(mockInfo).toHaveBeenCalledWith(
      'visual.layout.scope_remeasure',
      expect.objectContaining({
        scope: 'snapshot.scope',
        reason: 'test-remeasure',
        mounted: expect.any(Number),
        measured: 2,
        trigger: 'unit-test',
      })
    );
    expect(mockWarn).toHaveBeenCalledWith(
      'visual.layout.scope_snapshot',
      expect.objectContaining({
        scope: 'snapshot.scope',
        reason: 'test-remeasure',
        measuredRequested: 2,
        totalRows: expect.any(Number),
        measuredRows: expect.any(Number),
        measuredOverlapCount: 1,
        measuredOrderBreakCount: 1,
        snapshotAnomaly: true,
        trigger: 'unit-test',
        rows: expect.arrayContaining([
          expect.objectContaining({
            key: 'row-a',
            index: 0,
            y: 120,
            height: 90,
            flags: expect.arrayContaining(['overlap:row-b']),
          }),
          expect.objectContaining({
            key: 'row-b',
            index: 1,
            y: 80,
            height: 80,
            flags: expect.arrayContaining(['overlap:row-a', 'orderBreak:-40']),
          }),
        ]),
      })
    );
  });
});

describe('useVisualStateLogger', () => {
  function StateProbe({
    mediaCount,
    keyboardVisible,
  }: {
    mediaCount: number;
    keyboardVisible: boolean;
  }) {
    useVisualStateLogger({
      scope: 'state.scope',
      surface: 'test',
      component: 'StateProbe',
      stateKey: 'composer-state',
      phase: keyboardVisible ? 'typing' : 'editing',
      state: { mediaCount, keyboardVisible },
      remeasure: {
        reason: 'state-change',
        minIntervalMs: 0,
      },
    });
    return null;
  }

  it('logs state changes once per signature and can request a scope remeasure', () => {
    let renderer!: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(<StateProbe mediaCount={0} keyboardVisible={false} />);
    });
    act(() => flushRaf());
    act(() => {
      renderer.update(<StateProbe mediaCount={0} keyboardVisible={false} />);
    });
    act(() => flushRaf());
    act(() => {
      renderer.update(<StateProbe mediaCount={1} keyboardVisible={false} />);
    });
    act(() => flushRaf());

    const stateCalls = mockInfo.mock.calls.filter(
      ([event]) => event === 'visual.layout.state_change'
    );
    expect(stateCalls).toHaveLength(2);
    expect(stateCalls[0][1]).toEqual(
      expect.objectContaining({
        scope: 'state.scope',
        component: 'StateProbe',
        stateKey: 'composer-state',
        phase: 'editing',
        previousSignature: null,
        firstMeasure: true,
        state: { mediaCount: 0, keyboardVisible: false },
      })
    );
    expect(stateCalls[1][1]).toEqual(
      expect.objectContaining({
        firstMeasure: false,
        state: { mediaCount: 1, keyboardVisible: false },
      })
    );
  });
});

describe('useVisualListLogger', () => {
  it('logs list item size changes and warns on large jumps', () => {
    const visual = visualListHarness();

    act(() =>
      visual.onItemSizeChanged({
        size: 104,
        previous: 0,
        index: 0,
        itemKey: 'row-a',
        itemData: { id: 'row-a', type: 'note' },
      })
    );
    act(() =>
      visual.onItemSizeChanged({
        size: 240,
        previous: 104,
        index: 0,
        itemKey: 'row-a',
        itemData: { id: 'row-a', type: 'note' },
      })
    );

    expect(mockInfo).toHaveBeenCalledWith(
      'visual.layout.item_size_changed',
      expect.objectContaining({
        scope: 'test.list',
        key: 'row-a',
        itemSize: 104,
        firstMeasure: true,
        rowKey: 'row-a',
        itemType: 'note',
      })
    );
    expect(mockWarn).toHaveBeenCalledWith(
      'visual.layout.item_size_changed',
      expect.objectContaining({
        key: 'row-a',
        itemSize: 240,
        previousItemSize: 104,
        deltaItemSize: 136,
        sizeJump: true,
      })
    );
  });

  it('logs list metrics, load timing, and viewability ranges', () => {
    const visual = visualListHarness();

    act(() => visual.onLoad({ elapsedTimeInMs: 18.4 }));
    act(() =>
      visual.onMetricsChange({
        size: 720,
        scroll: 0,
        scrollLength: 1400,
        contentLength: 1600,
      })
    );
    act(() =>
      visual.onViewableItemsChanged({
        start: 0,
        end: 1,
        startBuffered: 0,
        endBuffered: 2,
        viewableItems: [
          {
            index: 0,
            key: 'row-a',
            isViewable: true,
            item: { id: 'row-a', type: 'note' },
            percentVisible: 100,
          },
        ],
        changed: [
          {
            index: 0,
            key: 'row-a',
            isViewable: true,
            item: { id: 'row-a', type: 'note' },
          },
        ],
      })
    );

    expect(mockInfo).toHaveBeenCalledWith(
      'visual.layout.list_load',
      expect.objectContaining({ scope: 'test.list', elapsedMs: 18.4 })
    );
    expect(mockInfo).toHaveBeenCalledWith(
      'visual.layout.list_metrics',
      expect.objectContaining({
        scope: 'test.list',
        size: 720,
        scrollLength: 1400,
        contentLength: 1600,
      })
    );
    expect(mockInfo).toHaveBeenCalledWith(
      'visual.layout.viewability',
      expect.objectContaining({
        scope: 'test.list',
        start: 0,
        end: 1,
        viewableCount: 1,
        viewable: [expect.objectContaining({ key: 'row-a', itemType: 'note' })],
      })
    );
  });

  it('logs sticky header changes with virtual position context', () => {
    const data = [
      { id: 'row-a', type: 'note' },
      { id: 'row-b', type: 'reply-tabs' },
    ] as const;
    const visual = visualListHarness({
      listState: {
        activeStickyIndex: 1,
        contentLength: 260,
        data,
        positionByKey: (key) => ({ 'row-a': 0, 'row-b': 120 })[key],
        scroll: 96,
        scrollLength: 320,
        sizes: new Map([
          ['row-a', 120],
          ['row-b', 52],
        ]),
      },
    });

    act(() =>
      visual.onStickyHeaderChange({
        index: 1,
        item: data[1],
      })
    );

    expect(mockInfo).toHaveBeenCalledWith(
      'visual.layout.sticky_header',
      expect.objectContaining({
        scope: 'test.list',
        component: 'TestLegendList',
        key: 'row-b',
        index: 1,
        itemType: 'reply-tabs',
        activeStickyIndex: 1,
        virtualY: 120,
        virtualH: 52,
        virtualBottom: 172,
      })
    );
  });

  it('logs LegendList virtual positions for visible and buffered rows', () => {
    const data = [
      { id: 'row-a', type: 'note' },
      { id: 'row-b', type: 'reply-tabs' },
      { id: 'row-c', type: 'reply' },
    ] as const;
    const visual = visualListHarness({
      listState: {
        activeStickyIndex: 1,
        contentLength: 520,
        data,
        end: 2,
        endBuffered: 2,
        positionAtIndex: (index) => [0, 120, 172][index] ?? Number.NaN,
        positionByKey: (key) => ({ 'row-a': 0, 'row-b': 120, 'row-c': 172 })[key],
        scroll: 64,
        scrollLength: 320,
        scrollVelocity: 0,
        sizeAtIndex: (index) => [120, 52, 180][index] ?? Number.NaN,
        sizes: new Map([
          ['row-a', 120],
          ['row-b', 52],
          ['row-c', 180],
        ]),
        start: 0,
        startBuffered: 0,
      },
    });

    act(() =>
      visual.onItemSizeChanged({
        size: 52,
        previous: 0,
        index: 1,
        itemKey: 'row-b',
        itemData: { id: 'row-b', type: 'reply-tabs' },
      })
    );
    act(() =>
      visual.onViewableItemsChanged({
        start: 0,
        end: 2,
        startBuffered: 0,
        endBuffered: 2,
        viewableItems: [
          { index: 0, key: 'row-a', isViewable: true, item: data[0] },
          { index: 1, key: 'row-b', isViewable: true, item: data[1] },
        ],
        changed: [],
      })
    );

    expect(mockInfo).toHaveBeenCalledWith(
      'visual.layout.item_size_changed',
      expect.objectContaining({
        key: 'row-b',
        virtualY: 120,
        virtualH: 52,
        virtualBottom: 172,
        virtualSource: 'key',
      })
    );
    expect(mockInfo).toHaveBeenCalledWith(
      'visual.layout.viewability',
      expect.objectContaining({
        hasListState: true,
        scroll: 64,
        scrollLength: 320,
        contentLength: 520,
        activeStickyIndex: 1,
        viewable: [
          expect.objectContaining({ key: 'row-a', virtualY: 0, virtualH: 120 }),
          expect.objectContaining({ key: 'row-b', virtualY: 120, virtualH: 52 }),
        ],
        buffered: expect.arrayContaining([
          expect.objectContaining({ rowKey: 'row-c', virtualY: 172, virtualH: 180 }),
        ]),
      })
    );
    expect(mockInfo).toHaveBeenCalledWith(
      'visual.layout.virtual_positions',
      expect.objectContaining({
        scope: 'test.list',
        totalRows: 3,
        chunkIndex: 0,
        chunkCount: 1,
        rowCount: 3,
        virtualAnomaly: false,
        duplicateKeyCount: 0,
        farVirtualCount: 0,
        invalidSizeCount: 0,
        missingSizeCount: 0,
        missingVirtualPositionCount: 0,
        outsideContentLengthCount: 0,
        virtualOverlapCount: 0,
        virtualOrderBreakCount: 0,
        rows: [
          expect.objectContaining({ key: 'row-a', index: 0, virtualY: 0, virtualH: 120 }),
          expect.objectContaining({ key: 'row-b', index: 1, virtualY: 120, virtualH: 52 }),
          expect.objectContaining({ key: 'row-c', index: 2, virtualY: 172, virtualH: 180 }),
        ],
      })
    );
  });

  it('warns when a full virtual position snapshot has absurd coordinates', () => {
    const data = [
      { id: 'dup', type: 'note' },
      { id: 'dup', type: 'note' },
      { id: 'far', type: 'reply' },
    ] as const;
    const visual = visualListHarness({
      listState: {
        contentLength: 100,
        data,
        end: 2,
        endBuffered: 2,
        positionByKey: (key) => ({ dup: 0, far: 500 })[key],
        scrollLength: 50,
        sizes: new Map([
          ['dup', 80],
          ['far', 90],
        ]),
        start: 0,
        startBuffered: 0,
      },
    });

    act(() =>
      visual.onViewableItemsChanged({
        start: 0,
        end: 2,
        startBuffered: 0,
        endBuffered: 2,
        viewableItems: [{ index: 0, key: 'dup', isViewable: true, item: data[0] }],
        changed: [],
      })
    );

    expect(mockWarn).toHaveBeenCalledWith(
      'visual.layout.virtual_positions',
      expect.objectContaining({
        scope: 'test.list',
        virtualAnomaly: true,
        duplicateKeyCount: 1,
        farVirtualCount: 1,
        invalidSizeCount: 0,
        missingSizeCount: 0,
        missingVirtualPositionCount: 0,
        outsideContentLengthCount: 1,
        virtualOverlapCount: 1,
        virtualOrderBreakCount: 0,
        rows: [
          expect.objectContaining({ key: 'dup', index: 0, virtualY: 0, virtualH: 80 }),
          expect.objectContaining({ key: 'dup', index: 1, virtualY: 0, virtualH: 80 }),
          expect.objectContaining({ key: 'far', index: 2, virtualY: 500, virtualH: 90 }),
        ],
      })
    );
  });

  it('can replace raw virtualized item keys with caller-safe keys', () => {
    const visual = visualListHarness({ safeKeys: true });

    act(() =>
      visual.onItemSizeChanged({
        size: 104,
        previous: 0,
        index: 0,
        itemKey: 'raw-secret-row-a',
        itemData: { id: 'raw-secret-row-a', type: 'note' },
      })
    );
    act(() =>
      visual.onViewableItemsChanged({
        start: 0,
        end: 0,
        startBuffered: 0,
        endBuffered: 0,
        viewableItems: [
          {
            index: 0,
            key: 'raw-secret-row-a',
            isViewable: true,
            item: { id: 'raw-secret-row-a', type: 'note' },
          },
        ],
        changed: [],
      })
    );

    expect(mockInfo).toHaveBeenCalledWith(
      'visual.layout.item_size_changed',
      expect.objectContaining({ key: 'safe:note:0' })
    );
    expect(mockInfo).toHaveBeenCalledWith(
      'visual.layout.viewability',
      expect.objectContaining({
        viewable: [expect.objectContaining({ key: 'safe:note:0' })],
      })
    );
  });

  it('skips LegendList snapshots when visual logging is disabled', () => {
    mockIsLevelEnabled.mockReturnValue(false);
    const visual = visualListHarness({
      listState: {
        data: [{ id: 'row-a', type: 'note' }],
        positionAtIndex: () => 0,
        sizeAtIndex: () => 120,
      },
    });

    act(() =>
      visual.onItemSizeChanged({
        size: 120,
        previous: 0,
        index: 0,
        itemKey: 'row-a',
        itemData: { id: 'row-a', type: 'note' },
      })
    );
    act(() =>
      visual.onViewableItemsChanged({
        start: 0,
        end: 0,
        startBuffered: 0,
        endBuffered: 0,
        viewableItems: [
          {
            index: 0,
            key: 'row-a',
            isViewable: true,
            item: { id: 'row-a', type: 'note' },
          },
        ],
        changed: [],
      })
    );

    expect(mockInfo).not.toHaveBeenCalled();
    expect(mockWarn).not.toHaveBeenCalled();
  });
});

describe('useVisualScrollMetricsLogger', () => {
  it('logs vertical ScrollView layout, content size, and scroll offsets as visual metrics', () => {
    const visual = visualScrollHarness('y');

    act(() => visual.onLayout(layoutEvent(320, 500)));
    act(() => visual.onContentSizeChange(640, 1200));
    act(() =>
      visual.onScroll(
        scrollEvent({
          contentHeight: 1200,
          contentWidth: 640,
          height: 500,
          width: 320,
          x: 12,
          y: 240,
        })
      )
    );

    expect(mockInfo).toHaveBeenCalledWith(
      'visual.layout.list_metrics',
      expect.objectContaining({
        scope: 'test.scroll',
        component: 'TestScrollView',
        axis: 'y',
        scrollReason: 'scroll',
        size: 500,
        scroll: 240,
        scrollLength: 500,
        contentLength: 1200,
        contentWidth: 640,
        contentHeight: 1200,
        viewportWidth: 320,
        viewportHeight: 500,
      })
    );
  });

  it('logs horizontal ScrollView offsets against content width', () => {
    const visual = visualScrollHarness('x');

    act(() =>
      visual.onScroll(
        scrollEvent({
          contentHeight: 96,
          contentWidth: 900,
          height: 96,
          width: 300,
          x: 72,
          y: 0,
        })
      )
    );

    expect(mockInfo).toHaveBeenCalledWith(
      'visual.layout.list_metrics',
      expect.objectContaining({
        axis: 'x',
        size: 300,
        scroll: 72,
        scrollLength: 300,
        contentLength: 900,
        contentWidth: 900,
        contentHeight: 96,
      })
    );
  });
});

describe('urlHost', () => {
  it('extracts the host from a media url', () => {
    expect(urlHost('https://cdn.example.com/a/b.jpg?x=1')).toBe('cdn.example.com');
    expect(urlHost('wss://relay.example.net')).toBe('relay.example.net');
  });

  it('returns "unknown" for a string without a scheme', () => {
    expect(urlHost('not-a-url')).toBe('unknown');
  });
});

describe('visualLayoutScopePart', () => {
  it('normalizes arbitrary scope text for log query prefixes', () => {
    expect(visualLayoutScopePart('profile feed / active tab')).toBe('profile_feed___active_tab');
    expect(visualLayoutScopePart('')).toBe('default');
  });
});
